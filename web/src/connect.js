/**
 * M-Connect -- the walker's "Getting paid" surface, using Stripe's embedded
 * Connect components.
 *
 * Why embedded rather than the hosted redirect: as of 2026-09-05 the walker
 * carries chargebacks and Stripe's fees (see ConnectService.ACCOUNT_CONFIGURATION),
 * so they need to actually *respond* to a dispute. Sending them to a Stripe
 * dashboard was never an option -- the account is `dashboard: 'none'`, which is
 * exactly why liability could move to them without handing them a Stripe login.
 *
 * WARNING: vanilla, not React. `web/src` has no framework; this is the
 * standalone `@stripe/connect-js` API -- `loadConnectAndInitialize` then
 * `instance.create()`, which returns a custom element you append yourself.
 *
 * WARNING: the hosted redirect still works on this account config and is kept
 * as the fallback for when no publishable key is configured. Deleting it turns
 * a missing env var into a walker who cannot get paid at all.
 */
import { loadConnectAndInitialize } from '@stripe/connect-js';

/** One instance per page load; Stripe re-fetches secrets itself as they expire. */
let instancePromise = null;

/** Drop the cached instance -- after a disconnect the old account is stale. */
export function resetConnect() {
  instancePromise = null;
}

/**
 * Human copy per state. Kept together so the four states read as one decision --
 * the same reason `ConnectStatus.state` exists server-side instead of four
 * booleans re-derived at each call site.
 */
const COPY = {
  not_started: {
    title: 'Set up payments',
    body: 'Before you can charge a client, Stripe needs your identity and bank details. It takes a few minutes, and you can come back to it.',
  },
  incomplete: {
    title: 'Finish setting up payments',
    body: 'Stripe still needs a few details before you can take payment.',
  },
  pending_review: {
    title: 'Stripe is reviewing your details',
    body: 'Nothing to do right now. This usually takes minutes, occasionally longer. This page updates itself.',
  },
  ready: {
    title: "You're set up to take payments",
    body: "Payments go straight to your own bank account. Stripe's processing fee comes out of each payment, and we take nothing on top.",
  },
};

/**
 * Render the whole section into `host`.
 *
 * @param {HTMLElement} host  container this owns outright
 * @param {object} deps       { api, toast, setupComplete } from app.js --
 *                            passed in rather than imported, to keep this
 *                            module leaf-level
 */
export async function renderConnect(host, deps) {
  const { api, toast, setupComplete } = deps;
  host.innerHTML = '';
  host.appendChild(note('Checking your payment setup...'));

  let status;
  try {
    status = await api('GET', '/api/connect/status');
  } catch (err) {
    host.innerHTML = '';
    host.appendChild(errorCard("Couldn't load your payment setup.", err.message, () => renderConnect(host, deps)));
    return;
  }

  const copy = COPY[status.state] || COPY.not_started;

  const card = el('div', 'card fieldset');
  card.appendChild(el('h2', 'card-title', copy.title));
  card.appendChild(el('p', 'page-sub', copy.body));

  // Stripe's own banner surfaces anything urgent (extra verification, a
  // document request) in Stripe's words, which stay correct as their
  // requirements change and ours would not.
  const bannerMount = el('div', 'connect-mount');
  card.appendChild(bannerMount);

  const mount = el('div', 'connect-mount');
  card.appendChild(mount);

  host.innerHTML = '';
  host.appendChild(card);

  // Both /account-session and /onboarding-link sit behind
  // `requireCompleteProfile`, so without a finished profile every route out of
  // here 403s. Caught here rather than left to fail inside Stripe's iframe,
  // where a 403 from fetchClientSecret surfaces as an opaque component error
  // with nothing pointing at the actual cause.
  if (!setupComplete) {
    card.appendChild(setupNeeded());
    return;
  }

  let cfg = {};
  try {
    cfg = await api('GET', '/api/config');
  } catch {
    cfg = {};
  }

  // No publishable key -> hosted redirect. A missing env var should degrade to
  // "works, less nicely", never to "cannot get paid".
  if (!cfg.stripe_publishable_key) {
    card.appendChild(hostedFallback(api, toast));
    return;
  }

  let connect;
  try {
    connect = await getInstance(cfg.stripe_publishable_key, api);
  } catch (err) {
    card.appendChild(errorCard("Couldn't load the payment setup form.", err.message, null));
    card.appendChild(hostedFallback(api, toast));
    return;
  }

  try {
    bannerMount.appendChild(connect.create('notification-banner'));
  } catch {
    // A banner that will not mount is not worth failing the page over.
  }

  if (status.state === 'ready') {
    mount.appendChild(connect.create('payouts'));

    const heading = el('div', 'eyebrow', 'Payments and disputes');
    heading.style.marginTop = '22px';
    card.appendChild(heading);

    // This component is what makes the liability decision survivable: the
    // walker is on the hook for chargebacks, so contesting one has to be
    // reachable from inside the app.
    const payments = el('div', 'connect-mount');
    payments.appendChild(connect.create('payments'));
    card.appendChild(payments);

    card.appendChild(disconnectRow(api, toast, host, deps));
    return;
  }

  const onboarding = connect.create('account-onboarding');
  // Fires when the walker leaves the flow -- finished or abandoned, Stripe does
  // not say which. So re-read rather than assume: `refresh()` asks Stripe and
  // persists, and the re-render shows whichever state is now true.
  onboarding.setOnExit(async () => {
    try {
      await api('POST', '/api/connect/refresh');
    } catch {
      // Non-fatal -- the re-render below still reads whatever we know.
    }
    renderConnect(host, deps);
  });
  mount.appendChild(onboarding);

  if (status.state !== 'not_started') card.appendChild(disconnectRow(api, toast, host, deps));
}

