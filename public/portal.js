/* PetPro Connect — pet owner portal (Week 8).
   Magic-link login, then: upcoming walks, contracts (view + sign), invoices
   (view + pay via Stripe Checkout), and messaging the professional.
   Same vanilla hash-routed pattern as app.js, deliberately smaller. */

(() => {
  'use strict';

  // ------------------------------------------------------------ state ----
  let token = localStorage.getItem('petpro_portal_token');
  let account = safeParse(localStorage.getItem('petpro_portal_account'));

  const appEl = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  function safeParse(json) {
    try { return JSON.parse(json); } catch { return null; }
  }
  function saveSession(session) {
    token = session.access_token;
    account = session.account;
    localStorage.setItem('petpro_portal_token', token);
    localStorage.setItem('petpro_portal_account', JSON.stringify(account));
  }
  function logout(redirect = true) {
    token = null; account = null;
    localStorage.removeItem('petpro_portal_token');
    localStorage.removeItem('petpro_portal_account');
    if (redirect) { location.hash = ''; render(); }
  }
  window.petproPortalLogout = () => logout();

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
      render();
      throw new Error('Your session expired — request a new login link.');
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
  // Formatters, withBusy and the sign-screen pieces come from shared.js so
  // this portal and the professional app cannot drift — see T-3 in ROADMAP.md.
  const { esc, fmtDate, fmtTime, fmtMoney, fmtPhone, withBusy } = PetPro;

  function fmtDay(iso) {
    return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function petSummary(pets) {
    if (!pets?.length) return '';
    return pets.map((p) => (p.breed ? `${p.name} (${p.breed})` : p.name)).join(' · ');
  }

  const PAW_LOGIN = `<svg width="64" height="64" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#6D9280"/><g fill="#F7F2EB"><ellipse cx="15" cy="16" rx="3.4" ry="4.4" transform="rotate(-18 15 16)"/><ellipse cx="29" cy="16" rx="3.4" ry="4.4" transform="rotate(18 29 16)"/><ellipse cx="9.5" cy="23.5" rx="2.8" ry="3.6" transform="rotate(-38 9.5 23.5)"/><ellipse cx="34.5" cy="23.5" rx="2.8" ry="3.6" transform="rotate(38 34.5 23.5)"/><path d="M22 21c4.4 0 8.4 3.5 8.4 7.6 0 2.9-2.2 4.6-4.7 4.6-1.5 0-2.6-0.6-3.7-0.6s-2.2 0.6-3.7 0.6c-2.5 0-4.7-1.7-4.7-4.6C13.6 24.5 17.6 21 22 21z"/></g></svg>`;

  function header(active) {
    const tab = (id, label) =>
      `<a href="#/${id}" class="${active === id ? 'active' : ''}">${label}</a>`;
    return `
      <header class="app-header"><div class="inner">
        <a class="brand" href="#/home">🐾 PetPro Connect</a>
        <nav class="app-nav">
          ${tab('home', 'Home')}
          ${tab('messages', 'Messages')}
          <a href="#" onclick="window.petproPortalLogout(); return false;">Log out</a>
        </nav>
      </div></header>`;
  }

  // ------------------------------------------------------------- login ----
  function renderLogin() {
    document.body.classList.add('login-bg');
    appEl.innerHTML = `
      <div class="login-wrap"><div class="login-card">
        <div class="login-brand">
          ${PAW_LOGIN}
          <div class="wordmark">PetPro Connect</div>
          <div class="tag">Pet owner portal</div>
        </div>
        <form id="login-form">
          <div><label for="f-email">Your email</label>
            <input id="f-email" type="email" required autocomplete="username" placeholder="The email your walker has on file" /></div>
          <button class="btn btn-primary" type="submit">Email me a login link</button>
        </form>
        <div class="login-foot">No password needed — we email you a secure one-time link.</div>
      </div></div>`;

    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        try {
          await api('POST', '/api/portal/login', {
            email: document.getElementById('f-email').value.trim(),
          });
          e.target.outerHTML = `<p style="text-align:center">If that email is on file with a professional, a login link is on its way. Check your inbox (and spam) — the link opens your portal right here.</p>`;
        } catch (err) {
          toast(err.message);
        }
      });
    };
  }

  // -------------------------------------------------------------- home ----
  async function renderHome() {
    appEl.innerHTML = header('home') + `<div class="page loading">Loading your portal…</div>`;
    let ov;
    try {
      ov = await api('GET', '/api/portal/overview');
    } catch (err) {
      toast(err.message);
      appEl.innerHTML = header('home') + `<div class="page"><div class="empty">Couldn't load your data. <a class="backlink" href="#/home">Retry</a></div></div>`;
      return;
    }

    const clientById = Object.fromEntries(ov.clients.map((c) => [c.id, c]));
    const proName = (clientId) => {
      const pro = clientById[clientId]?.professional;
      return pro ? (pro.business_name || pro.full_name) : 'your professional';
    };
    const firstName = (ov.clients[0]?.full_name || '').split(' ')[0];

    // Cues: contracts awaiting signature, invoices awaiting payment.
    const unsigned = ov.contracts.filter((k) => k.status === 'draft' || k.status === 'sent');
    const openInvoices = ov.invoices.filter((inv) => inv.status === 'open' || inv.status === 'draft');
    const cues = [
      ...unsigned.map((k) => `
        <div class="card cue-card">
          <div class="cue-text">
            <div class="cue-title">${esc(proName(k.client_id))} sent an agreement to sign</div>
            <div class="cue-sub">Generated ${esc(fmtDate(k.created_at))}</div>
          </div>
          <button class="btn btn-primary" data-nav="#/contract/${k.id}">Review &amp; sign</button>
        </div>`),
      ...openInvoices.map((inv) => `
        <div class="card cue-card">
          <div class="cue-text">
            <div class="cue-title">${esc(fmtMoney(inv.amount_cents))} invoice from ${esc(proName(inv.client_id))}</div>
            <div class="cue-sub">${esc(inv.description || 'Services')} · ${esc(fmtDate(inv.created_at))}${inv.due_date ? ` · due ${esc(fmtDate(inv.due_date))}` : ''}</div>
          </div>
          <button class="btn btn-primary" data-pay-invoice="${inv.id}">Pay now</button>
        </div>`),
    ];

    const apptRows = ov.appointments.map((a) => `
      <div class="card contract-row">
        <div class="what">
          <div class="title">${esc(fmtDay(a.starts_at))} · ${esc(fmtTime(a.starts_at))}</div>
          <div class="meta">${esc(a.services?.name ?? 'Appointment')} · ${esc(petSummary(clientById[a.client_id]?.pets) || 'your pets')} · with ${esc(proName(a.client_id))}</div>
        </div>
        ${a.recurrence_rule || a.recurrence_parent_id ? '<span class="pill pill-sage">↻ weekly</span>' : ''}
      </div>`);

    const signedRows = ov.contracts.filter((k) => k.status === 'signed').map((k) => `
      <div class="card contract-row">
        <div class="what">
          <div class="title">Service agreement with ${esc(proName(k.client_id))}</div>
          <div class="meta">Signed ${esc(fmtDate(k.signed_at))} by ${esc(k.signer_name ?? '')}</div>
        </div>
        <span class="pill pill-sage">signed</span>
        <div class="row-actions"><button class="btn btn-ghost" data-nav="#/contract/${k.id}">View</button></div>
      </div>`);

    const paidRows = ov.invoices.filter((inv) => inv.status === 'paid').map((inv) => `
      <div class="card contract-row">
        <div class="what">
          <div class="title">${esc(fmtMoney(inv.amount_cents))} — ${esc(inv.description || 'Services')}</div>
          <div class="meta">Paid ${esc(fmtDate(inv.paid_at))}</div>
        </div>
        <span class="pill pill-sage">paid</span>
      </div>`);

    // C-3: the walker's contact details. Read-only per D2 — the owner can
    // call, email, or message, but can't edit anything here. De-duplicated by
    // account id because one owner may have several clients with one walker.
    const proCards = [...new Map(
      ov.clients
        .filter((c) => c.professional)
        .map((c) => [c.professional_account_id, c.professional])
    ).values()].map((pro) => {
      const lines = [
        pro.phone ? `<a href="tel:${esc(String(pro.phone).replace(/[^+\d]/g, ''))}">${esc(fmtPhone(pro.phone))}</a>` : null,
        pro.email ? `<a href="mailto:${esc(pro.email)}">${esc(pro.email)}</a>` : null,
      ].filter(Boolean);
      return `
      <div class="card contract-row">
        <div class="what">
          <div class="title">${esc(pro.business_name || pro.full_name)}</div>
          ${pro.business_name ? `<div class="meta">${esc(pro.full_name)}</div>` : ''}
          ${lines.length ? `<div class="contact-line">${lines.join(' · ')}</div>` : ''}
        </div>
        <button class="btn btn-quiet" data-nav="#/messages">Message</button>
      </div>`;
    });

    appEl.innerHTML = header('home') + `
      <div class="page">
        <h1 class="page-title">${firstName ? `Welcome, ${esc(firstName)}` : 'Welcome'}</h1>
        <p class="page-sub">${ov.clients.map((c) => esc(petSummary(c.pets))).filter(Boolean).join(' · ') || 'Your pet care, in one place'}</p>

        ${cues.length ? `<div class="eyebrow">Needs your attention</div><div class="stack">${cues.join('')}</div>` : ''}

        <div class="eyebrow">Upcoming visits</div>
        <div class="stack">${apptRows.join('') || '<div class="card empty">No upcoming visits scheduled.</div>'}</div>

        <div class="eyebrow">Agreements</div>
        <div class="stack">${signedRows.join('') || '<div class="card empty">No signed agreements yet.</div>'}</div>

        ${paidRows.length ? `<div class="eyebrow">Payment history</div><div class="stack">${paidRows.join('')}</div>` : ''}

        ${proCards.length ? `<div class="eyebrow">Your pet care professional</div><div class="stack">${proCards.join('')}</div>` : ''}
      </div>`;

    document.querySelectorAll('[data-pay-invoice]').forEach((btn) => {
      btn.onclick = () =>
        withBusy(btn, async () => {
          try {
            const { checkout_url } = await api('POST', `/api/portal/invoices/${btn.dataset.payInvoice}/checkout`);
            location.href = checkout_url; // Stripe-hosted payment page
          } catch (err) {
            toast(err.message);
          }
        });
    });
    wireNav();
  }

  // ----------------------------------------------------------- contract ----
  async function renderContract(contractId) {
    appEl.innerHTML = header('home') + `<div class="page loading">Loading agreement…</div>`;
    let contract, docHtml;
    try {
      // The overview endpoint doesn't return HTML; the document endpoint does.
      const res = await fetch(`/api/portal/contracts/${contractId}/document`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Could not load the agreement.');
      docHtml = await res.text();
      const ov = await api('GET', '/api/portal/overview');
      contract = ov.contracts.find((k) => k.id === contractId);
      if (!contract) throw new Error('Agreement not found.');
    } catch (err) {
      toast(err.message);
      location.hash = '#/home';
      return;
    }
    const signed = contract.status === 'signed';
    const signable = contract.status === 'draft' || contract.status === 'sent';

    appEl.innerHTML = header('home') + `
      <div class="page">
        ${signed ? `<div class="success-banner">✓ Signed ${esc(fmtDate(contract.signed_at))} by ${esc(contract.signer_name ?? '')} — this copy can never be altered.</div>` : ''}
        <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap">
          <a class="backlink" href="#/home">‹ Home</a>
          <span style="flex:1"></span>
          ${signed ? `
            <button class="btn btn-ghost" id="doc-download">⬇ Download</button>
            <button class="btn btn-quiet" id="doc-print">🖨 Print / save as PDF</button>` : ''}
        </div>
        <h1 class="page-title" style="margin-top:8px">${signed ? 'Your signed agreement' : 'Review & sign'}</h1>
        ${signable ? `<p class="page-sub">Read the agreement, then sign below. Questions? <a href="#/messages">Message your professional</a> before signing.</p>` : ''}

        <div class="sign-layout">
          ${PetPro.contractPane({ frameTitle: 'Agreement document' })}
          ${signable ? PetPro.signPadCard({
            nameLabel: 'Your full name',
            nameError: 'Please enter your name.',
            lockNote: 'Signing locks this agreement permanently — neither side can alter it afterwards.',
            submitLabel: 'Sign agreement',
          }) : ''}
        </div>
      </div>`;

    PetPro.wireContractPane(docHtml);

    if (signed) {
      document.getElementById('doc-print').onclick = (e) =>
        withBusy(e.target, async () => {
          const frame = document.createElement('iframe');
          frame.style.cssText = 'position:fixed;right:100%;bottom:100%;width:8.5in;height:11in;border:0';
          frame.setAttribute('aria-hidden', 'true');
          frame.srcdoc = docHtml;
          frame.onload = () => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
            setTimeout(() => frame.remove(), 60_000);
          };
          document.body.appendChild(frame);
        });
      document.getElementById('doc-download').onclick = () => {
        const blobUrl = URL.createObjectURL(new Blob([docHtml], { type: 'text/html' }));
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `signed-agreement-${contract.id.slice(0, 8)}.html`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
      };
    }

    if (!signable) { wireNav(); return; }

    // Signature canvas — same pad as the professional app's in-person flow.
    const sigPad = PetPro.createSignaturePad();

    document.getElementById('sig-submit').onclick = async (e) => {
      const name = sigPad.validate();
      if (!name) return;

      await withBusy(e.target, async () => {
        try {
          await api('POST', `/api/portal/contracts/${contractId}/sign`, {
            signer_name: name,
            signature_image: sigPad.dataUrl(),
          });
          toast('Agreement signed — a copy is yours to keep.', 'ok');
          renderContract(contractId);
        } catch (err) {
          toast(`${err.message} Your signature is still here — try again.`);
        }
      });
    };
    wireNav();
  }

  // ----------------------------------------------------- invoice return ----
  async function renderInvoiceReturn(invoiceId, canceled) {
    appEl.innerHTML = header('home') + `<div class="page loading">${canceled ? 'Checking payment status…' : 'Confirming your payment…'}</div>`;
    let invoice;
    try {
      invoice = await api('POST', `/api/portal/invoices/${invoiceId}/sync`);
    } catch (err) {
      toast(err.message);
      location.hash = '#/home';
      return;
    }
    const paid = invoice.status === 'paid';
    appEl.innerHTML = header('home') + `
      <div class="page">
        <div class="card" style="max-width:520px; margin:40px auto; text-align:center; padding:32px">
          <div style="font-size:40px">${paid ? '✅' : canceled ? '↩️' : '⏳'}</div>
          <h1 class="page-title" style="margin-top:10px">${paid ? 'Payment received' : canceled ? 'Payment canceled' : 'Payment processing'}</h1>
          <p class="page-sub" style="margin-top:6px">
            ${paid
              // No email promise here: receipts depend on the Resend domain
              // being verified and on Stripe's customer-receipt setting, and
              // a cold tester was told a receipt was coming that never came
              // (C-5). Point at payment history instead — that is always true.
              ? `${esc(fmtMoney(invoice.amount_cents))} — ${esc(invoice.description || 'Services')}. This payment now appears under Payment history on your portal home.`
              : canceled
                ? 'No charge was made. You can pay any time from your portal home.'
                : 'Stripe is still confirming this payment — it usually lands within a minute. Refresh, or check back shortly.'}
          </p>
          <button class="btn btn-primary" data-nav="#/home" style="margin-top:16px">Back to your portal</button>
        </div>
      </div>`;
    wireNav();
  }

  // ----------------------------------------------------------- messages ----
  let pollTimer = null;
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  async function renderMessages() {
    appEl.innerHTML = header('messages') + `<div class="page loading">Loading…</div>`;
    let ov;
    try {
      ov = await api('GET', '/api/portal/overview');
    } catch (err) {
      toast(err.message);
      location.hash = '#/home';
      return;
    }
    if (ov.clients.length === 0) {
      appEl.innerHTML = header('messages') + `<div class="page"><div class="card empty">No professional is linked to your account yet.</div></div>`;
      wireNav();
      return;
    }
    if (ov.clients.length === 1) {
      openThread(ov.clients[0].id);
      return;
    }
    appEl.innerHTML = header('messages') + `
      <div class="page">
        <h1 class="page-title">Messages</h1>
        <p class="page-sub">Choose who to message</p>
        <div class="stack">
          ${ov.clients.map((c) => `
            <div class="card client-row" data-open-thread="${c.id}" tabindex="0" role="link">
              <div class="who">
                <div class="name">${esc(c.professional ? (c.professional.business_name || c.professional.full_name) : 'Your professional')}</div>
                <div class="pets">${esc(petSummary(c.pets))}</div>
              </div>
              <span class="chev">›</span>
            </div>`).join('')}
        </div>
      </div>`;
    document.querySelectorAll('[data-open-thread]').forEach((el) => {
      el.onclick = () => openThread(el.dataset.openThread);
    });
    wireNav();
  }

  async function openThread(clientId) {
    try {
      const thread = await api('POST', '/api/portal/threads', { client_id: clientId });
      location.hash = `#/thread/${thread.id}`;
    } catch (err) {
      toast(err.message);
    }
  }

  async function renderThread(threadId) {
    appEl.innerHTML = header('messages') + `<div class="page loading">Loading conversation…</div>`;
    let messages;
    try {
      messages = await api('GET', `/api/portal/threads/${threadId}/messages`);
      await api('POST', `/api/portal/threads/${threadId}/read`);
    } catch (err) {
      toast(err.message);
      location.hash = '#/home';
      return;
    }

    const bubble = (m) => `
      <div class="msg ${m.sender_account_id === account.id ? 'mine' : 'theirs'}" id="msg-${m.id}">
        <div class="msg-body">${esc(m.body)}</div>
        <div class="msg-meta">${esc(fmtTime(m.created_at))}</div>
      </div>`;

    appEl.innerHTML = header('messages') + `
      <div class="page thread-page">
        <a class="backlink" href="#/home">‹ Home</a>
        <h1 class="page-title" style="margin-top:8px">Messages</h1>
        <div class="msg-list" id="msg-list">${messages.map(bubble).join('') || '<div class="card empty">Say hello 👋</div>'}</div>
        <form id="msg-form" class="msg-compose">
          <textarea id="msg-input" rows="1" placeholder="Write a message…" aria-label="Message"></textarea>
          <button class="btn btn-primary" type="submit">Send</button>
        </form>
      </div>`;

    const listEl = document.getElementById('msg-list');
    const inputEl = document.getElementById('msg-input');
    listEl.scrollTop = listEl.scrollHeight;

    let newest = messages.length ? messages[messages.length - 1].created_at : null;
    const appendNew = (msgs) => {
      for (const m of msgs) {
        if (document.getElementById(`msg-${m.id}`)) continue;
        listEl.insertAdjacentHTML('beforeend', bubble(m));
        newest = m.created_at;
      }
      listEl.scrollTop = listEl.scrollHeight;
    };

    // Polling delivery (the portal skips the Realtime socket on purpose —
    // the 8s poll is the professional app's designed fallback already).
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const fresh = await api('GET', `/api/portal/threads/${threadId}/messages${newest ? `?after=${encodeURIComponent(newest)}` : ''}`);
        if (fresh.length) {
          appendNew(fresh);
          api('POST', `/api/portal/threads/${threadId}/read`).catch(() => {});
        }
      } catch { /* transient — next tick retries */ }
    }, 8000);

    document.getElementById('msg-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = inputEl.value.trim();
      if (!body) return;
      inputEl.value = '';
      const draftId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const { message } = await api('POST', `/api/portal/threads/${threadId}/messages`, {
          body,
          client_draft_id: draftId,
        });
        appendNew([message]);
      } catch (err) {
        inputEl.value = body; // give the text back so nothing is lost
        toast(err.message);
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

  async function render() {
    stopPolling();
    document.body.classList.remove('login-bg');

    // The magic-link email lands here as `#access_token=…&type=magiclink`
    // (or `#error=…` when the link expired) — exchange it for a portal session.
    const raw = (location.hash || '').slice(1);
    if (raw.includes('access_token=') || raw.startsWith('error=')) {
      const rp = new URLSearchParams(raw);
      if (rp.get('access_token')) {
        appEl.innerHTML = `<div class="page loading">Signing you in…</div>`;
        try {
          const session = await api('POST', '/api/portal/session', { access_token: rp.get('access_token') });
          saveSession({ access_token: rp.get('access_token'), account: session.account });
          history.replaceState(null, '', location.pathname);
          location.hash = '#/home';
          return;
        } catch (err) {
          history.replaceState(null, '', location.pathname);
          toast(err.message);
          renderLogin();
          return;
        }
      }
      if (rp.get('error')) {
        history.replaceState(null, '', location.pathname);
        toast(rp.get('error_description') || 'That login link is invalid or has expired — request a new one.');
        renderLogin();
        return;
      }
    }

    const hash = location.hash || '#/home';
    const [path, queryString] = hash.slice(2).split('?');
    const params = new URLSearchParams(queryString ?? '');
    const parts = path.split('/').filter(Boolean);

    if (!token) { renderLogin(); return; }

    if (parts[0] === 'contract' && parts[1]) { renderContract(parts[1]); return; }
    if (parts[0] === 'invoice' && parts[1] && parts[2] === 'return') {
      renderInvoiceReturn(parts[1], params.get('canceled') === '1'); return;
    }
    if (parts[0] === 'thread' && parts[1]) { renderThread(parts[1]); return; }
    if (parts[0] === 'messages') { renderMessages(); return; }
    renderHome();
  }

  window.addEventListener('hashchange', render);
  render();
})();
