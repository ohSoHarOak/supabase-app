/* PetPro Connect — Week 4 professional UI.
   Vanilla JS single-page app, hash-routed, talking to the Week 1–3 REST API.
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
  let toastTimer;
  function toast(message, kind = 'error') {
    toastEl.textContent = '';
    toastEl.className = `toast${kind === 'ok' ? ' ok' : ''}`;
    toastEl.append(message);
    const x = document.createElement('button');
    x.className = 'toast-x';
    x.setAttribute('aria-label', 'Dismiss');
    x.textContent = '✕';
    x.onclick = () => { toastEl.hidden = true; };
    toastEl.append(x);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, kind === 'ok' ? 4000 : 8000);
  }

  // ------------------------------------------------------------ helpers ----
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  }
  function petSummary(pets) {
    if (!pets?.length) return 'No pets yet';
    return pets.map((p) => (p.breed ? `${p.name} (${p.breed})` : p.name)).join(' · ');
  }
  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  const PAW = `<svg width="26" height="26" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#1C4C64"/><g fill="#F7F2EB"><ellipse cx="15" cy="16" rx="3.4" ry="4.4" transform="rotate(-18 15 16)"/><ellipse cx="29" cy="16" rx="3.4" ry="4.4" transform="rotate(18 29 16)"/><ellipse cx="9.5" cy="23.5" rx="2.8" ry="3.6" transform="rotate(-38 9.5 23.5)"/><ellipse cx="34.5" cy="23.5" rx="2.8" ry="3.6" transform="rotate(38 34.5 23.5)"/><path d="M22 21c4.4 0 8.4 3.5 8.4 7.6 0 2.9-2.2 4.6-4.7 4.6-1.5 0-2.6-0.6-3.7-0.6s-2.2 0.6-3.7 0.6c-2.5 0-4.7-1.7-4.7-4.6C13.6 24.5 17.6 21 22 21z"/></g></svg>`;
  const PAW_LOGIN = PAW.replace('width="26" height="26"', 'width="44" height="44"').replace('#1C4C64', '#2B7192');

  // busy-state wrapper: disables the button, restores it after
  async function withBusy(btn, fn) {
    if (btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.classList.add('busy');
    btn.textContent = 'Working…';
    try {
      await fn();
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      btn.textContent = label;
    }
  }

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
          <a class="soon" title="Coming in week 6">Schedule<small>week 6</small></a>
          <a class="soon" title="Coming in week 7">Messages<small>week 7</small></a>
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
          <div><label for="f-pass">Password ${isSignup ? '<span class="hint">at least 8 characters</span>' : ''}</label>
            <input id="f-pass" type="password" required minlength="${isSignup ? 8 : 1}" autocomplete="${isSignup ? 'new-password' : 'current-password'}" /></div>
          <button class="btn btn-primary" type="submit">${isSignup ? 'Create account' : 'Log in'}</button>
        </form>
        <div class="login-foot">
          ${isSignup
            ? `Already have an account? <a id="mode-switch">Log in</a>`
            : `New here? <a id="mode-switch">Create your business account</a>`}
        </div>
      </div></div>`;

    document.getElementById('mode-switch').onclick = () => renderLogin(isSignup ? 'login' : 'signup');
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
          location.hash = '#/today';
        } catch (err) {
          toast(err.message);
        }
      });
    };
  }

  // ------------------------------------------------------------- today ----
  async function renderToday(query = '') {
    appEl.innerHTML = header('today') + `<div class="page loading">Loading your day…</div>`;
    let clients, contracts;
    try {
      [clients, contracts] = await Promise.all([
        api('GET', `/api/clients${query ? `?q=${encodeURIComponent(query)}` : ''}`),
        api('GET', '/api/contracts'),
      ]);
    } catch (err) {
      toast(err.message);
      appEl.innerHTML = header('today') + `<div class="page"><div class="empty">Couldn't load your data. <a class="backlink" href="#/today">Retry</a></div></div>`;
      return;
    }

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
    const pendingRows = pending.map((c) => {
      const hasUnsigned = unsigned.some((k) => k.client_id === c.id);
      return `
        <div class="card client-row" data-nav="#/client/${c.id}" tabindex="0" role="link">
          <div class="avatar">${esc(initials(c.full_name))}</div>
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
        <div class="avatar" style="background:${['#2B7192', '#6D9280', '#1C4C64'][c.full_name.length % 3]}">${esc(initials(c.full_name))}</div>
        <div class="who">
          <div class="name">${esc(c.full_name)}</div>
          <div class="pets">${esc(petSummary(c.pets))}</div>
        </div>
        <span class="pill pill-sage">active</span>
        <span class="chev">›</span>
      </div>`);

    appEl.innerHTML = header('today') + `
      <div class="page">
        <h1 class="page-title">${firstName ? `Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${esc(firstName)}` : 'Today'}</h1>
        <p class="page-sub">${esc(profile?.business_name || '')}${profile?.business_name ? ' · ' : ''}${today}</p>

        <div class="eyebrow">Needs your attention</div>
        <div class="stack">
          ${cueCards.join('') + pendingRows.join('') || '<div class="card empty">Nothing needs your attention. 🎉</div>'}
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
            <div><label for="c-phone">Phone</label><input id="c-phone" placeholder="+1 (555) 000-0000" /></div>
            <div><label for="c-email">Email</label><input id="c-email" type="email" placeholder="name@example.com" /></div>
            <div><label for="c-status">Status</label>
              <select id="c-status">
                <option value="prospect">Pending (until first contract is signed)</option>
                <option value="active">Active</option>
              </select></div>
            <div class="full"><label for="c-address">Address</label><input id="c-address" placeholder="Street, city, state" /></div>
            <div><label for="c-ecname">Emergency contact</label><input id="c-ecname" placeholder="Name" /></div>
            <div><label for="c-ecphone">Emergency phone</label><input id="c-ecphone" placeholder="+1 (555) 000-0000" /></div>
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
            phone: val('c-phone'),
            address: val('c-address'),
            emergency_contact_name: val('c-ecname'),
            emergency_contact_phone: val('c-ecphone'),
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
    let client, contracts;
    try {
      [client, contracts] = await Promise.all([
        api('GET', `/api/clients/${clientId}`),
        api('GET', `/api/contracts?client_id=${clientId}`),
      ]);
    } catch (err) {
      toast(err.message);
      location.hash = '#/today';
      return;
    }

    const petCards = client.pets.map((p) => `
      <div class="card pet-card">
        <div class="pet-top">
          <div class="pet-photo">${PAW.replace('#1C4C64', 'transparent').replace('#F7F2EB', '#6D9280').replace('<circle cx="22" cy="22" r="22" fill="transparent"/>', '')}</div>
          <div>
            <div class="pet-name">${esc(p.name)}</div>
            <div class="pet-breed">${esc([p.breed, p.weight_lb ? `${p.weight_lb} lb` : null].filter(Boolean).join(' · ') || 'dog')}</div>
          </div>
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
          <div class="title">Dog Walking Service Agreement</div>
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

    appEl.innerHTML = header('clients') + `
      <div class="page">
        <a class="backlink" href="#/today">‹ All clients</a>
        <div class="detail-head">
          <div class="who">
            <h1 class="page-title">${esc(client.full_name)}</h1>
            <div class="contact-line">${esc([client.address, client.phone, client.email].filter(Boolean).join(' · ') || 'No contact details yet')}</div>
            ${client.emergency_contact_name ? `<div class="contact-line">Emergency: ${esc(client.emergency_contact_name)}${client.emergency_contact_phone ? `, ${esc(client.emergency_contact_phone)}` : ''}</div>` : ''}
          </div>
          <button class="btn btn-primary" data-nav="#/client/${client.id}/new-contract">Generate contract</button>
        </div>

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

        <div class="card fieldset" style="margin-top:12px" id="addpet-card">
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

        <div class="eyebrow">Contracts</div>
        <div class="stack">${contractRows.join('') || '<div class="card empty">No contracts yet — generate the first one with the button above.</div>'}</div>
      </div>`;

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
    wireNav();
    wireContractViews();
    if (opts.addpet) document.getElementById('p-name').focus();
  }

  // -------------------------------------------------------- new contract ----
  async function renderNewContract(clientId, replaceId) {
    appEl.innerHTML = header('clients') + `<div class="page loading">Preparing contract…</div>`;
    let client, templates;
    try {
      client = await api('GET', `/api/clients/${clientId}`);
      templates = await api('GET', '/api/contract-templates');
      if (templates.length === 0) {
        // First use: copy the packaged CA agreement into this account.
        templates = [await api('POST', '/api/contract-templates/seed', {})];
      }
    } catch (err) {
      toast(err.message);
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
          <div class="form-grid">
            <div class="full"><label for="k-template">Template</label>
              <select id="k-template">${templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
            <div><label>Walk type</label>
              <div class="seg" role="group" aria-label="Walk type" id="k-walktype">
                <button type="button" aria-pressed="true" data-value="Private Walk">Private walk</button>
                <button type="button" aria-pressed="false" data-value="Group Walk">Group walk</button>
              </div></div>
            <div><label for="k-price">Price</label><input id="k-price" required class="money" placeholder="$30.00 per 30-minute walk" /></div>
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
    for (const segId of ['k-walktype', 'k-photo']) {
      document.getElementById(segId).querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          b.parentElement.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
        };
      });
    }
    const segValue = (id) =>
      document.getElementById(id).querySelector('button[aria-pressed="true"]').dataset.value;

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
            variables: {
              walk_type: segValue('k-walktype'),
              photo_consent: segValue('k-photo'),
              service_price: document.getElementById('k-price').value.trim(),
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
        </div>
        <h1 class="page-title" style="margin-top:8px">${signed ? 'Signed contract' : 'Sign contract'}</h1>
        ${signable ? `<p class="page-sub">Still a draft — every term can be edited until the moment it's signed. Hand the device to your client to review and sign.</p>` : ''}

        <div class="sign-layout">
          <iframe class="doc-frame" id="doc-frame" title="Contract document" sandbox=""></iframe>
          ${signable ? `
          <div class="card sign-pad-card">
            <div>
              <label for="sig-name">Signer's full name</label>
              <input id="sig-name" value="${esc(client.full_name)}" />
              <div class="field-error" id="name-err" hidden>Please enter the signer's name.</div>
            </div>
            <div>
              <label for="sigpad">Signature</label>
              <canvas id="sigpad" aria-label="Signature area — draw with mouse or finger"></canvas>
              <p class="sig-hint">Sign above with a finger or mouse</p>
              <div class="field-error" id="sig-err" hidden>A signature is required — sign in the box above.</div>
            </div>
            <div class="lock-note">
              <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
              Signing locks this contract permanently. The signed copy can never be altered — by anyone.
            </div>
            <div style="display:flex; gap:10px">
              <button class="btn btn-ghost" id="sig-clear" type="button">Clear</button>
              <button class="btn btn-primary" style="flex:1" id="sig-submit" type="button">Sign &amp; lock contract</button>
            </div>
          </div>` : ''}
        </div>
      </div>`;

    // Render the contract HTML in a sandboxed iframe so its styles can't
    // leak into the app (and app scripts can't touch the document).
    document.getElementById('doc-frame').srcdoc = contract.generated_html;

    if (!signable) { wireNav(); return; }

    // ------------------------------------------------- signature canvas --
    const pad = document.getElementById('sigpad');
    const ctx = pad.getContext('2d');
    let drawing = false;
    let drew = false;
    function sizePad() {
      const r = pad.getBoundingClientRect();
      if (r.width === 0) return;
      const scale = window.devicePixelRatio || 1;
      pad.width = r.width * scale;
      pad.height = r.height * scale;
      ctx.scale(scale, scale);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1E2B33';
    }
    new ResizeObserver(sizePad).observe(pad);
    const pos = (e) => {
      const r = pad.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    pad.addEventListener('pointerdown', (e) => {
      drawing = true; drew = true;
      pad.classList.remove('err');
      pad.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      ctx.beginPath(); ctx.moveTo(x, y);
    });
    pad.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const [x, y] = pos(e);
      ctx.lineTo(x, y); ctx.stroke();
    });
    pad.addEventListener('pointerup', () => { drawing = false; });
    document.getElementById('sig-clear').onclick = () => {
      ctx.clearRect(0, 0, pad.width, pad.height);
      drew = false;
    };

    document.getElementById('sig-submit').onclick = async (e) => {
      const nameEl = document.getElementById('sig-name');
      const name = nameEl.value.trim();
      document.getElementById('name-err').hidden = Boolean(name);
      document.getElementById('sig-err').hidden = drew;
      pad.classList.toggle('err', !drew);
      if (!name || !drew) return;

      await withBusy(e.target, async () => {
        try {
          await api('POST', `/api/contracts/${contractId}/sign`, {
            signer_name: name,
            signature_image: pad.toDataURL('image/png'),
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
    document.body.classList.remove('login-bg');
    const hash = location.hash || '#/today';
    const [path, queryString] = hash.slice(2).split('?');
    const params = new URLSearchParams(queryString ?? '');
    const parts = path.split('/').filter(Boolean);

    if (!token) { renderLogin(); return; }

    if (parts[0] === 'login') { renderLogin(); return; }
    if (parts[0] === 'client-new') { renderNewClient(); return; }
    if (parts[0] === 'client' && parts[1] && parts[2] === 'new-contract') {
      renderNewContract(parts[1], params.get('replace')); return;
    }
    if (parts[0] === 'client' && parts[1]) {
      renderClient(parts[1], { addpet: params.get('addpet') === '1' }); return;
    }
    if (parts[0] === 'contract' && parts[1] && parts[2] === 'sign') { renderSign(parts[1]); return; }
    renderToday(); // default: today (also covers #/clients)
  }

  window.addEventListener('hashchange', render);
  render();
})();
