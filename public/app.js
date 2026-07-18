/* PetPro Connect — professional UI (Week 4, extended with Week 5 billing).
   Vanilla JS single-page app, hash-routed, talking to the REST API.
   No build step: this file is served as-is by the Express server. */

(() => {
  'use strict';

  // ------------------------------------------------------------ state ----
  let token = localStorage.getItem('petpro_token');
  let account = safeParse(localStorage.getItem('petpro_account'));
  let profile = safeParse(localStorage.getItem('petpro_profile'));

  const appEl = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  function safeParse(json) {
    try { return JSON.parse(json); } catch { return null; }
  }

  // -------------------------------------------------------- api client ----
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    if (res.status === 401 && token) {
      logout(false);
      throw new Error('Your session expired — please log in again.');
    }
    let json;
    try { json = await res.json(); } catch { json = null; }
    if (!json || json.ok !== true) {
      throw new Error(json?.error?.message || `Request failed (${res.status}).`);
    }
    return json.data;
  }

  // ------------------------------------------------------------- toast ----
  const toast = PetPro.createToast(toastEl);

  // ------------------------------------------------------------ helpers ----
  // Formatters, withBusy and the sign-screen pieces live in shared.js so the
  // owner portal uses the same code — see T-3 in ROADMAP.md.
  const { esc, fmtDate, fmtTime, fmtMoney, fmtPhone, withBusy } = PetPro;
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  }
  // Tester feedback 2026-07-18: every client gets a stable color — avatar in
  // the lists, stripe on the calendar — so a busy day reads at a glance.
  // Colors go by client creation order, not a hash: hashing 8 colors collides
  // between two clients far too easily (found immediately in testing), while
  // creation order guarantees consecutive clients differ and never reshuffles
  // existing clients when a new one is added.
  const CLIENT_COLORS = ['#2B7192', '#6D9280', '#8A5A83', '#C06B3E', '#A98127', '#3E8E7E', '#5B6BAA', '#A85D75'];
  let clientColorMap = null; // client id -> color, built once per page load
  function assignClientColors(clients) {
    const ordered = [...clients].sort(
      (a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id))
    );
    clientColorMap = new Map(ordered.map((c, i) => [c.id, CLIENT_COLORS[i % CLIENT_COLORS.length]]));
  }
  async function ensureClientColors() {
    if (clientColorMap) return;
    try {
      assignClientColors(await api('GET', '/api/clients'));
    } catch { /* fall back to the default below until a later screen loads it */ }
  }
  function clientColor(id) {
    if (!clientColorMap) return 'var(--steel)';
    let color = clientColorMap.get(id);
    if (!color) {
      // Client created after the map was built — append, same as a reload would.
      color = CLIENT_COLORS[clientColorMap.size % CLIENT_COLORS.length];
      clientColorMap.set(id, color);
    }
    return color;
  }
  function petSummary(pets) {
    if (!pets?.length) return 'No pets yet';
    return pets.map((p) => (p.breed ? `${p.name} (${p.breed})` : p.name)).join(' · ');
  }
  // "$30", "30.00", "$30.50" -> integer cents (or null if unparseable)
  function parseMoney(text) {
    const n = parseFloat(String(text).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  }
  // Date-only strings (YYYY-MM-DD) must not go through new Date(iso) — that
  // parses as UTC midnight and shifts a day west of Greenwich.
  function fmtDateOnly(ymd) {
    const [y, m, d] = String(ymd).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  PetPro.installPhoneFormatting();
  // ISO <-> the value format of <input type="datetime-local"> (local time)
  function toLocalInput(iso) {
    const d = new Date(iso);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  function fromLocalInput(value) {
    return new Date(value).toISOString();
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  function startOfWeek(d) {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return new Date(date.getTime() - ((date.getDay() + 6) % 7) * DAY_MS); // Monday
  }
  const SERVICE_TYPES = {
    private_walk: 'Private walk', group_walk: 'Group walk', training_session: 'Training session',
    grooming: 'Grooming', sitting: 'Sitting', boarding: 'Boarding', other: 'Other',
  };
  const CADENCES = {
    per_visit: 'per visit', per_day: 'per day', weekly: 'weekly', biweekly: 'every 2 weeks',
    monthly: 'monthly', per_package: 'per package', one_time: 'one-time',
  };
  // Long labels for the "Billed" select.
  const CADENCE_OPTIONS = {
    per_visit: 'Per visit — invoice auto-created after each visit',
    per_day: 'Per day — invoice auto-created per day of the stay',
    weekly: 'Weekly',
    biweekly: 'Every 2 weeks',
    monthly: 'Monthly',
    per_package: 'Per package',
    one_time: 'One-time',
  };
  // Which billing choices make sense for each service type — a boarding
  // stay is day-priced, a walk isn't.
  const CADENCES_BY_TYPE = {
    private_walk: ['per_visit', 'weekly', 'biweekly', 'monthly', 'per_package', 'one_time'],
    group_walk: ['per_visit', 'weekly', 'biweekly', 'monthly', 'per_package', 'one_time'],
    training_session: ['per_visit', 'per_package', 'weekly', 'monthly', 'one_time'],
    grooming: ['per_visit', 'per_package', 'one_time'],
    sitting: ['per_day', 'per_visit', 'weekly', 'biweekly', 'per_package', 'one_time'],
    boarding: ['per_day', 'one_time', 'per_package'],
    other: Object.keys(CADENCE_OPTIONS),
  };
  // Service types this professional offers (from their profile). Empty =
  // no preference set yet = show everything.
  function offeredTypes() {
    const set = profile?.offered_service_types;
    return set && set.length ? set.filter((t) => SERVICE_TYPES[t]) : Object.keys(SERVICE_TYPES);
  }
  function typeOptionsHtml(selected) {
    return offeredTypes()
      .map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${SERVICE_TYPES[v]}</option>`)
      .join('');
  }
  function cadenceOptionsHtml(serviceType, selected) {
    const allowed = CADENCES_BY_TYPE[serviceType] ?? Object.keys(CADENCE_OPTIONS);
    const pick = allowed.includes(selected) ? selected : allowed[0];
    return allowed
      .map((v) => `<option value="${v}" ${v === pick ? 'selected' : ''}>${CADENCE_OPTIONS[v]}</option>`)
      .join('');
  }
  // Repopulate a "Billed" select whenever its Type select changes.
  function wireTypeToCadence(typeId, cadenceId) {
    const typeSel = document.getElementById(typeId);
    const cadenceSel = document.getElementById(cadenceId);
    typeSel.onchange = () => {
      cadenceSel.innerHTML = cadenceOptionsHtml(typeSel.value, cadenceSel.value);
    };
  }
  const PAW = `<svg width="26" height="26" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#1C4C64"/><g fill="#F7F2EB"><ellipse cx="15" cy="16" rx="3.4" ry="4.4" transform="rotate(-18 15 16)"/><ellipse cx="29" cy="16" rx="3.4" ry="4.4" transform="rotate(18 29 16)"/><ellipse cx="9.5" cy="23.5" rx="2.8" ry="3.6" transform="rotate(-38 9.5 23.5)"/><ellipse cx="34.5" cy="23.5" rx="2.8" ry="3.6" transform="rotate(38 34.5 23.5)"/><path d="M22 21c4.4 0 8.4 3.5 8.4 7.6 0 2.9-2.2 4.6-4.7 4.6-1.5 0-2.6-0.6-3.7-0.6s-2.2 0.6-3.7 0.6c-2.5 0-4.7-1.7-4.7-4.6C13.6 24.5 17.6 21 22 21z"/></g></svg>`;
  const PAW_LOGIN = PAW.replace('width="26" height="26"', 'width="44" height="44"').replace('#1C4C64', '#2B7192');

  function logout(navigate = true) {
    token = null; account = null; profile = null;
    localStorage.removeItem('petpro_token');
    localStorage.removeItem('petpro_account');
    localStorage.removeItem('petpro_profile');
    if (navigate) location.hash = '#/login';
    else render();
  }

  function saveSession(session) {
    token = session.access_token;
    account = session.account;
    localStorage.setItem('petpro_token', token);
    localStorage.setItem('petpro_account', JSON.stringify(account));
  }

  async function loadProfile() {
    const me = await api('GET', '/api/auth/me');
    profile = me.profile;
    localStorage.setItem('petpro_profile', JSON.stringify(profile));
    // PH-1: phone lives on the account, not the profile, so refresh both —
    // otherwise a saved phone number re-renders from a stale cached account.
    if (me.account) {
      account = me.account;
      localStorage.setItem('petpro_account', JSON.stringify(account));
    }
  }

  // ------------------------------------------------------------ header ----
  function header(active) {
    const tab = (id, label) =>
      `<a href="#/${id}" class="${active === id ? 'active' : ''}">${label}</a>`;
    return `
      <header class="app-header"><div class="inner">
        <a class="brand" href="#/today">${PAW} PetPro Connect</a>
        <nav class="app-nav">
          ${tab('today', 'Today')}
          ${tab('clients', 'Clients')}
          ${tab('schedule', 'Schedule')}
          ${tab('messages', 'Messages')}
          ${tab('profile', 'Profile')}
          <a href="#/login" onclick="window.petproLogout(); return false;">Log out</a>
        </nav>
      </div></header>`;
  }
  window.petproLogout = () => logout();

  // ------------------------------------------------------------- login ----
  function renderLogin(mode = 'login') {
    document.body.classList.add('login-bg');
    const isSignup = mode === 'signup';
    appEl.innerHTML = `
      <div class="login-wrap"><div class="login-card">
        <div class="login-brand">
          ${PAW_LOGIN}
          <div class="wordmark">PetPro Connect</div>
          <div class="tag">Your business, in one place</div>
        </div>
        <form id="login-form">
          ${isSignup ? `
          <div><label for="f-name">Your full name</label><input id="f-name" required autocomplete="name" /></div>
          <div><label for="f-biz">Business name <span class="hint">optional</span></label><input id="f-biz" autocomplete="organization" /></div>` : ''}
          <div><label for="f-email">Email</label><input id="f-email" type="email" required autocomplete="username" /></div>
          <div><label for="f-pass">Password ${isSignup ? `<span class="hint">${PASSWORD_HINT}</span>` : ''}</label>
            <input id="f-pass" type="password" required minlength="${isSignup ? 12 : 1}" autocomplete="${isSignup ? 'new-password' : 'current-password'}" /></div>
          <button class="btn btn-primary" type="submit">${isSignup ? 'Create account' : 'Log in'}</button>
        </form>
        <div class="login-foot">
          ${isSignup
            ? `Already have an account? <a id="mode-switch">Log in</a>`
            : `New here? <a id="mode-switch">Create your business account</a><br /><a id="forgot-link">Forgot your password?</a>`}
        </div>
      </div></div>`;

    document.getElementById('mode-switch').onclick = () => renderLogin(isSignup ? 'login' : 'signup');
    const forgotLink = document.getElementById('forgot-link');
    if (forgotLink) forgotLink.onclick = () => renderForgotPassword();
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          const body = {
            email: document.getElementById('f-email').value.trim(),
            password: document.getElementById('f-pass').value,
          };
          if (isSignup) {
            body.fullName = document.getElementById('f-name').value.trim();
            const biz = document.getElementById('f-biz').value.trim();
            if (biz) body.businessName = biz;
          }
          const session = await api('POST', isSignup ? '/api/auth/signup' : '/api/auth/login', body);
          saveSession(session);
          await loadProfile();
          // O-1: new professionals land in setup; returning ones go to work.
          location.hash = isSignup ? '#/setup' : '#/today';
        } catch (err) {
          toast(err.message);
        }
      });
    };
  }

  // ---------------------------------------------------------- onboarding ----
  // O-1: three steps after signup. "Done" is derived from the profile itself
  // rather than a flag column — nothing to migrate, nothing to keep in sync.
  const setupDone = () =>
    Boolean(profile?.full_name && account?.phone && profile?.offered_service_types?.length);

  function renderSetup(step) {
    const stepper = ['1 · You', '2 · Services', '3 · Ready']
      .map((label, i) => `<span class="step${i === step - 1 ? ' on' : ''}">${label}</span>`).join('');
    const skip = step < 3
      ? `<a class="backlink" href="#/setup/${step + 1}">Skip for now</a>`
      : `<a class="backlink" href="#/today">Go to today</a>`;

    const body = step === 1 ? `
      <div class="form-grid">
        <div><label for="su-name">Your full name</label>
          <input id="su-name" required value="${esc(profile?.full_name ?? '')}" /></div>
        <div><label for="su-biz">Business name</label>
          <input id="su-biz" value="${esc(profile?.business_name ?? '')}" placeholder="e.g. Sunny Trails Walking Co." /></div>
        <div><label for="su-phone">Your phone</label>
          <input id="su-phone" data-phone value="${esc(fmtPhone(account?.phone ?? ''))}" placeholder="(555)000-0000" /></div>
      </div>
      <p class="preview-note">Your business name heads every contract and invoice; your phone is how clients reach you from their portal.</p>`
      : step === 2 ? `
      <label>Which services do you offer?</label>
      <div class="appt-flags" style="margin-top:6px">
        ${Object.entries(SERVICE_TYPES).map(([v, l]) => `
          <label class="flag"><input type="checkbox" data-offer="${v}" ${(profile?.offered_service_types ?? []).includes(v) ? 'checked' : ''} /> ${l}</label>`).join('')}
      </div>
      <p class="preview-note" style="margin-top:10px">Only what you check appears when you build a contract, so you never wade past Grooming to find Dog walking.</p>`
      : `
      <p>Your agreement is ready to use — the packaged Pet Services Agreement, with your business details merged in.</p>
      <p class="preview-note">⚠️ It's a general template, not legal advice. Have it reviewed before a real client signs.</p>`;

    appEl.innerHTML = header('today') + `
      <div class="page">
        <h1 class="page-title">${step === 3 ? "You're set up" : 'Set up your business'}</h1>
        <p class="page-sub">Three quick steps — you can stop after any of them and finish later.</p>
        <div class="stepper">${stepper}</div>
        <form id="su-form">
          <div class="card fieldset" style="margin-top:14px">${body}</div>
          <div class="form-foot">
            ${skip}
            <div class="spacer"></div>
            <button class="btn btn-primary" type="submit">${step === 3 ? 'Add your first client' : 'Save & continue'}</button>
          </div>
        </form>
      </div>`;

    document.getElementById('su-form').onsubmit = async (e) => {
      e.preventDefault();
      if (step === 3) { location.hash = '#/client-new'; return; }
      await withBusy(e.target.querySelector('button[type=submit]'), async () => {
        try {
          await api('PATCH', '/api/auth/profile', step === 1 ? {
            full_name: document.getElementById('su-name').value.trim(),
            business_name: document.getElementById('su-biz').value.trim() || null,
            phone: fmtPhone(document.getElementById('su-phone').value) || null,
          } : {
            offered_service_types: [...document.querySelectorAll('[data-offer]')]
              .filter((cb) => cb.checked).map((cb) => cb.dataset.offer),
          });
          await loadProfile();
          location.hash = `#/setup/${step + 1}`;
        } catch (err) {
          toast(err.message);
        }
      });
    };
    wireNav();
  }

  // ------------------------------------------------- password recovery ----
  const PASSWORD_HINT = '12+ characters, mixing upper &amp; lowercase with numbers or symbols';

  function renderForgotPassword() {
    document.body.classList.add('login-bg');
    appEl.innerHTML = `
      <div class="login-wrap"><div class="login-card">
        <div class="login-brand">
          ${PAW_LOGIN}
          <div class="wordmark">PetPro Connect</div>
          <div class="tag">Reset your password</div>
        </div>
        <form id="forgot-form">
          <div><label for="f-email">Email</label><input id="f-email" type="email" required autocomplete="username" /></div>
          <button class="btn btn-primary" type="submit">Send reset link</button>
        </form>
        <div class="login-foot"><a id="back-login">Back to log in</a></div>
      </div></div>`;
    document.getElementById('back-login').onclick = () => renderLogin();
    document.getElementById('forgot-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          await api('POST', '/api/auth/forgot-password', {
            email: document.getElementById('f-email').value.trim(),
          });
          e.target.outerHTML = `<p style="text-align:center">If that email has an account, a reset link is on its way. Check your inbox (and spam) — the link brings you back here to set a new password.</p>`;
        } catch (err) {
          toast(err.message);
        }
      });
    };
  }

  // Shown when the emailed recovery link lands back on the app.
  function renderResetPassword(accessToken) {
    document.body.classList.add('login-bg');
    appEl.innerHTML = `
      <div class="login-wrap"><div class="login-card">
        <div class="login-brand">
          ${PAW_LOGIN}
          <div class="wordmark">PetPro Connect</div>
          <div class="tag">Choose a new password</div>
        </div>
        <form id="reset-form">
          <div><label for="f-pass">New password <span class="hint">${PASSWORD_HINT}</span></label>
            <input id="f-pass" type="password" required minlength="12" autocomplete="new-password" /></div>
          <div><label for="f-pass2">Repeat new password</label>
            <input id="f-pass2" type="password" required minlength="12" autocomplete="new-password" /></div>
          <button class="btn btn-primary" type="submit">Set new password</button>
        </form>
        <div class="login-foot"><a id="back-login">Back to log in</a></div>
      </div></div>`;
    const backToLogin = () => { history.replaceState(null, '', location.pathname); renderLogin(); };
    document.getElementById('back-login').onclick = backToLogin;
    document.getElementById('reset-form').onsubmit = async (e) => {
      e.preventDefault();
      const pass = document.getElementById('f-pass').value;
      if (pass !== document.getElementById('f-pass2').value) {
        toast("Those passwords don't match.");
        return;
      }
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          await api('POST', '/api/auth/reset-password', { access_token: accessToken, new_password: pass });
          toast('Password updated — log in with your new password.', 'ok');
          backToLogin();
        } catch (err) {
          toast(err.message);
        }
      });
    };
  }

  // ------------------------------------------------------------- today ----
  async function renderToday(query = '') {
    appEl.innerHTML = header('today') + `<div class="page loading">Loading your day…</div>`;
    let clients, contracts, todaysAppts, openInvoices;
    try {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      [clients, contracts, todaysAppts, openInvoices] = await Promise.all([
        api('GET', `/api/clients${query ? `?q=${encodeURIComponent(query)}` : ''}`),
        api('GET', '/api/contracts'),
        api('GET', `/api/appointments?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`),
        api('GET', '/api/invoices?status=open'),
        // A filtered fetch can't drive color assignment — top up the map in
        // parallel rather than serially after the data lands.
        query ? ensureClientColors() : Promise.resolve(),
      ]);
    } catch (err) {
      toast(err.message);
      appEl.innerHTML = header('today') + `<div class="page"><div class="empty">Couldn't load your data. <a class="backlink" href="#/today">Retry</a></div></div>`;
      return;
    }

    if (!query) assignClientColors(clients); // unfiltered list = the authoritative order

    const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
    const unsigned = contracts.filter((k) => k.status === 'draft' || k.status === 'sent');
    const pending = clients.filter((c) => c.status === 'prospect');
    const active = clients.filter((c) => c.status === 'active');
    const firstName = (profile?.full_name || '').split(' ')[0];
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const cueCards = unsigned.map((k) => {
      const c = byId[k.client_id];
      return `
        <div class="card cue-card">
          <div class="cue-text">
            <div class="cue-title">${esc(c?.full_name ?? 'A client')}'s agreement is ready to sign</div>
            <div class="cue-sub">Generated ${esc(fmtDate(k.created_at))}${c ? ` · ${esc(petSummary(c.pets))}` : ''}</div>
          </div>
          <button class="btn btn-primary" data-nav="#/contract/${k.id}/sign">Finish signing</button>
        </div>`;
    });
    // Unpaid invoices are money on the table — same urgency as an unsigned contract.
    const invoiceCues = openInvoices.map((inv) => {
      const c = byId[inv.client_id];
      const overdue = inv.due_date && new Date(inv.due_date) < new Date();
      return `
        <div class="card cue-card">
          <div class="cue-text">
            <div class="cue-title">${esc(c?.full_name ?? 'A client')} has an unpaid ${esc(fmtMoney(inv.amount_cents))} invoice${overdue ? ' — overdue' : ''}</div>
            <div class="cue-sub">${esc(inv.description || 'Services')} · created ${esc(fmtDate(inv.created_at))}${inv.due_date ? ` · due ${esc(fmtDate(inv.due_date))}` : ''}</div>
          </div>
          <button class="btn btn-quiet" data-nav="#/client/${inv.client_id}">View billing</button>
        </div>`;
    });

    // Today's agenda: where do I need to be today? (cancelled walks stay out of the way)
    const agenda = todaysAppts.filter((a) => a.status !== 'cancelled');
    const agendaRows = agenda.map((a) => `
      <div class="card contract-row client-stripe" style="border-left-color:${clientColor(a.client_id)}" data-nav="#/schedule" tabindex="0" role="link">
        <div class="what">
          <div class="title">${esc(fmtTime(a.starts_at))} — ${esc(a.clients?.full_name ?? 'Client')}</div>
          <div class="meta">${esc(a.services?.name ?? 'Appointment')}${a.services?.duration_minutes ? ` · ${esc(a.services.duration_minutes)} min` : ''}${a.notes ? ` · ${esc(a.notes)}` : ''}</div>
        </div>
        ${a.status === 'completed'
          ? '<span class="pill pill-sage">done</span>'
          : `<span class="pill pill-draft">${esc(fmtTime(a.starts_at))}</span>`}
        <span class="chev">›</span>
      </div>`);

    const pendingRows = pending.map((c) => {
      const hasUnsigned = unsigned.some((k) => k.client_id === c.id);
      return `
        <div class="card client-row" data-nav="#/client/${c.id}" tabindex="0" role="link">
          <div class="avatar" style="background:${clientColor(c.id)}">${esc(initials(c.full_name))}</div>
          <div class="who">
            <div class="name">${esc(c.full_name)}</div>
            <div class="pets">Pending client · ${esc(petSummary(c.pets))}</div>
          </div>
          <span class="pill pill-draft">${hasUnsigned ? 'contract awaiting signature' : 'no contract yet'}</span>
          <span class="chev">›</span>
        </div>`;
    });

    const activeRows = active.map((c) => `
      <div class="card client-row" data-nav="#/client/${c.id}" tabindex="0" role="link">
        <div class="avatar" style="background:${clientColor(c.id)}">${esc(initials(c.full_name))}</div>
        <div class="who">
          <div class="name">${esc(c.full_name)}</div>
          <div class="pets">${esc(petSummary(c.pets))}</div>
        </div>
        <span class="pill pill-sage">active</span>
        <span class="chev">›</span>
      </div>`);

    // O-1: nags until setup is finished, but never blocks the app.
    const setupCue = setupDone() ? '' : `
      <div class="card contract-row" data-nav="#/setup" tabindex="0" role="link">
        <div class="what">
          <div class="title">Finish setting up your business</div>
          <div class="meta">Your phone and the services you offer — a minute, and contracts fill themselves in.</div>
        </div>
        <span class="chev">›</span>
      </div>`;

    appEl.innerHTML = header('today') + `
      <div class="page">
        <h1 class="page-title">${firstName ? `Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${esc(firstName)}` : 'Today'}</h1>
        <p class="page-sub">${esc(profile?.business_name || '')}${profile?.business_name ? ' · ' : ''}${today}</p>

        <div class="eyebrow">Today's schedule</div>
        <div class="stack">
          ${agendaRows.join('') || `<div class="card empty">No walks on the books today. <a class="backlink" href="#/schedule">Open the schedule ›</a></div>`}
        </div>

        <div class="eyebrow">Needs your attention</div>
        <div class="stack">
          ${setupCue + cueCards.join('') + invoiceCues.join('') + pendingRows.join('') || '<div class="card empty">Nothing needs your attention. 🎉</div>'}
        </div>

        <div class="eyebrow">Active clients</div>
        <div class="search-row">
          <input id="search" type="search" placeholder="Search clients, pets, breeds, phone…"
                 aria-label="Search clients and pets" value="${esc(query)}" />
          <button class="btn btn-quiet" data-nav="#/client-new">+ New client</button>
        </div>
        <div class="stack">
          ${activeRows.join('') || `<div class="card empty">${query ? 'No active clients match your search.' : 'No active clients yet — a client becomes active when their first contract is signed.'}</div>`}
        </div>
      </div>`;

    // search: debounce, re-render list on type
    let debounce;
    document.getElementById('search').oninput = (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => renderToday(e.target.value.trim()), 350);
    };
    wireNav();
    if (query) {
      const s = document.getElementById('search');
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    }
  }

  // ------------------------------------------------------------ clients ----
  async function renderClients(query = '') {
    appEl.innerHTML = header('clients') + `<div class="page loading">Loading clients…</div>`;
    let clients;
    try {
      [clients] = await Promise.all([
        api('GET', `/api/clients${query ? `?q=${encodeURIComponent(query)}` : ''}`),
        query ? ensureClientColors() : Promise.resolve(),
      ]);
    } catch (err) {
      toast(err.message);
      appEl.innerHTML = header('clients') + `<div class="page"><div class="empty">Couldn't load your clients. <a class="backlink" href="#/clients">Retry</a></div></div>`;
      return;
    }

    if (!query) assignClientColors(clients);

    const statusPill = {
      active: '<span class="pill pill-sage">active</span>',
      prospect: '<span class="pill pill-draft">pending</span>',
      inactive: '<span class="pill pill-alert">inactive</span>',
    };
    const row = (c) => `
      <div class="card client-row" data-nav="#/client/${c.id}" tabindex="0" role="link">
        <div class="avatar" style="background:${clientColor(c.id)}">${esc(initials(c.full_name))}</div>
        <div class="who">
          <div class="name">${esc(c.full_name)}</div>
          <div class="pets">${esc(petSummary(c.pets))}</div>
        </div>
        ${statusPill[c.status] ?? ''}
        <span class="chev">›</span>
      </div>`;
    const section = (label, list) =>
      list.length ? `<div class="eyebrow">${label}</div><div class="stack">${list.map(row).join('')}</div>` : '';

    appEl.innerHTML = header('clients') + `
      <div class="page">
        <h1 class="page-title">Clients</h1>
        <p class="page-sub">${clients.length} client${clients.length === 1 ? '' : 's'}</p>
        <div class="search-row">
          <input id="search" type="search" placeholder="Search clients, pets, breeds, phone…"
                 aria-label="Search clients and pets" value="${esc(query)}" />
          <button class="btn btn-quiet" data-nav="#/client-new">+ New client</button>
        </div>
        ${section('Active', clients.filter((c) => c.status === 'active'))}
        ${section('Pending', clients.filter((c) => c.status === 'prospect'))}
        ${section('Inactive', clients.filter((c) => c.status === 'inactive'))}
        ${clients.length === 0 ? `<div class="card empty">${query ? 'No clients match your search.' : 'No clients yet — add your first one.'}</div>` : ''}
      </div>`;

    let debounce;
    document.getElementById('search').oninput = (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => renderClients(e.target.value.trim()), 350);
    };
    wireNav();
    if (query) {
      const s = document.getElementById('search');
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    }
  }

  // -------------------------------------------------------- new client ----
  function renderNewClient() {
    appEl.innerHTML = header('clients') + `
      <div class="page">
        <a class="backlink" href="#/today">‹ Cancel</a>
        <h1 class="page-title" style="margin-top:8px">New client</h1>
        <p class="page-sub">Three steps — you can stop after any of them and finish later.</p>
        <div class="stepper">
          <span class="step on">1 · Client &amp; policies</span>
          <span class="step">2 · Pets</span>
          <span class="step">3 · First contract</span>
        </div>
        <form id="nc-form">
        <div class="card fieldset" style="margin-top:14px">
          <div class="form-grid">
            <div><label for="c-name">Full name</label><input id="c-name" required placeholder="e.g. Dana Whitfield" /></div>
            <div><label for="c-phone">Phone</label><input id="c-phone" data-phone placeholder="(555)000-0000" /></div>
            <div><label for="c-email">Email</label><input id="c-email" type="email" placeholder="name@example.com" /></div>
            <div><label for="c-status">Status</label>
              <select id="c-status">
                <option value="prospect">Pending (until first contract is signed)</option>
                <option value="active">Active</option>
              </select></div>
            <div class="full"><label for="c-address">Address</label><input id="c-address" placeholder="Street, city, state" /></div>
            <div><label for="c-ecname">Emergency contact</label><input id="c-ecname" placeholder="Name" /></div>
            <div><label for="c-ecphone">Emergency phone</label><input id="c-ecphone" data-phone placeholder="(555)000-0000" /></div>
            <div><label for="c-window">Cancellation notice <span class="hint">hours</span></label><input id="c-window" type="number" min="0" value="24" class="num" /></div>
            <div class="full"><label for="c-entry">Entry instructions <span class="hint">— private, never appears in contracts</span></label><input id="c-entry" placeholder="Lockbox code, gate, alarm…" /></div>
          </div>
        </div>
        <div class="form-foot">
          <button class="btn btn-ghost" type="button" data-nav="#/today">Cancel</button>
          <div class="spacer"></div>
          <button class="btn btn-primary" type="submit">Save &amp; add pets</button>
        </div>
        </form>
      </div>`;

    document.getElementById('nc-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          const val = (id) => document.getElementById(id).value.trim() || null;
          const client = await api('POST', '/api/clients', {
            full_name: document.getElementById('c-name').value.trim(),
            email: val('c-email'),
            phone: fmtPhone(val('c-phone')) || null,
            address: val('c-address'),
            emergency_contact_name: val('c-ecname'),
            emergency_contact_phone: fmtPhone(val('c-ecphone')) || null,
            cancellation_window_hours: Number(document.getElementById('c-window').value) || 0,
            entry_instructions: val('c-entry'),
            status: document.getElementById('c-status').value,
          });
          toast('Client saved. Step 2: add their pets.', 'ok');
          location.hash = `#/client/${client.id}?addpet=1`;
        } catch (err) {
          toast(err.message);
        }
      });
    };
    wireNav();
  }

  // ------------------------------------------------------ client detail ----
  async function renderClient(clientId, opts = {}) {
    appEl.innerHTML = header('clients') + `<div class="page loading">Loading client…</div>`;
    let client, contracts, invoices, billItems, services;
    try {
      [client, contracts, invoices, billItems, services] = await Promise.all([
        api('GET', `/api/clients/${clientId}`),
        api('GET', `/api/contracts?client_id=${clientId}`),
        api('GET', `/api/invoices?client_id=${clientId}`),
        api('GET', '/api/billable-items'),
        api('GET', `/api/services?client_id=${clientId}`),
      ]);
    } catch (err) {
      toast(err.message);
      location.hash = '#/today';
      return;
    }

    const petCards = client.pets.map((p) => `
      <div class="card pet-card" id="pet-card-${p.id}">
        <div class="pet-top">
          <div class="pet-photo">${PAW.replace('#1C4C64', 'transparent').replace('#F7F2EB', '#6D9280').replace('<circle cx="22" cy="22" r="22" fill="transparent"/>', '')}</div>
          <div>
            <div class="pet-name">${esc(p.name)}</div>
            <div class="pet-breed">${esc([p.breed, p.weight_lb ? `${p.weight_lb} lb` : null].filter(Boolean).join(' · ') || 'dog')}</div>
          </div>
          <div class="spacer"></div>
          <button class="btn btn-ghost" data-edit-pet="${p.id}" aria-label="Edit ${esc(p.name)}">✎</button>
        </div>
        <div class="pet-tags">
          ${p.behavior_notes ? `<span class="pill pill-draft">${esc(p.behavior_notes.slice(0, 40))}${p.behavior_notes.length > 40 ? '…' : ''}</span>` : ''}
          ${p.emergency_vet ? `<span class="pill pill-sage">vet on file</span>` : ''}
        </div>
      </div>`);

    const statusPill = {
      draft: '<span class="pill pill-draft">draft — awaiting signature</span>',
      sent: '<span class="pill pill-draft">sent — awaiting signature</span>',
      signed: '<span class="pill pill-sage">signed</span>',
      declined: '<span class="pill pill-alert">declined</span>',
      voided: '<span class="pill pill-alert">voided</span>',
    };
    const contractRows = contracts.map((k) => `
      <div class="card contract-row">
        <div class="what">
          <div class="title">${esc(k.contract_templates?.name ?? 'Service Agreement')}</div>
          <div class="meta">${k.status === 'signed'
            ? `Signed ${esc(fmtDate(k.signed_at))} by ${esc(k.signer_name ?? '')}`
            : `Generated ${esc(fmtDate(k.created_at))}`}</div>
        </div>
        ${statusPill[k.status] ?? ''}
        <div class="row-actions">
          ${k.status === 'draft' || k.status === 'sent' ? `
            <button class="btn btn-ghost" data-nav="#/client/${client.id}/new-contract?replace=${k.id}">Edit terms</button>
            <button class="btn btn-quiet" data-nav="#/contract/${k.id}/sign">Sign now</button>` : `
            <button class="btn btn-ghost" data-view-contract="${k.id}">View</button>`}
        </div>
      </div>`);

    const servicePill = {
      active: '<span class="pill pill-sage">active</span>',
      draft: '<span class="pill pill-draft">draft</span>',
      paused: '<span class="pill pill-draft">paused</span>',
      ended: '<span class="pill pill-alert">ended</span>',
    };
    const serviceRows = services.map((s) => `
      <div class="card contract-row" id="svc-row-${s.id}">
        <div class="what">
          <div class="title">${esc(s.name)}</div>
          <div class="meta">${esc(SERVICE_TYPES[s.service_type] ?? s.service_type)} · ${esc(fmtMoney(s.price_cents))} ${esc(CADENCES[s.billing_cadence] ?? s.billing_cadence)}${s.session_count ? ` · ${esc(s.session_count)} sessions` : ''}${s.duration_minutes ? ` · ${esc(s.duration_minutes)} min` : ''}${s.end_date ? ` · until ${esc(fmtDateOnly(s.end_date))}` : ''}${s.status === 'active' && s.next_invoice_date ? ` · next invoice ${esc(fmtDateOnly(s.next_invoice_date))}` : ''}</div>
        </div>
        ${servicePill[s.status] ?? ''}
        <div class="row-actions">
          ${s.status === 'active'
            ? `<button class="btn btn-ghost" data-until-service="${s.id}">${s.end_date ? 'Change end date' : 'Set end date'}</button>
               <button class="btn btn-ghost" data-pause-service="${s.id}">Pause</button>
               <button class="btn btn-ghost" data-end-service="${s.id}">End</button>
               <button class="btn btn-quiet" data-nav="#/appointment-new?client=${client.id}&service=${s.id}">Schedule</button>`
            : s.status === 'paused'
              ? `<button class="btn btn-ghost" data-end-service="${s.id}">End</button>
                 <button class="btn btn-quiet" data-resume-service="${s.id}">Resume</button>`
              : ''}
        </div>
      </div>`);

    const invoicePill = {
      draft: '<span class="pill pill-draft">draft</span>',
      open: '<span class="pill pill-draft">awaiting payment</span>',
      paid: '<span class="pill pill-sage">paid</span>',
      void: '<span class="pill pill-alert">void</span>',
      uncollectible: '<span class="pill pill-alert">uncollectible</span>',
    };
    const invoiceRows = invoices.map((inv) => `
      <div class="card contract-row">
        <div class="what">
          <div class="title">${esc(fmtMoney(inv.amount_cents))} — ${esc(inv.description || 'Services')}</div>
          <div class="meta">${inv.status === 'paid'
            ? `Paid ${esc(fmtDate(inv.paid_at))}`
            : `Created ${esc(fmtDate(inv.created_at))}${inv.due_date ? ` · due ${esc(fmtDate(inv.due_date))}` : ''}`}</div>
        </div>
        ${invoicePill[inv.status] ?? ''}
        <div class="row-actions">
          ${inv.status === 'open' || inv.status === 'draft' ? `
            <button class="btn btn-ghost" data-void-invoice="${inv.id}">Void</button>
            <button class="btn btn-quiet" data-checkout-invoice="${inv.id}">Collect payment</button>` : ''}
        </div>
      </div>`);

    // Tester feedback 2026-07-18: once a client has pets (or invoices), the
    // add-forms collapse behind a ＋ button so the profile reads as a record,
    // not a wall of empty forms.
    const petFormOpen = client.pets.length === 0 || Boolean(opts.addpet);
    const invFormOpen = invoices.length === 0;

    appEl.innerHTML = header('clients') + `
      <div class="page">
        <a class="backlink" href="#/clients">‹ All clients</a>
        <div class="detail-head">
          <div class="who">
            <h1 class="page-title">${esc(client.full_name)}</h1>
            <div class="contact-line">${[
              client.address ? esc(client.address) : null,
              client.phone ? `<a href="tel:${esc(client.phone.replace(/[^+\d]/g, ''))}">${esc(fmtPhone(client.phone))}</a>` : null,
              client.email ? `<a href="mailto:${esc(client.email)}">${esc(client.email)}</a>` : null,
            ].filter(Boolean).join(' · ') || 'No contact details yet'}</div>
            ${client.emergency_contact_name ? `<div class="contact-line">Emergency: ${esc(client.emergency_contact_name)}${client.emergency_contact_phone ? `, ${esc(fmtPhone(client.emergency_contact_phone))}` : ''}</div>` : ''}
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap">
            ${opts.edit ? '' : `<button class="btn btn-ghost" data-nav="#/client/${client.id}?edit=1">✎ Edit</button>`}
            <button class="btn btn-quiet" id="msg-client-btn">✉ Message</button>
            <button class="btn btn-quiet" data-nav="#/appointment-new?client=${client.id}">📅 Schedule</button>
            <button class="btn btn-primary" data-nav="#/client/${client.id}/new-contract">Generate contract</button>
          </div>
        </div>

        ${opts.edit ? `
        <div class="card fieldset" style="margin-top:14px" id="edit-client-card">
          <strong style="font-size:14px">Edit client</strong>
          <form id="ec-form"><div class="form-grid">
            <div><label for="ec-name">Full name</label><input id="ec-name" required value="${esc(client.full_name)}" /></div>
            <div><label for="ec-phone">Phone</label><input id="ec-phone" data-phone value="${esc(fmtPhone(client.phone ?? ''))}" placeholder="(555)000-0000" /></div>
            <div><label for="ec-email">Email</label><input id="ec-email" type="email" value="${esc(client.email ?? '')}" placeholder="name@example.com" /></div>
            <div class="full"><label for="ec-address">Address</label><input id="ec-address" value="${esc(client.address ?? '')}" placeholder="Street, city, state" /></div>
            <div><label for="ec-ecname">Emergency contact</label><input id="ec-ecname" value="${esc(client.emergency_contact_name ?? '')}" placeholder="Name" /></div>
            <div><label for="ec-ecphone">Emergency phone</label><input id="ec-ecphone" data-phone value="${esc(fmtPhone(client.emergency_contact_phone ?? ''))}" placeholder="(555)000-0000" /></div>
            <div><label for="ec-window">Cancellation notice <span class="hint">hours</span></label><input id="ec-window" type="number" min="0" value="${esc(client.cancellation_window_hours ?? 24)}" class="num" /></div>
            <div><label for="ec-noshow">No-show fee</label><input id="ec-noshow" class="money" value="${client.no_show_fee_cents ? esc(fmtMoney(client.no_show_fee_cents)) : ''}" placeholder="$0.00" /></div>
            <div class="full"><label for="ec-entry">Entry instructions <span class="hint">— private, never appears in contracts</span></label><input id="ec-entry" value="${esc(client.entry_instructions ?? '')}" placeholder="Lockbox code, gate, alarm…" /></div>
          </div>
          <p class="preview-note" style="margin:0">Edits change the live record only — already-signed contracts keep the details they were signed with.</p>
          <div class="form-foot" style="margin-top:0">
            <button class="btn btn-ghost" type="button" data-nav="#/client/${client.id}">Cancel</button>
            <div class="spacer"></div>
            <button class="btn btn-primary" type="submit">Save changes</button>
          </div></form>
        </div>` : ''}

        <div class="eyebrow">Policies</div>
        <div class="policy-grid">
          <div class="card policy"><div class="k">Cancellation notice</div><div class="v num">${esc(client.cancellation_window_hours ?? 24)} hours</div></div>
          <div class="card policy"><div class="k">Entry</div><div class="v small">${esc(client.entry_instructions || '—')}</div></div>
          <div class="card policy"><div class="k">Status</div><div class="v">
            ${client.status === 'active' ? '<span class="pill pill-sage">active</span>' : `<span class="pill pill-draft">${esc(client.status)}</span>`}
          </div></div>
        </div>

        <div class="eyebrow">Pets</div>
        <div class="pet-grid">${petCards.join('')}</div>
        ${client.pets.length === 0 ? '<div class="card empty">No pets yet — add the first one below.</div>' : ''}

        ${petFormOpen ? '' : `
        <div class="row-actions" style="margin-top:10px" id="addpet-toggle-row">
          <div class="spacer"></div>
          <button class="btn btn-ghost" id="addpet-toggle">＋ Add another pet</button>
        </div>`}
        <div class="card fieldset" style="margin-top:12px" id="addpet-card" ${petFormOpen ? '' : 'hidden'}>
          <strong style="font-size:14px">Add a pet</strong>
          <form id="pet-form"><div class="form-grid">
            <div><label for="p-name">Name</label><input id="p-name" required placeholder="e.g. Peanut" /></div>
            <div><label for="p-breed">Breed</label><input id="p-breed" placeholder="e.g. Beagle" /></div>
            <div><label for="p-weight">Weight <span class="hint">lb</span></label><input id="p-weight" type="number" min="1" max="500" step="0.1" class="num" /></div>
            <div><label for="p-vet">Emergency vet</label><input id="p-vet" placeholder="Clinic, phone" /></div>
            <div class="full"><label for="p-behavior">Behavior notes</label><input id="p-behavior" placeholder="e.g. pulls on leash, reactive to bikes" /></div>
          </div>
          <div class="form-foot" style="margin-top:0">
            <div class="spacer"></div>
            <button class="btn btn-quiet" type="submit">Add pet</button>
          </div></form>
        </div>

        <div class="eyebrow">Services</div>
        <div class="stack">${serviceRows.join('') || `<div class="card empty">No services yet — services come from a signed contract, so they'll appear here once ${esc(client.full_name.split(' ')[0])} signs one.</div>`}</div>
        <div class="row-actions" style="margin-top:10px">
          <div class="spacer"></div>
          <button class="btn btn-ghost" data-nav="#/client/${client.id}/new-contract">＋ Add services</button>
        </div>

        <div class="eyebrow">Contracts</div>
        <div class="stack">${contractRows.join('') || '<div class="card empty">No contracts yet — generate the first one with the button above.</div>'}</div>

        <div class="eyebrow">Billing</div>
        <div class="stack">${invoiceRows.join('') || '<div class="card empty">No invoices yet — create the first one below.</div>'}</div>

        ${invFormOpen ? '' : `
        <div class="row-actions" style="margin-top:10px" id="newinv-toggle-row">
          <div class="spacer"></div>
          <button class="btn btn-ghost" id="newinv-toggle">＋ New invoice</button>
        </div>`}
        <div class="card fieldset" style="margin-top:12px" id="newinv-card" ${invFormOpen ? '' : 'hidden'}>
          <strong style="font-size:14px">New invoice</strong>
          <form id="inv-form"><div class="form-grid">
            <div><label for="inv-item">Bill for</label>
              <select id="inv-item">
                ${billItems.map((i) => `<option value="${i.id}">${esc(i.name)} — ${fmtMoney(i.unit_amount_cents)}${i.billing_period === 'one_time' ? '' : ` / ${esc(i.billing_period)}`}</option>`).join('')}
                <option value="">Custom amount…</option>
              </select></div>
            <div id="inv-qty-wrap"><label for="inv-qty">Quantity <span class="hint">e.g. number of visits</span></label>
              <input id="inv-qty" type="number" min="1" max="1000" value="1" class="num" /></div>
            <div id="inv-amount-wrap" hidden><label for="inv-amount">Amount</label>
              <input id="inv-amount" class="money" placeholder="$30.00" /></div>
            <div class="full" id="inv-desc-wrap" hidden><label for="inv-desc">Description <span class="hint">— appears on the payment page</span></label>
              <input id="inv-desc" placeholder="e.g. Week of July 14 — 3 private walks" /></div>
            <div class="full" id="inv-save-wrap" hidden><label style="display:flex; gap:8px; align-items:center; text-transform:none; letter-spacing:0">
              <input type="checkbox" id="inv-save" style="width:auto" /> Save as a reusable billable item</label></div>
          </div>
          <div class="form-foot" style="margin-top:0">
            <div class="spacer"></div>
            <button class="btn btn-quiet" type="submit">Create invoice</button>
          </div></form>
        </div>
      </div>`;

    // ------------------------------------------------------ client edit --
    const ecForm = document.getElementById('ec-form');
    if (ecForm) {
      ecForm.onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        await withBusy(btn, async () => {
          try {
            const val = (id) => document.getElementById(id).value.trim() || null;
            await api('PATCH', `/api/clients/${clientId}`, {
              full_name: document.getElementById('ec-name').value.trim(),
              email: val('ec-email'),
              phone: fmtPhone(val('ec-phone')) || null,
              address: val('ec-address'),
              emergency_contact_name: val('ec-ecname'),
              emergency_contact_phone: fmtPhone(val('ec-ecphone')) || null,
              cancellation_window_hours: Number(document.getElementById('ec-window').value) || 0,
              no_show_fee_cents: parseMoney(document.getElementById('ec-noshow').value) ?? 0,
              entry_instructions: val('ec-entry'),
            });
            toast('Client updated.', 'ok');
            location.hash = `#/client/${clientId}`;
          } catch (err) {
            toast(err.message);
          }
        });
      };
    }

    // ------------------------------------------- collapsed add-forms --
    // Opening reveals the form and removes the button — the button's whole
    // job was standing in for the form.
    const wireToggle = (btnId, cardId, focusId) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.onclick = () => {
        document.getElementById(cardId).hidden = false;
        btn.closest('.row-actions').remove();
        document.getElementById(focusId).focus();
      };
    };
    wireToggle('addpet-toggle', 'addpet-card', 'p-name');
    wireToggle('newinv-toggle', 'newinv-card', 'inv-item');

    // --------------------------------------------------------- pet edit --
    const petsById = Object.fromEntries(client.pets.map((p) => [p.id, p]));
    document.querySelectorAll('[data-edit-pet]').forEach((editBtn) => {
      editBtn.onclick = () => {
        const p = petsById[editBtn.dataset.editPet];
        const card = document.getElementById(`pet-card-${p.id}`);
        card.innerHTML = `
          <form class="pet-edit-form"><div class="form-grid">
            <div><label for="pe-name-${p.id}">Name</label><input id="pe-name-${p.id}" required value="${esc(p.name)}" /></div>
            <div><label for="pe-breed-${p.id}">Breed</label><input id="pe-breed-${p.id}" value="${esc(p.breed ?? '')}" placeholder="e.g. Beagle" /></div>
            <div><label for="pe-weight-${p.id}">Weight <span class="hint">lb</span></label><input id="pe-weight-${p.id}" type="number" min="1" max="500" step="0.1" class="num" value="${esc(p.weight_lb ?? '')}" /></div>
            <div><label for="pe-vet-${p.id}">Emergency vet</label><input id="pe-vet-${p.id}" value="${esc(p.emergency_vet ?? '')}" placeholder="Clinic, phone" /></div>
            <div class="full"><label for="pe-behavior-${p.id}">Behavior notes</label><input id="pe-behavior-${p.id}" value="${esc(p.behavior_notes ?? '')}" placeholder="e.g. pulls on leash, reactive to bikes" /></div>
          </div>
          <div class="form-foot" style="margin-top:0">
            <button class="btn btn-ghost" type="button" data-cancel-pet-edit>Cancel</button>
            <div class="spacer"></div>
            <button class="btn btn-quiet" type="submit">Save</button>
          </div></form>`;
        card.querySelector('[data-cancel-pet-edit]').onclick = () => renderClient(clientId);
        card.querySelector('form').onsubmit = async (e) => {
          e.preventDefault();
          const btn = e.target.querySelector('button[type=submit]');
          await withBusy(btn, async () => {
            try {
              const val = (id) => document.getElementById(id).value.trim() || null;
              const weight = document.getElementById(`pe-weight-${p.id}`).value;
              await api('PATCH', `/api/pets/${p.id}`, {
                name: document.getElementById(`pe-name-${p.id}`).value.trim(),
                breed: val(`pe-breed-${p.id}`),
                weight_lb: weight ? Number(weight) : null,
                emergency_vet: val(`pe-vet-${p.id}`),
                behavior_notes: val(`pe-behavior-${p.id}`),
              });
              toast('Pet updated.', 'ok');
              renderClient(clientId);
            } catch (err) {
              toast(err.message);
            }
          });
        };
      };
    });

    document.getElementById('msg-client-btn').onclick = (e) =>
      withBusy(e.target, async () => {
        try {
          const thread = await api('POST', '/api/threads', { client_id: clientId });
          location.hash = `#/messages/${thread.id}`;
        } catch (err) {
          toast(err.message);
        }
      });

    document.getElementById('pet-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          const val = (id) => document.getElementById(id).value.trim() || null;
          const weight = document.getElementById('p-weight').value;
          await api('POST', `/api/clients/${clientId}/pets`, {
            name: document.getElementById('p-name').value.trim(),
            breed: val('p-breed'),
            weight_lb: weight ? Number(weight) : null,
            emergency_vet: val('p-vet'),
            behavior_notes: val('p-behavior'),
          });
          toast('Pet added.', 'ok');
          renderClient(clientId);
        } catch (err) {
          toast(err.message);
        }
      });
    };
    // --------------------------------------------------------- services --
    // W-7/W-8: no ad-hoc "add service" form here any more. Services are born
    // from a signed contract, and "＋ Add services" routes into that same flow
    // — an unsigned add button quietly reintroduces exactly the drift W-5…W-7
    // exist to fix (a service on the profile the client never agreed a price
    // for). The API endpoint still exists for scripts and seeded data.
    // W-13: pause / resume / end / extend, all over PATCH /api/services.
    // Booking on a paused or ended service already 409s server-side; already-
    // booked walks stay on the schedule, so ending warns about them instead
    // of quietly leaving orphans the walker forgot about.
    const upcomingWalkCount = async (serviceId) => {
      try {
        const appts = await api(
          'GET',
          `/api/appointments?client_id=${clientId}&status=scheduled&from=${encodeURIComponent(new Date().toISOString())}`
        );
        return appts.filter((a) => a.service_id === serviceId).length;
      } catch {
        return 0; // the warning is best-effort — never block the action on it
      }
    };
    document.querySelectorAll('[data-end-service]').forEach((btn) => {
      btn.onclick = () =>
        withBusy(btn, async () => {
          try {
            const n = await upcomingWalkCount(btn.dataset.endService);
            const walks = n
              ? ` ${n} upcoming walk${n === 1 ? ' is' : 's are'} still booked and will stay on the schedule — cancel ${n === 1 ? 'it' : 'them'} from the Schedule tab if ${n === 1 ? "it shouldn't" : "they shouldn't"} happen.`
              : '';
            if (!confirm(`End this service? Its history stays on record, but new walks can't be booked on it.${walks}`)) return;
            await api('PATCH', `/api/services/${btn.dataset.endService}`, { status: 'ended' });
            toast('Service ended — its history stays on record.', 'ok');
            renderClient(clientId);
          } catch (err) {
            toast(err.message);
          }
        });
    });
    document.querySelectorAll('[data-pause-service]').forEach((btn) => {
      btn.onclick = () =>
        withBusy(btn, async () => {
          try {
            const n = await upcomingWalkCount(btn.dataset.pauseService);
            await api('PATCH', `/api/services/${btn.dataset.pauseService}`, { status: 'paused' });
            toast(
              `Service paused — new walks can't be booked until you resume it.${n ? ` ${n} already-booked walk${n === 1 ? '' : 's'} stay${n === 1 ? 's' : ''} on the schedule.` : ''}`,
              'ok'
            );
            renderClient(clientId);
          } catch (err) {
            toast(err.message);
          }
        });
    });
    document.querySelectorAll('[data-resume-service]').forEach((btn) => {
      btn.onclick = () =>
        withBusy(btn, async () => {
          try {
            await api('PATCH', `/api/services/${btn.dataset.resumeService}`, { status: 'active' });
            toast('Service resumed — booking is open again.', 'ok');
            renderClient(clientId);
          } catch (err) {
            toast(err.message);
          }
        });
    });
    // Extend (or set / clear) the service's end date, inline in the row.
    document.querySelectorAll('[data-until-service]').forEach((btn) => {
      btn.onclick = () => {
        const s = services.find((x) => x.id === btn.dataset.untilService);
        const actions = document.getElementById(`svc-row-${s.id}`).querySelector('.row-actions');
        actions.innerHTML = `
          <input type="date" id="svc-until-${s.id}" value="${esc(s.end_date ?? '')}" aria-label="Service end date" />
          ${s.end_date ? `<button class="btn btn-ghost" data-clear-until>No end date</button>` : ''}
          <button class="btn btn-ghost" data-cancel-until>Cancel</button>
          <button class="btn btn-quiet" data-save-until>Save</button>`;
        actions.querySelector('[data-cancel-until]').onclick = () => renderClient(clientId);
        const clearBtn = actions.querySelector('[data-clear-until]');
        if (clearBtn) {
          clearBtn.onclick = () =>
            withBusy(clearBtn, async () => {
              try {
                await api('PATCH', `/api/services/${s.id}`, { end_date: null });
                toast('End date removed — the service runs until you end it.', 'ok');
                renderClient(clientId);
              } catch (err) {
                toast(err.message);
              }
            });
        }
        actions.querySelector('[data-save-until]').onclick = (e) =>
          withBusy(e.target, async () => {
            const v = document.getElementById(`svc-until-${s.id}`).value;
            if (!v) { toast('Pick a date, or Cancel.'); return; }
            try {
              await api('PATCH', `/api/services/${s.id}`, { end_date: v });
              toast(`Service runs until ${fmtDateOnly(v)}.`, 'ok');
              renderClient(clientId);
            } catch (err) {
              toast(err.message);
            }
          });
      };
    });

    // ---------------------------------------------------------- billing --
    // "Bill for" select: a saved item shows quantity; a custom amount shows
    // description + amount + the save-as-item checkbox.
    const invItem = document.getElementById('inv-item');
    function syncInvoiceFields() {
      const custom = invItem.value === '';
      document.getElementById('inv-qty-wrap').hidden = custom;
      document.getElementById('inv-amount-wrap').hidden = !custom;
      document.getElementById('inv-desc-wrap').hidden = !custom;
      document.getElementById('inv-save-wrap').hidden = !custom;
    }
    invItem.onchange = syncInvoiceFields;
    syncInvoiceFields();

    document.getElementById('inv-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          let body;
          if (invItem.value) {
            body = {
              client_id: clientId,
              billable_item_id: invItem.value,
              quantity: Number(document.getElementById('inv-qty').value) || 1,
            };
          } else {
            const amount = parseMoney(document.getElementById('inv-amount').value);
            const description = document.getElementById('inv-desc').value.trim();
            if (!amount) { toast('Enter an amount, e.g. $30.00'); return; }
            if (!description) { toast('Enter a description for the invoice.'); return; }
            if (document.getElementById('inv-save').checked) {
              // Save as reusable first (creates the Stripe product), then
              // invoice from it so the item and invoice stay linked.
              const item = await api('POST', '/api/billable-items', {
                name: description,
                unit_amount_cents: amount,
                billing_period: 'one_time',
              });
              body = { client_id: clientId, billable_item_id: item.id, quantity: 1 };
            } else {
              body = { client_id: clientId, amount_cents: amount, description };
            }
          }
          await api('POST', '/api/invoices', body);
          toast('Invoice created.', 'ok');
          renderClient(clientId);
        } catch (err) {
          toast(err.message);
        }
      });
    };

    document.querySelectorAll('[data-checkout-invoice]').forEach((btn) => {
      btn.onclick = () =>
        withBusy(btn, async () => {
          try {
            const { checkout_url } = await api('POST', `/api/invoices/${btn.dataset.checkoutInvoice}/checkout`);
            // Off to Stripe's hosted payment page; it redirects back to
            // #/invoice/:id/return when done.
            window.location.href = checkout_url;
          } catch (err) {
            toast(err.message);
          }
        });
    });
    document.querySelectorAll('[data-void-invoice]').forEach((btn) => {
      btn.onclick = () =>
        withBusy(btn, async () => {
          try {
            await api('POST', `/api/invoices/${btn.dataset.voidInvoice}/void`);
            toast('Invoice voided.', 'ok');
            renderClient(clientId);
          } catch (err) {
            toast(err.message);
          }
        });
    });

    wireNav();
    wireContractViews();
    if (opts.addpet) document.getElementById('p-name').focus();
  }

  // ------------------------------------------------- payment return page ----
  // Stripe Checkout redirects here. The webhook normally records the payment;
  // the sync call makes the confirmation independent of webhook timing.
  async function renderInvoiceReturn(invoiceId, canceled) {
    appEl.innerHTML = header('clients') + `<div class="page loading">Confirming payment…</div>`;
    let invoice;
    try {
      invoice = await api('GET', `/api/invoices/${invoiceId}`);
    } catch (err) {
      toast(err.message);
      location.hash = '#/today';
      return;
    }
    if (canceled) {
      toast('Payment canceled — the invoice is still open.', 'error');
      location.hash = `#/client/${invoice.client_id}`;
      return;
    }
    for (let attempt = 0; attempt < 5 && invoice.status !== 'paid'; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
      try {
        invoice = await api('POST', `/api/invoices/${invoiceId}/sync`);
      } catch (err) {
        toast(err.message);
        break;
      }
    }
    const paid = invoice.status === 'paid';
    appEl.innerHTML = header('clients') + `
      <div class="page">
        ${paid
          ? `<div class="success-banner">✓ Payment received — ${esc(fmtMoney(invoice.amount_cents))} for ${esc(invoice.description || 'services')}${invoice.paid_at ? `, ${esc(fmtDate(invoice.paid_at))}` : ''}</div>`
          : `<div class="card empty">Payment hasn't been confirmed yet. If you completed checkout, give it a moment and refresh — the invoice updates automatically once Stripe reports it paid.</div>`}
        <div style="margin-top:16px">
          <button class="btn btn-primary" data-nav="#/client/${invoice.client_id}">Back to client</button>
        </div>
      </div>`;
    wireNav();
  }

  // -------------------------------------------------------- new contract ----
  async function renderNewContract(clientId, replaceId) {
    appEl.innerHTML = header('clients') + `<div class="page loading">Preparing contract…</div>`;
    let client, templates;
    try {
      client = await api('GET', `/api/clients/${clientId}`);
      // Seed is idempotent and copies every packaged template, so accounts
      // that predate a newly packaged one (e.g. the Pet Services Agreement)
      // pick it up here rather than being stuck with what they signed up with.
      await api('POST', '/api/contract-templates/seed', {});
      templates = await api('GET', '/api/contract-templates');
    } catch (err) {
      toast(err.message);
      location.hash = `#/client/${clientId}`;
      return;
    }

    // Every service is for a pet (W-5), so a contract can't be written before
    // there's one to name. Send them back with the reason rather than showing
    // a form whose first field is empty and unfillable.
    if (client.pets.length === 0) {
      toast(`Add ${client.full_name.split(' ')[0]}'s pet first — every service on a contract is for a specific pet.`);
      location.hash = `#/client/${clientId}`;
      return;
    }

    appEl.innerHTML = header('clients') + `
      <div class="page">
        <a class="backlink" href="#/client/${client.id}">‹ ${esc(client.full_name)}</a>
        <h1 class="page-title" style="margin-top:8px">${replaceId ? 'Edit contract terms' : 'New contract'}</h1>
        <p class="page-sub">${replaceId
          ? 'Generates a fresh draft with the new terms; the old draft is voided automatically.'
          : 'Client and pet details fill in automatically — you only set the service terms.'}</p>

        <form id="k-form">
        <div class="card fieldset" style="margin-top:18px">
          <strong style="font-size:14px">Services</strong>
          <p class="page-sub" style="margin:4px 0 12px">What ${esc(client.full_name.split(' ')[0])} is buying. These appear on their profile once the contract is signed.</p>
          <div id="k-services"></div>
          <button class="btn btn-ghost" type="button" id="k-add-service" style="margin-top:8px">＋ Add another service</button>
        </div>

        <div class="card fieldset" style="margin-top:12px">
          <div class="form-grid">
            <div class="full"><label for="k-template">Template</label>
              <select id="k-template">${templates.map((t) => `<option value="${t.id}"${t.name === 'Pet Services Agreement' ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
            <div class="full"><label for="k-sched">Schedule <span class="hint">— written out, e.g. "Mon/Wed/Fri, 30-minute midday walk"</span></label>
              <input id="k-sched" required placeholder="Mon/Wed/Fri, 30-minute midday walk" /></div>
            <div><label for="k-start">First day of service</label><input id="k-start" type="date" required /></div>
            <div><label for="k-fee">Late-cancel / no-show fee <span class="hint">— appears as a contract clause</span></label>
              <input id="k-fee" required class="money" value="$25.00" /></div>
            <div><label for="k-vetcap">Emergency vet spending cap</label><input id="k-vetcap" required class="money" value="$500.00" /></div>
            <div><label>Photos in marketing</label>
              <div class="seg" role="group" aria-label="Photo consent" id="k-photo">
                <button type="button" aria-pressed="true" data-value="Yes">Client consents</button>
                <button type="button" aria-pressed="false" data-value="No">No</button>
              </div></div>
            <div class="full"><label for="k-keys">Keys &amp; access</label>
              <input id="k-keys" required value="No keys held — Client provides access at each visit" /></div>
          </div>
          <p class="preview-note">Cancellation window (${esc(client.cancellation_window_hours ?? 24)} hours) comes from ${esc(client.full_name.split(' ')[0])}'s profile. Pets, contact details, and your business name fill in from records on file.</p>
        </div>
        <div class="form-foot">
          <button class="btn btn-ghost" type="button" data-nav="#/client/${client.id}">Cancel</button>
          <div class="spacer"></div>
          <button class="btn btn-primary" type="submit">Generate &amp; preview</button>
        </div>
        </form>
      </div>`;

    // segmented controls
    for (const segId of ['k-photo']) {
      document.getElementById(segId).querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          b.parentElement.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
        };
      });
    }
    const segValue = (id) =>
      document.getElementById(id).querySelector('button[aria-pressed="true"]').dataset.value;

    // ------------------------------------------------- service blocks (W-5/6) --
    // Field order is deliberate: Pet first. "Which dog is this for" is the
    // question the old client-profile form never asked, and it's what makes
    // the rest of the block make sense.
    const servicesEl = document.getElementById('k-services');
    let serviceSeq = 0;

    const addServiceBlock = () => {
      const n = serviceSeq++;
      const block = document.createElement('div');
      block.className = 'card fieldset';
      block.style.cssText = 'margin-bottom:10px;background:transparent';
      block.dataset.serviceBlock = String(n);
      block.innerHTML = `
        <div class="row-actions" style="justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong style="font-size:13px" data-block-title>Service ${n + 1}</strong>
          <button class="btn btn-quiet" type="button" data-remove-service hidden>Remove</button>
        </div>
        <div class="form-grid">
          <div class="full"><label>Pet <span class="hint">— one walk covering two dogs is one service</span></label>
            <div class="row-actions" style="flex-wrap:wrap;gap:10px" data-pets>
              ${client.pets.map((p) => `
                <label style="display:flex;align-items:center;gap:6px;font-weight:400">
                  <input type="checkbox" value="${p.id}" ${client.pets.length === 1 ? 'checked' : ''} />
                  ${esc(p.name)}
                </label>`).join('')}
            </div></div>
          <div><label for="ks-type-${n}">Type</label>
            <select id="ks-type-${n}" data-f="type">${typeOptionsHtml()}</select></div>
          <div><label for="ks-price-${n}">Price</label>
            <input id="ks-price-${n}" data-f="price" required class="money" placeholder="$30.00" /></div>
          <div><label for="ks-sessions-${n}"># of sessions <span class="hint">— for packages, optional</span></label>
            <input id="ks-sessions-${n}" data-f="sessions" type="number" min="1" max="500" class="num" placeholder="e.g. 10" /></div>
          <div><label for="ks-cadence-${n}">Billed</label>
            <select id="ks-cadence-${n}" data-f="cadence">${cadenceOptionsHtml(offeredTypes()[0])}</select></div>
          <div><label for="ks-duration-${n}">Duration <span class="hint">minutes</span></label>
            <input id="ks-duration-${n}" data-f="duration" type="number" min="5" max="1440" value="30" class="num" /></div>
          <div class="full"><label for="ks-notes-${n}">Notes</label>
            <textarea id="ks-notes-${n}" data-f="notes" rows="2" placeholder="Anything specific about this service…"></textarea></div>
        </div>`;
      servicesEl.appendChild(block);
      wireTypeToCadence(`ks-type-${n}`, `ks-cadence-${n}`);
      block.querySelector('[data-remove-service]').onclick = () => {
        block.remove();
        renumberServiceBlocks();
      };
      renumberServiceBlocks();
    };

    // Titles and the Remove affordance depend on how many blocks exist, so
    // they're recomputed rather than baked in at creation.
    const renumberServiceBlocks = () => {
      const blocks = [...servicesEl.querySelectorAll('[data-service-block]')];
      blocks.forEach((b, i) => {
        b.querySelector('[data-block-title]').textContent = `Service ${i + 1}`;
        // Nothing to remove when it's the only one — a contract with no
        // services is what W-5…W-7 exist to prevent.
        b.querySelector('[data-remove-service]').hidden = blocks.length === 1;
      });
    };

    document.getElementById('k-add-service').onclick = addServiceBlock;
    addServiceBlock();

    /** Read the blocks into the API's services[] shape, or throw for the toast. */
    const readServiceBlocks = () =>
      [...servicesEl.querySelectorAll('[data-service-block]')].map((block, i) => {
        const field = (f) => block.querySelector(`[data-f="${f}"]`);
        const petIds = [...block.querySelectorAll('[data-pets] input:checked')].map((c) => c.value);
        if (petIds.length === 0) throw new Error(`Service ${i + 1}: choose which pet it's for.`);
        const price = parseMoney(field('price').value);
        if (!price) throw new Error(`Service ${i + 1}: enter a price, e.g. $30.00`);
        return {
          service_type: field('type').value,
          price_cents: price,
          billing_cadence: field('cadence').value,
          session_count: Number(field('sessions').value) || null,
          duration_minutes: Number(field('duration').value) || null,
          description: field('notes').value.trim() || null,
          pet_ids: petIds,
        };
      });

    document.getElementById('k-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          const startDate = new Date(`${document.getElementById('k-start').value}T00:00:00`)
            .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          const result = await api('POST', '/api/contracts', {
            template_id: document.getElementById('k-template').value,
            client_id: client.id,
            services: readServiceBlocks(),
            variables: {
              // walk_type and service_price are derived from the services now
              // (W-5) — the server fills them, so they're deliberately absent.
              photo_consent: segValue('k-photo'),
              service_schedule: document.getElementById('k-sched').value.trim(),
              start_date: startDate,
              no_show_fee: document.getElementById('k-fee').value.trim(),
              emergency_vet_cap: document.getElementById('k-vetcap').value.trim(),
              key_handling: document.getElementById('k-keys').value.trim(),
            },
          });
          if (result.unresolved_placeholders.length > 0) {
            toast(`Heads up — unfilled placeholders: ${result.unresolved_placeholders.join(', ')}`);
          }
          if (replaceId) {
            // Old draft is superseded; voiding keeps the contract list honest.
            try { await api('PATCH', `/api/contracts/${replaceId}`, { status: 'voided' }); } catch { /* non-fatal */ }
          }
          location.hash = `#/contract/${result.contract.id}/sign`;
        } catch (err) {
          toast(err.message);
        }
      });
    };
    wireNav();
  }

  // ------------------------------------------------------------ signing ----
  async function renderSign(contractId) {
    appEl.innerHTML = header('clients') + `<div class="page loading">Loading contract…</div>`;
    let contract, client;
    try {
      contract = await api('GET', `/api/contracts/${contractId}`);
      client = await api('GET', `/api/clients/${contract.client_id}`);
    } catch (err) {
      toast(err.message);
      location.hash = '#/today';
      return;
    }
    const signed = contract.status === 'signed';
    const signable = contract.status === 'draft' || contract.status === 'sent';

    appEl.innerHTML = header('clients') + `
      <div class="page">
        ${signed ? `<div class="success-banner">✓ Signed ${esc(fmtDate(contract.signed_at))} by ${esc(contract.signer_name ?? '')} — locked, cannot be edited.</div>` : ''}
        <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap">
          <a class="backlink" href="#/client/${client.id}">‹ ${esc(client.full_name)}</a>
          <span style="flex:1"></span>
          ${signable ? `<button class="btn btn-ghost" data-nav="#/client/${client.id}/new-contract?replace=${contract.id}">✎ Edit terms</button>` : ''}
          ${signed ? `
            <button class="btn btn-ghost" id="doc-download">⬇ Download</button>
            <button class="btn btn-quiet" id="doc-print">🖨 Print / save as PDF</button>
            <button class="btn btn-primary" data-nav="#/appointment-new?client=${client.id}">📅 Schedule walks</button>` : ''}
        </div>
        <h1 class="page-title" style="margin-top:8px">${signed ? 'Signed contract' : 'Sign contract'}</h1>
        ${signable ? `<p class="page-sub">Still a draft — every term can be edited until the moment it's signed. Hand the device to your client to review and sign.</p>` : ''}

        <div class="sign-layout">
          ${PetPro.contractPane({ frameTitle: 'Contract document' })}
          ${signable ? PetPro.signPadCard({
            nameLabel: "Signer's full name",
            nameValue: client.full_name,
            nameError: "Please enter the signer's name.",
            lockNote: 'Signing locks this contract permanently. The signed copy can never be altered — by anyone.',
            submitLabel: 'Sign & lock contract',
          }) : ''}
        </div>
      </div>`;

    PetPro.wireContractPane(contract.generated_html);

    // W-1: the copy the client keeps. The document endpoint needs the auth
    // header, so fetch it first, then print or download the result.
    if (signed) {
      const fetchDocument = async () => {
        const res = await fetch(`/api/contracts/${contractId}/document`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Could not load the contract document.');
        return res.text();
      };
      document.getElementById('doc-print').onclick = (e) =>
        withBusy(e.target, async () => {
          try {
            // Print through a hidden iframe — no popup, so no popup blocker.
            // The browser's Print dialog does paper or "Save as PDF".
            const html = await fetchDocument();
            const frame = document.createElement('iframe');
            frame.style.cssText = 'position:fixed;right:100%;bottom:100%;width:8.5in;height:11in;border:0';
            frame.setAttribute('aria-hidden', 'true');
            frame.srcdoc = html;
            frame.onload = () => {
              frame.contentWindow.focus();
              frame.contentWindow.print();
              // Keep it alive while the dialog is up; clean up afterwards.
              setTimeout(() => frame.remove(), 60_000);
            };
            document.body.appendChild(frame);
          } catch (err) { toast(err.message); }
        });
      document.getElementById('doc-download').onclick = (e) =>
        withBusy(e.target, async () => {
          try {
            const blobUrl = URL.createObjectURL(new Blob([await fetchDocument()], { type: 'text/html' }));
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `signed-agreement-${client.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
          } catch (err) { toast(err.message); }
        });
    }

    if (!signable) { wireNav(); return; }

    // ------------------------------------------------- signature canvas --
    const sigPad = PetPro.createSignaturePad();

    document.getElementById('sig-submit').onclick = async (e) => {
      const name = sigPad.validate();
      if (!name) return;

      await withBusy(e.target, async () => {
        try {
          await api('POST', `/api/contracts/${contractId}/sign`, {
            signer_name: name,
            signature_image: sigPad.dataUrl(),
          });
          // First signed contract makes a pending client active.
          if (client.status === 'prospect') {
            try { await api('PATCH', `/api/clients/${client.id}`, { status: 'active' }); } catch { /* non-fatal */ }
          }
          toast('Contract signed and locked.', 'ok');
          renderSign(contractId);
        } catch (err) {
          // Signing failed — nothing was locked; the signature stays on
          // the pad so they can simply press the button again.
          toast(`${err.message} Your signature is still here — try again.`);
        }
      });
    };
    wireNav();
  }

  // --------------------------------------------- signed contract viewer ----
  function wireContractViews() {
    document.querySelectorAll('[data-view-contract]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const k = await api('GET', `/api/contracts/${btn.dataset.viewContract}`);
          location.hash = `#/contract/${k.id}/sign`;
        } catch (err) {
          toast(err.message);
        }
      };
    });
  }

  // ----------------------------------------------------------- schedule ----
  async function renderSchedule(weekOffset = 0) {
    appEl.innerHTML = header('schedule') + `<div class="page loading">Loading schedule…</div>`;
    const weekStart = new Date(startOfWeek(new Date()).getTime() + weekOffset * 7 * DAY_MS);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
    let appts;
    try {
      [appts] = await Promise.all([
        api('GET', `/api/appointments?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`),
        ensureClientColors(),
      ]);
    } catch (err) {
      toast(err.message);
      appEl.innerHTML = header('schedule') + `<div class="page"><div class="empty">Couldn't load the schedule. <a class="backlink" href="#/schedule">Retry</a></div></div>`;
      return;
    }

    const apptPill = {
      scheduled: '<span class="pill pill-draft">scheduled</span>',
      completed: '<span class="pill pill-sage">completed</span>',
      cancelled: '<span class="pill pill-alert">cancelled</span>',
      no_show: '<span class="pill pill-alert">no-show</span>',
    };
    const todayKey = new Date().toDateString();

    const daySections = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(weekStart.getTime() + i * DAY_MS);
      const dayAppts = appts.filter((a) => new Date(a.starts_at).toDateString() === day.toDateString());
      const isToday = day.toDateString() === todayKey;
      const rows = dayAppts.map((a) => {
        const inSeries = a.recurrence_rule || a.recurrence_parent_id;
        const done = a.status === 'completed';
        return `
        <div class="card appt-row client-stripe${a.status === 'cancelled' ? ' appt-cancelled' : ''}" style="border-left-color:${clientColor(a.client_id)}">
          <div class="appt-main">
            <div class="appt-time num">${esc(fmtTime(a.starts_at))}–${esc(fmtTime(a.ends_at))}</div>
            <div class="what">
              <div class="title">${esc(a.clients?.full_name ?? 'Client')} — ${esc(a.services?.name ?? 'Service')}</div>
              <div class="meta">${inSeries ? '↻ weekly · ' : ''}${esc(a.services ? fmtMoney(a.services.price_cents) : '')}${a.services ? ` ${esc(CADENCES[a.services.billing_cadence] ?? '')}` : ''}${a.notes ? ` · ${esc(a.notes)}` : ''}${done && a.completion_notes ? ` · “${esc(a.completion_notes)}”` : ''}${done ? `${a.good_dog ? ' · good dog 🐶' : ''}${a.got_a_treat ? ' · got a treat 🦴' : ''}` : ''}</div>
            </div>
            ${apptPill[a.status] ?? ''}
            <div class="row-actions">
              ${a.status === 'scheduled' ? `
                <button class="btn btn-ghost" data-cancel-appt="${a.id}">Cancel</button>
                ${inSeries ? `<button class="btn btn-ghost" data-cancel-series="${a.id}">End series</button>` : ''}
                <button class="btn btn-quiet" data-complete-appt="${a.id}">Mark complete</button>` : ''}
            </div>
          </div>
          ${a.status === 'scheduled' ? `
          <form class="complete-form" id="cf-${a.id}" hidden>
            <div class="form-grid">
              <div><label for="cf-start-${a.id}">Actually started</label>
                <input id="cf-start-${a.id}" type="datetime-local" value="${toLocalInput(a.starts_at)}" /></div>
              <div><label for="cf-end-${a.id}">Actually ended</label>
                <input id="cf-end-${a.id}" type="datetime-local" value="${toLocalInput(a.ends_at)}" /></div>
              <div class="full"><label for="cf-notes-${a.id}">Walk notes <span class="hint">— goes in the walk report</span></label>
                <input id="cf-notes-${a.id}" placeholder="e.g. Full loop around the park, lots of squirrel patrol" /></div>
              <div class="full appt-flags">
                <label class="flag"><input type="checkbox" id="cf-good-${a.id}" checked /> Were they a good dog? 🐶</label>
                <label class="flag"><input type="checkbox" id="cf-treat-${a.id}" checked /> Did they get a treat? 🦴</label>
              </div>
            </div>
            <div class="form-foot" style="margin-top:12px">
              <button class="btn btn-ghost" type="button" data-close-complete="${a.id}">Back</button>
              <div class="spacer"></div>
              <button class="btn btn-primary" type="submit">Complete${a.services?.billing_cadence === 'per_visit'
                ? ` & invoice ${esc(fmtMoney(a.services.price_cents))}`
                : a.services?.billing_cadence === 'per_day'
                  ? ` & invoice ${esc(fmtMoney(a.services.price_cents))}/day`
                  : ''}</button>
            </div>
          </form>` : ''}
        </div>`;
      });
      return `
        <div class="day-head${isToday ? ' today' : ''}">
          ${day.toLocaleDateString('en-US', { weekday: 'long' })}
          <span class="day-date">${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          ${isToday ? '<span class="pill pill-sage">today</span>' : ''}
        </div>
        ${rows.join('') || '<div class="day-empty">No walks</div>'}`;
    });

    const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(weekEnd.getTime() - DAY_MS).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    appEl.innerHTML = header('schedule') + `
      <div class="page">
        <div class="detail-head">
          <div class="who">
            <h1 class="page-title">Schedule</h1>
            <p class="page-sub">Week of ${esc(weekLabel)}</p>
          </div>
          <button class="btn btn-primary" data-nav="#/appointment-new">+ New appointment</button>
        </div>
        <div class="week-nav">
          <button class="btn btn-quiet" data-nav="#/schedule?w=${weekOffset - 1}">‹ Previous</button>
          <button class="btn btn-ghost" data-nav="#/schedule" ${weekOffset === 0 ? 'disabled' : ''}>This week</button>
          <button class="btn btn-quiet" data-nav="#/schedule?w=${weekOffset + 1}">Next ›</button>
        </div>
        <div class="stack" style="margin-top:16px">${daySections.join('')}</div>
      </div>`;

    document.querySelectorAll('[data-complete-appt]').forEach((btn) => {
      btn.onclick = () => {
        const form = document.getElementById(`cf-${btn.dataset.completeAppt}`);
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector('input').focus();
      };
    });
    document.querySelectorAll('[data-close-complete]').forEach((btn) => {
      btn.onclick = () => { document.getElementById(`cf-${btn.dataset.closeComplete}`).hidden = true; };
    });
    document.querySelectorAll('.complete-form').forEach((form) => {
      const id = form.id.slice(3);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        await withBusy(btn, async () => {
          try {
            const { invoice } = await api('POST', `/api/appointments/${id}/complete`, {
              actual_start_at: fromLocalInput(document.getElementById(`cf-start-${id}`).value),
              actual_end_at: fromLocalInput(document.getElementById(`cf-end-${id}`).value),
              completion_notes: document.getElementById(`cf-notes-${id}`).value.trim() || null,
              good_dog: document.getElementById(`cf-good-${id}`).checked,
              got_a_treat: document.getElementById(`cf-treat-${id}`).checked,
            });
            toast(invoice
              ? `Walk completed — ${fmtMoney(invoice.amount_cents)} invoice created automatically.`
              : 'Walk completed.', 'ok');
            renderSchedule(weekOffset);
          } catch (err) {
            toast(err.message);
          }
        });
      };
    });
    document.querySelectorAll('[data-cancel-appt]').forEach((btn) => {
      btn.onclick = () => {
        if (!confirm('Cancel this walk?')) return;
        withBusy(btn, async () => {
          try {
            await api('POST', `/api/appointments/${btn.dataset.cancelAppt}/cancel`, { scope: 'one' });
            toast('Walk cancelled.', 'ok');
            renderSchedule(weekOffset);
          } catch (err) {
            toast(err.message);
          }
        });
      };
    });
    document.querySelectorAll('[data-cancel-series]').forEach((btn) => {
      btn.onclick = () => {
        if (!confirm('Cancel this walk AND all later walks in this weekly series?')) return;
        withBusy(btn, async () => {
          try {
            const cancelled = await api('POST', `/api/appointments/${btn.dataset.cancelSeries}/cancel`, { scope: 'following' });
            toast(`Series ended — ${cancelled.length} walk${cancelled.length === 1 ? '' : 's'} cancelled.`, 'ok');
            renderSchedule(weekOffset);
          } catch (err) {
            toast(err.message);
          }
        });
      };
    });
    wireNav();
  }

  // ---------------------------------------------------- new appointment ----
  async function renderNewAppointment(params) {
    appEl.innerHTML = header('schedule') + `<div class="page loading">Loading…</div>`;
    let clients;
    try {
      clients = await api('GET', '/api/clients');
    } catch (err) {
      toast(err.message);
      location.hash = '#/schedule';
      return;
    }
    if (clients.length === 0) {
      appEl.innerHTML = header('schedule') + `
        <div class="page"><div class="card empty">Add a client first — appointments are booked for a client's service.
        <div style="margin-top:12px"><button class="btn btn-primary" data-nav="#/client-new">+ New client</button></div></div></div>`;
      wireNav();
      return;
    }

    const preClient = params.get('client');
    const preService = params.get('service');
    // Default: next full hour, today.
    const defStart = new Date();
    defStart.setMinutes(0, 0, 0);
    defStart.setHours(defStart.getHours() + 1);

    appEl.innerHTML = header('schedule') + `
      <div class="page">
        <a class="backlink" href="#/schedule">‹ Schedule</a>
        <h1 class="page-title" style="margin-top:8px">New appointment</h1>
        <p class="page-sub">Times are checked against your existing schedule — double-booking is blocked. Boarding is the exception: boarders don't block walks or other boarders.</p>

        <form id="ap-form">
        <div class="card fieldset" style="margin-top:18px">
          <div class="form-grid">
            <div><label for="ap-client">Client</label>
              <select id="ap-client" required>
                ${clients.map((c) => `<option value="${c.id}" ${c.id === preClient ? 'selected' : ''}>${esc(c.full_name)}</option>`).join('')}
              </select></div>
            <div><label for="ap-service">Service</label>
              <select id="ap-service" required></select></div>
          </div>
          <div class="preview-note" id="ap-nosvc" hidden style="padding:8px 0 0 12px">
            No active services for this client yet. Services are created by a signed
            contract — once it's signed, they appear here with the name and price
            pre-filled from what the client agreed to.
            <button class="btn btn-quiet" type="button" id="ap-gen-contract" style="margin-left:8px">Generate contract</button>
          </div>
          <div class="form-grid">
            <div><label for="ap-start">Date &amp; time</label>
              <input id="ap-start" type="datetime-local" required value="${toLocalInput(defStart.toISOString())}" /></div>
            <div><label for="ap-duration">Duration <span class="hint">minutes</span></label>
              <input id="ap-duration" type="number" min="5" max="1440" value="30" class="num" /></div>
            <div><label>Repeats</label>
              <div class="seg" role="group" aria-label="Repeat" id="ap-repeat">
                <button type="button" aria-pressed="true" data-value="1">One-time</button>
                <button type="button" aria-pressed="false" data-value="weekly">Weekly</button>
              </div></div>
            <div id="ap-weeks-wrap" hidden><label for="ap-weeks">For how many weeks?</label>
              <input id="ap-weeks" type="number" min="1" max="26" value="8" class="num" /></div>
            <div class="full" id="ap-days-wrap" hidden>
              <label>On which days? <span class="hint">— same time each day; the first walk's day is always included</span></label>
              <div class="appt-flags" id="ap-days" style="margin-top:6px">
                ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => `
                  <label class="flag"><input type="checkbox" data-day="${(i + 1) % 7}" /> ${label}</label>`).join('')}
              </div>
            </div>
            <div class="full"><label for="ap-notes">Notes <span class="hint">optional</span></label>
              <input id="ap-notes" placeholder="e.g. Use the side gate" /></div>
          </div>
        </div>
        <div class="form-foot">
          <button class="btn btn-ghost" type="button" data-nav="#/schedule">Cancel</button>
          <div class="spacer"></div>
          <button class="btn btn-primary" type="submit">Book appointment</button>
        </div>
        </form>
      </div>`;

    const clientSel = document.getElementById('ap-client');
    const serviceSel = document.getElementById('ap-service');
    // Tester feedback 2026-07-18: no more typing a service name here. The
    // dropdown is pre-filled from the client's active services (born from
    // their signed contract, W-5…W-7); a client without one gets pointed at
    // contract generation instead of a blank form.
    const submitBtn = document.querySelector('#ap-form button[type=submit]');
    let clientServices = [];

    async function loadServices() {
      serviceSel.innerHTML = '<option value="">Loading…</option>';
      try {
        clientServices = await api('GET', `/api/services?client_id=${clientSel.value}&status=active`);
      } catch (err) {
        toast(err.message);
        clientServices = [];
      }
      serviceSel.innerHTML = clientServices.length
        ? clientServices.map((s) => `<option value="${s.id}" ${s.id === preService ? 'selected' : ''}>${esc(s.name)} — ${fmtMoney(s.price_cents)} ${esc(CADENCES[s.billing_cadence] ?? '')}</option>`).join('')
        : '<option value="">No active services yet</option>';
      document.getElementById('ap-nosvc').hidden = clientServices.length > 0;
      submitBtn.disabled = clientServices.length === 0;
      syncService();
    }
    function syncService() {
      const svc = clientServices.find((s) => s.id === serviceSel.value);
      if (svc?.duration_minutes) document.getElementById('ap-duration').value = svc.duration_minutes;
    }
    clientSel.onchange = loadServices;
    serviceSel.onchange = syncService;
    document.getElementById('ap-gen-contract').onclick = () => {
      location.hash = `#/client/${clientSel.value}/new-contract`;
    };
    await loadServices();

    // Multi-day weekly series: the first walk's weekday is locked in (it IS
    // the series start); extra checked days repeat weekly at the same time.
    const dayBoxes = [...document.querySelectorAll('#ap-days input')];
    function syncBaseDay() {
      const v = document.getElementById('ap-start').value;
      if (!v) return;
      const base = new Date(v).getDay();
      dayBoxes.forEach((cb) => {
        if (Number(cb.dataset.day) === base) {
          cb.checked = true;
          cb.disabled = true;
        } else if (cb.disabled) {
          // Was only checked because it used to be the base day.
          cb.disabled = false;
          cb.checked = false;
        }
      });
    }
    document.getElementById('ap-start').onchange = syncBaseDay;
    syncBaseDay();

    const repeatSeg = document.getElementById('ap-repeat');
    repeatSeg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        repeatSeg.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        const oneTime = b.dataset.value !== 'weekly';
        document.getElementById('ap-weeks-wrap').hidden = oneTime;
        document.getElementById('ap-days-wrap').hidden = oneTime;
      };
    });

    document.getElementById('ap-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          const serviceId = serviceSel.value;
          if (!serviceId) {
            toast('This client needs an active service first — generate a contract to create one.');
            return;
          }

          const startLocal = document.getElementById('ap-start').value;
          const startsAt = fromLocalInput(startLocal);
          const durationMin = Number(document.getElementById('ap-duration').value) || 30;
          const weekly = repeatSeg.querySelector('button[aria-pressed="true"]').dataset.value === 'weekly';

          // Extra weekdays → the next date on/after the first walk with that
          // weekday, same local wall-clock time (setDate keeps it across DST).
          let extraStarts = [];
          if (weekly) {
            const base = new Date(startLocal);
            extraStarts = dayBoxes
              .filter((cb) => cb.checked && !cb.disabled)
              .map((cb) => {
                const d = new Date(base);
                d.setDate(d.getDate() + ((Number(cb.dataset.day) - base.getDay() + 7) % 7));
                return d.toISOString();
              });
          }

          const created = await api('POST', '/api/appointments', {
            service_id: serviceId,
            starts_at: startsAt,
            ends_at: new Date(Date.parse(startsAt) + durationMin * 60 * 1000).toISOString(),
            notes: document.getElementById('ap-notes').value.trim() || null,
            repeat_weeks: weekly ? Number(document.getElementById('ap-weeks').value) || 8 : 1,
            ...(extraStarts.length ? { extra_starts: extraStarts } : {}),
          });
          const daysPerWeek = 1 + extraStarts.length;
          toast(created.length === 1
            ? 'Appointment booked.'
            : `Weekly series booked — ${created.length} walks scheduled${daysPerWeek > 1 ? ` (${daysPerWeek} days a week)` : ''}.`, 'ok');
          location.hash = '#/schedule';
        } catch (err) {
          toast(err.message);
        }
      });
    };
    wireNav();
  }

  // ------------------------------------------------------------ profile ----
  async function renderProfile() {
    appEl.innerHTML = header('profile') + `<div class="page loading">Loading profile…</div>`;
    try {
      await loadProfile(); // always fresh — this page edits it
    } catch (err) {
      toast(err.message);
      location.hash = '#/today';
      return;
    }
    const offered = new Set(profile?.offered_service_types ?? []);

    appEl.innerHTML = header('profile') + `
      <div class="page">
        <h1 class="page-title">Your profile</h1>
        <p class="page-sub">${esc(account?.email ?? '')}</p>

        <div class="card fieldset" style="margin-top:18px">
          <div class="media-row">
            <div class="media-slot">
              <div class="avatar media-avatar">${esc(initials(profile?.full_name ?? ''))}</div>
              <div>
                <strong>Profile photo</strong>
                <div class="media-note">Uploads arrive with Phase 2 branding — your initials stand in for now.</div>
              </div>
            </div>
            <div class="media-slot">
              <div class="media-logo">${PAW}</div>
              <div>
                <strong>Business logo</strong>
                <div class="media-note">Will appear on branded invoices &amp; receipts (Phase 2).</div>
              </div>
            </div>
          </div>
        </div>

        <form id="pf-form">
        <div class="card fieldset" style="margin-top:14px">
          <div class="form-grid">
            <div><label for="pf-name">Your full name</label>
              <input id="pf-name" required value="${esc(profile?.full_name ?? '')}" /></div>
            <div><label for="pf-biz">Business name</label>
              <input id="pf-biz" value="${esc(profile?.business_name ?? '')}" placeholder="e.g. Sunny Trails Walking Co." /></div>
            <div><label for="pf-phone">Your phone</label>
              <input id="pf-phone" data-phone value="${esc(fmtPhone(account?.phone ?? ''))}" placeholder="(555)000-0000" />
              <p class="preview-note" style="margin-top:6px">Shown to your clients in their portal so they can reach you.</p></div>
          </div>
          <div>
            <label>Services you offer</label>
            <div class="appt-flags" style="margin-top:6px">
              ${Object.entries(SERVICE_TYPES).map(([v, l]) => `
                <label class="flag"><input type="checkbox" data-offer="${v}" ${offered.has(v) ? 'checked' : ''} /> ${l}</label>`).join('')}
            </div>
            <p class="preview-note" style="margin-top:10px">Only the types you check appear when adding a service, so a dog walker never wades through Grooming or Boarding. Leave everything unchecked to keep all types available.</p>
          </div>
        </div>
        <div class="form-foot">
          <div class="spacer"></div>
          <button class="btn btn-primary" type="submit">Save profile</button>
        </div>
        </form>

        <div class="eyebrow" style="margin-top:28px">Change password</div>
        <form id="pw-form">
        <div class="card fieldset">
          <div class="form-grid">
            <div><label for="pw-current">Current password</label>
              <input id="pw-current" type="password" required autocomplete="current-password" /></div>
            <div><label for="pw-new">New password <span class="hint">${PASSWORD_HINT}</span></label>
              <input id="pw-new" type="password" required minlength="12" autocomplete="new-password" /></div>
          </div>
        </div>
        <div class="form-foot">
          <div class="spacer"></div>
          <button class="btn" type="submit">Update password</button>
        </div>
        </form>
      </div>`;

    document.getElementById('pf-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          const offeredNow = [...document.querySelectorAll('[data-offer]')]
            .filter((cb) => cb.checked)
            .map((cb) => cb.dataset.offer);
          await api('PATCH', '/api/auth/profile', {
            full_name: document.getElementById('pf-name').value.trim(),
            business_name: document.getElementById('pf-biz').value.trim() || null,
            phone: fmtPhone(document.getElementById('pf-phone').value) || null,
            offered_service_types: offeredNow,
          });
          await loadProfile();
          toast('Profile saved.', 'ok');
          renderProfile();
        } catch (err) {
          toast(err.message);
        }
      });
    };
    document.getElementById('pw-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          await api('POST', '/api/auth/change-password', {
            current_password: document.getElementById('pw-current').value,
            new_password: document.getElementById('pw-new').value,
          });
          e.target.reset();
          toast('Password updated.', 'ok');
        } catch (err) {
          toast(err.message);
        }
      });
    };
    wireNav();
  }

  // ---------------------------------------------------------- messaging ----
  // Realtime: one Supabase client (anon key from /api/config), authorized
  // with the user's JWT so RLS only ever delivers their own threads. If the
  // CDN script or the socket fails, the 8s poll below covers delivery.
  let sbClient = null; // null = not tried, false = unavailable
  async function getSupabase() {
    if (sbClient !== null) return sbClient;
    try {
      if (!window.supabase) { sbClient = false; return sbClient; }
      const cfg = await api('GET', '/api/config');
      sbClient = window.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } catch {
      sbClient = false;
    }
    return sbClient;
  }
  let activeChannel = null;
  let pollTimer = null;
  function teardownMessaging() {
    if (activeChannel && sbClient) sbClient.removeChannel(activeChannel);
    activeChannel = null;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Offline drafts: messages that failed to send wait in localStorage and
  // sync (idempotently, via client_draft_id) when the connection returns.
  function draftQueue() { return safeParse(localStorage.getItem('petpro_drafts')) || []; }
  function saveDraftQueue(q) { localStorage.setItem('petpro_drafts', JSON.stringify(q)); }
  async function syncDraftQueue() {
    const q = draftQueue();
    if (!q.length || !token) return false;
    let results;
    try {
      results = await api('POST', '/api/messages/sync', {
        drafts: q.map((d) => ({ client_id: d.client_id, client_draft_id: d.client_draft_id, body: d.body })),
      });
    } catch {
      return false; // still offline — keep the queue
    }
    // Every draft got a verdict: sent, already-sent, or rejected. Nothing to retry.
    saveDraftQueue([]);
    const errors = results.filter((r) => r.status === 'error');
    if (errors.length) toast(`${errors.length} queued message${errors.length === 1 ? '' : 's'} couldn't be sent.`);
    return results.some((r) => r.status === 'created');
  }
  window.addEventListener('online', () => { syncDraftQueue(); });

  function fmtThreadTime(iso) {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString()
      ? fmtTime(iso)
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ------------------------------------------------------- thread list ----
  async function renderMessages() {
    appEl.innerHTML = header('messages') + `<div class="page loading">Loading messages…</div>`;
    let threads, clients;
    try {
      await syncDraftQueue();
      [threads, clients] = await Promise.all([api('GET', '/api/threads'), api('GET', '/api/clients')]);
      assignClientColors(clients);
    } catch (err) {
      toast(err.message);
      appEl.innerHTML = header('messages') + `<div class="page"><div class="empty">Couldn't load messages. <a class="backlink" href="#/messages">Retry</a></div></div>`;
      return;
    }

    const threadRows = threads.map((t) => {
      const preview = t.last_message
        ? `${t.last_message.sender_account_id === account?.id ? 'You: ' : ''}${t.last_message.body ?? ''}`
        : 'No messages yet';
      return `
        <div class="card client-row" data-nav="#/messages/${t.id}" tabindex="0" role="link">
          <div class="avatar" style="background:${clientColor(t.client.id)}">${esc(initials(t.client.full_name))}</div>
          <div class="who">
            <div class="name">${esc(t.client.full_name)}</div>
            <div class="pets msg-preview">${esc(preview.slice(0, 80))}${preview.length > 80 ? '…' : ''}</div>
          </div>
          ${t.unread_count ? `<span class="unread-dot">${t.unread_count}</span>` : ''}
          <span class="msg-when num">${t.last_message_at ? esc(fmtThreadTime(t.last_message_at)) : ''}</span>
          <span class="chev">›</span>
        </div>`;
    });

    appEl.innerHTML = header('messages') + `
      <div class="page">
        <h1 class="page-title">Messages</h1>
        <p class="page-sub">One conversation per client. Clients get their own view in the owner portal (Week 8).</p>

        <div class="search-row" style="margin-top:16px">
          <select id="msg-client" aria-label="Start a conversation with a client">
            <option value="">Message a client…</option>
            ${clients.map((c) => `<option value="${c.id}">${esc(c.full_name)}</option>`).join('')}
          </select>
          <button class="btn btn-quiet" id="msg-start">Open conversation</button>
        </div>

        <div class="stack" style="margin-top:14px">
          ${threadRows.join('') || '<div class="card empty">No conversations yet — pick a client above to start one.</div>'}
        </div>
      </div>`;

    document.getElementById('msg-start').onclick = async (e) => {
      const clientId = document.getElementById('msg-client').value;
      if (!clientId) { toast('Pick a client first.'); return; }
      await withBusy(e.target, async () => {
        try {
          const thread = await api('POST', '/api/threads', { client_id: clientId });
          location.hash = `#/messages/${thread.id}`;
        } catch (err) {
          toast(err.message);
        }
      });
    };
    wireNav();
  }

  // ------------------------------------------------------- conversation ----
  async function renderThread(threadId) {
    appEl.innerHTML = header('messages') + `<div class="page loading">Loading conversation…</div>`;
    let threads, messages;
    try {
      await syncDraftQueue();
      [threads, messages] = await Promise.all([
        api('GET', '/api/threads'),
        api('GET', `/api/threads/${threadId}/messages`),
        ensureClientColors(),
      ]);
    } catch (err) {
      toast(err.message);
      location.hash = '#/messages';
      return;
    }
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) { location.hash = '#/messages'; return; }
    api('POST', `/api/threads/${threadId}/read`).catch(() => {});

    let lastTs = messages.length ? messages[messages.length - 1].created_at : null;

    function bubbleHtml(m, state = '') {
      const mine = m.sender_account_id === account?.id && !m.is_system;
      const kind = m.is_system ? 'system' : mine ? 'mine' : 'theirs';
      return `
        <div class="msg ${kind}${state ? ` ${state}` : ''}" id="msg-${m.id}">
          <div class="msg-bubble">${esc(m.body ?? '')}</div>
          <div class="msg-meta num">${state === 'queued' ? 'queued — sends when back online' : esc(fmtThreadTime(m.created_at))}</div>
        </div>`;
    }

    appEl.innerHTML = header('messages') + `
      <div class="page thread-page">
        <a class="backlink" href="#/messages">‹ All messages</a>
        <div class="detail-head" style="margin-bottom:6px">
          <div class="who" style="display:flex; align-items:center; gap:12px">
            <div class="avatar" style="background:${clientColor(thread.client.id)}">${esc(initials(thread.client.full_name))}</div>
            <h1 class="page-title">${esc(thread.client.full_name)}</h1>
          </div>
          <button class="btn btn-quiet" data-nav="#/client/${thread.client.id}">View client</button>
        </div>
        <div class="card msg-window" id="msg-window">
          ${messages.map((m) => bubbleHtml(m)).join('') || '<div class="empty" style="border:none">No messages yet — say hi 👋</div>'}
        </div>
        <form class="msg-composer" id="msg-form">
          <textarea id="msg-input" rows="1" placeholder="Write a message…" aria-label="Message"></textarea>
          <button class="btn btn-primary" type="submit">Send</button>
        </form>
        <div class="msg-live num" id="msg-live"></div>
      </div>`;

    const windowEl = document.getElementById('msg-window');
    const inputEl = document.getElementById('msg-input');
    const scrollDown = () => { windowEl.scrollTop = windowEl.scrollHeight; };
    scrollDown();

    function appendMessage(m, state = '') {
      if (document.getElementById(`msg-${m.id}`)) return;
      windowEl.querySelector('.empty')?.remove();
      windowEl.insertAdjacentHTML('beforeend', bubbleHtml(m, state));
      if (m.created_at && (!lastTs || m.created_at > lastTs)) lastTs = m.created_at;
      scrollDown();
    }

    // Incoming delivery: realtime when available, 8s polling as safety net.
    async function pollNew() {
      try {
        const fresh = await api('GET', `/api/threads/${threadId}/messages${lastTs ? `?after=${encodeURIComponent(lastTs)}` : ''}`);
        for (const m of fresh) appendMessage(m);
        if (fresh.some((m) => m.sender_account_id !== account?.id)) {
          api('POST', `/api/threads/${threadId}/read`).catch(() => {});
        }
      } catch { /* transient — next poll retries */ }
    }
    pollTimer = setInterval(pollNew, 8000);

    (async () => {
      const sb = await getSupabase();
      if (!sb || location.hash !== `#/messages/${threadId}`) return;
      sb.realtime.setAuth(token);
      activeChannel = sb
        .channel(`thread-${threadId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
          (payload) => {
            appendMessage(payload.new);
            if (payload.new.sender_account_id !== account?.id) {
              api('POST', `/api/threads/${threadId}/read`).catch(() => {});
            }
          }
        )
        .subscribe((status) => {
          const live = document.getElementById('msg-live');
          if (live) live.textContent = status === 'SUBSCRIBED' ? '● live' : '';
        });
    })();

    // Sending — optimistic bubble; a network failure queues the draft.
    document.getElementById('msg-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = inputEl.value.trim();
      if (!body) return;
      const draftId = crypto.randomUUID();
      inputEl.value = '';
      const temp = { id: `tmp-${draftId}`, sender_account_id: account?.id, body, created_at: new Date().toISOString() };
      appendMessage(temp, 'sending');
      try {
        const sent = await api('POST', `/api/threads/${threadId}/messages`, { body, client_draft_id: draftId });
        const el = document.getElementById(`msg-${temp.id}`);
        if (el) el.remove();
        appendMessage(sent);
      } catch (err) {
        if (/reach the server/i.test(err.message)) {
          saveDraftQueue([...draftQueue(), { client_id: thread.client.id, client_draft_id: draftId, body }]);
          const el = document.getElementById(`msg-${temp.id}`);
          if (el) { el.classList.remove('sending'); el.classList.add('queued'); el.querySelector('.msg-meta').textContent = 'queued — sends when back online'; }
        } else {
          document.getElementById(`msg-${temp.id}`)?.remove();
          toast(err.message);
        }
      }
    };
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('msg-form').requestSubmit();
      }
    };
    inputEl.focus();
    wireNav();
  }

  // ------------------------------------------------------------ routing ----
  function wireNav() {
    document.querySelectorAll('[data-nav]').forEach((el) => {
      const target = el.dataset.nav;
      const go = () => { location.hash = target; };
      el.onclick = go;
      if (el.getAttribute('role') === 'link') {
        el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      }
    });
  }

  function render() {
    teardownMessaging(); // leaving a conversation stops its socket + poll
    document.body.classList.remove('login-bg');

    // A Supabase recovery link lands here as `#access_token=…&type=recovery`
    // (or `#error=…` when the link expired) — intercept before hash routing.
    const raw = (location.hash || '').slice(1);
    if (raw.includes('type=recovery') || raw.startsWith('error=')) {
      const rp = new URLSearchParams(raw);
      if (rp.get('type') === 'recovery' && rp.get('access_token')) {
        renderResetPassword(rp.get('access_token'));
        return;
      }
      if (rp.get('error')) {
        history.replaceState(null, '', location.pathname);
        toast(rp.get('error_description') || 'That reset link is invalid or has expired — request a new one.');
        renderLogin();
        return;
      }
    }

    const hash = location.hash || '#/today';
    const [path, queryString] = hash.slice(2).split('?');
    const params = new URLSearchParams(queryString ?? '');
    const parts = path.split('/').filter(Boolean);

    if (!token) { renderLogin(); return; }

    if (parts[0] === 'login') { renderLogin(); return; }
    if (parts[0] === 'clients') { renderClients(); return; }
    if (parts[0] === 'schedule') { renderSchedule(Number(params.get('w')) || 0); return; }
    if (parts[0] === 'messages' && parts[1]) { renderThread(parts[1]); return; }
    if (parts[0] === 'messages') { renderMessages(); return; }
    if (parts[0] === 'profile') { renderProfile(); return; }
    if (parts[0] === 'appointment-new') { renderNewAppointment(params); return; }
    if (parts[0] === 'setup') { renderSetup(Math.min(3, Math.max(1, Number(parts[1]) || 1))); return; }
    if (parts[0] === 'client-new') { renderNewClient(); return; }
    if (parts[0] === 'client' && parts[1] && parts[2] === 'new-contract') {
      renderNewContract(parts[1], params.get('replace')); return;
    }
    if (parts[0] === 'client' && parts[1]) {
      renderClient(parts[1], { addpet: params.get('addpet') === '1', edit: params.get('edit') === '1' }); return;
    }
    if (parts[0] === 'contract' && parts[1] && parts[2] === 'sign') { renderSign(parts[1]); return; }
    if (parts[0] === 'invoice' && parts[1] && parts[2] === 'return') {
      renderInvoiceReturn(parts[1], params.get('canceled') === '1'); return;
    }
    renderToday(); // default: today
  }

  window.addEventListener('hashchange', render);
  render();
})();
