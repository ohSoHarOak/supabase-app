/**
 * M-Connect -- the walker's "Getting paid" surface.
 *
 * DECIDED 2026-09-05, after testing both paths against a real browser:
 *   - Getting set up   -> Stripe's HOSTED onboarding (a redirect).
 *   - Once set up      -> Stripe's EMBEDDED components, in-page.
 *
 * Why the split, since embedded onboarding was the original goal: because the
 * walker carries losses (see ConnectService.ACCOUNT_CONFIGURATION), Stripe
 * owns requirements collection and forces the walker to authenticate as a
 * Stripe user -- `disable_stripe_user_authentication` is rejected outright on
 * this config. That authentication step fails inside the embedded
 * `account_onboarding` component ("An error occurred while authenticating your
 * account") while the hosted flow completes the identical onboarding without
 * complaint. Ruled out along the way: CSP, the platform's own profile, secure
 * context, session API version, and a missing contact phone.
 *
 * So onboarding redirects. Everything *after* onboarding -- payouts and, the
 * reason any of this matters, DISPUTES -- is embedded and verified working.
 * The walker only leaves the app once, to get set up, and never again to
 * contest a chargeback they are liable for.
 *
 * Revisit the onboarding half if Stripe fixes that authentication path; the
 * account config already supports it and only this file would change.
 *
 * WARNING: vanilla, not React. `web/src` has no framework; this is the
 * standalone `@stripe/connect-js` API -- `loadConnectAndInitialize` then
 * `instance.create()`, which returns a custom element you append yourself.
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
    body: "Before you can charge a client, Stripe needs your identity and bank details. You'll finish on Stripe's own secure page and come straight back here. It takes a few minutes.",
    cta: 'Set up payments',
  },
  incomplete: {
    title: 'Finish setting up payments',
    body: 'Stripe still needs a few details before you can take payment. Picking up where you left off takes you back to their secure page.',
    cta: 'Finish on Stripe',
  },
  pending_review: {
    title: 'Stripe is reviewing your details',
    body: "Nothing to do right now. This usually takes minutes, occasionally longer. Check again whenever you like -- we also update this automatically.",
    cta: 'Check again',
  },
  ready: {
    title: "You're set up to take payments",
    body: "Payments go straight to your own bank account. Stripe's processing fee comes out of each payment, and we take nothing on top.",
    cta: null,
  },
};

/**
 * Render the whole section into `host`.
 *
 * @param {HTMLElement} host  container this owns outright
 * @param {object} deps       { api, toast, setupComplete, justReturned } from
 *                            app.js -- passed in rather than imported, to keep
 *                            this module leaf-level
 */
export async function renderConnect(host, deps) {
  const { api, toast, setupComplete, justReturned } = deps;
  host.innerHTML = '';
  host.appendChild(note('Checking your payment setup...'));

  // Coming back from Stripe's hosted page, the cached flags are a step behind
  // by definition -- the walker finished at Stripe, not here. Read Stripe
  // before rendering, or they land on "not set up" seconds after setting up.
  if (justReturned) {
    try {
      await api('POST', '/api/connect/refresh');
    } catch {
      // Non-fatal: the status read below still shows whatever we know.
    }
  }

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

  host.innerHTML = '';
  host.appendChild(card);

  // Both /onboarding-link and /account-session sit behind
  // `requireCompleteProfile`, so without a finished profile every route out of
  // here 403s. Caught here rather than left to fail as an opaque error later.
  if (!setupComplete) {
    card.appendChild(setupNeeded());
    return;
  }

  // --- not set up yet: hosted redirect, no embedded components -------------
  if (status.state !== 'ready') {
    card.appendChild(hostedAction(api, toast, host, deps, status.state, copy.cta));
    if (status.state !== 'not_started') card.appendChild(disconnectRow(api, toast, host, deps));
    return;
  }

  // --- set up: embedded components ----------------------------------------
  let cfg = {};
  try {
    cfg = await api('GET', '/api/config');
  } catch {
    cfg = {};
  }

  // Without a publishable key there is nothing to mount. The walker is already
  // set up and getting paid, so this is cosmetic rather than blocking -- say so
  // instead of showing a broken frame.
  if (!cfg.stripe_publishable_key) {
    card.appendChild(note('Payout and dispute details are unavailable right now. Your payments are unaffected.'));
    card.appendChild(disconnectRow(api, toast, host, deps));
    return;
  }

  let connect;
  try {
    connect = await getInstance(cfg.stripe_publishable_key, api);
  } catch (err) {
    card.appendChild(errorCard("Couldn't load your payout details.", err.message, () => renderConnect(host, deps)));
    card.appendChild(disconnectRow(api, toast, host, deps));
    return;
  }

  try {
    // Stripe's own banner surfaces anything urgent (extra verification, a
    // document request) in Stripe's words, which stay correct as their
    // requirements change and ours would not.
    card.appendChild(mountIn(connect, 'notification-banner'));
    card.appendChild(mountIn(connect, 'payouts'));

    const heading = el('div', 'eyebrow', 'Payments and disputes');
    heading.style.marginTop = '22px';
    card.appendChild(heading);

    // The component this whole exercise exists for: the walker is liable for
    // chargebacks, so contesting one has to be reachable from inside the app.
    card.appendChild(mountIn(connect, 'payments'));
  } catch (err) {
    card.appendChild(errorCard("Couldn't show your payout details.", err.message, () => renderConnect(host, deps)));
  }

  card.appendChild(disconnectRow(api, toast, host, deps));
}

// ------------------------------------------------------------- internals ----

function mountIn(connect, componentName) {
  const wrap = el('div', 'connect-mount');
  wrap.appendChild(connect.create(componentName));
  return wrap;
}

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

/**
 * The onboarding route: a fresh single-use Stripe URL every time.
 *
 * Account links expire and are single-use by design, so a walker who abandons
 * halfway resumes by asking for another one rather than reusing a dead URL.
 * `pending_review` has nothing to submit, so it re-reads status instead.
 */
function hostedAction(api, toast, host, deps, state, label) {
  const foot = el('div', 'form-foot');
  foot.appendChild(el('div', 'spacer'));
  const btn = el('button', 'btn btn-primary', label ?? 'Continue on Stripe');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (state === 'pending_review') {
        await api('POST', '/api/connect/refresh');
        renderConnect(host, deps);
        return;
      }
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
  wrap.appendChild(
    el('p', 'page-sub', 'Finish your profile first -- Stripe needs your business name, phone, and photo before it can verify you.')
  );
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