// ------------------------------------------------------------- internals ----

function getInstance(publishableKey, api) {
  if (instancePromise) return instancePromise;
  instancePromise = Promise.resolve(
    loadConnectAndInitialize({
      publishableKey,
      // Stripe calls this whenever it needs a secret, including after one
      // expires -- which is why nothing here caches the value.
      fetchClientSecret: async () => {
        const session = await api('POST', '/api/connect/account-session');
        return session.client_secret;
      },
      appearance: {
        variables: {
          colorPrimary: '#2B7192',
          fontFamily: 'inherit',
          borderRadius: '10px',
        },
      },
    })
  ).catch((err) => {
    instancePromise = null; // let the next attempt retry rather than cache a failure
    throw err;
  });
  return instancePromise;
}

function hostedFallback(api, toast) {
  const foot = el('div', 'form-foot');
  foot.appendChild(el('div', 'spacer'));
  const btn = el('button', 'btn btn-primary', 'Continue on Stripe');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const link = await api('POST', '/api/connect/onboarding-link');
      window.location.href = link.url;
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
  foot.appendChild(btn);
  return foot;
}

function disconnectRow(api, toast, host, deps) {
  const foot = el('div', 'form-foot');
  foot.appendChild(el('div', 'spacer'));
  const btn = el('button', 'btn btn-danger', 'Disconnect payout account');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    // The seam from Workstream D / P2-15: this link is replaceable, never
    // hardwired. Nothing is deleted at Stripe -- the account and its payout
    // history belong to the walker, not to us.
    const ok = window.confirm(
      "Disconnect your payout account? You won't be able to take card payments until you connect one again. Nothing is deleted at Stripe."
    );
    if (!ok) return;
    btn.disabled = true;
    try {
      await api('POST', '/api/connect/disconnect');
      resetConnect();
      toast('Payout account disconnected.');
      renderConnect(host, deps);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
  foot.appendChild(btn);
  return foot;
}

function setupNeeded() {
  const wrap = el('div', '');
  const p = el('p', 'page-sub', 'Finish your profile first -- Stripe needs your business name, phone, and photo before it can verify you.');
  wrap.appendChild(p);
  const foot = el('div', 'form-foot');
  foot.appendChild(el('div', 'spacer'));
  const link = el('a', 'btn btn-primary', 'Finish profile setup');
  link.href = '#/setup/1';
  foot.appendChild(link);
  wrap.appendChild(foot);
  return wrap;
}

function note(text) {
  const wrap = el('div', 'card fieldset');
  const p = el('p', 'page-sub', text);
  p.style.margin = '0';
  wrap.appendChild(p);
  return wrap;
}

function errorCard(title, detail, retry) {
  const wrap = el('div', 'card fieldset');
  wrap.appendChild(el('h2', 'card-title', title));
  if (detail) wrap.appendChild(el('p', 'page-sub', detail));
  if (retry) {
    const foot = el('div', 'form-foot');
    foot.appendChild(el('div', 'spacer'));
    const btn = el('button', 'btn', 'Try again');
    btn.type = 'button';
    btn.addEventListener('click', retry);
    foot.appendChild(btn);
    wrap.appendChild(foot);
  }
  return wrap;
}

/** textContent, never innerHTML -- none of this copy is trusted markup. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
