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
  const { esc, fmtDate, fmtTime, fmtDateOnly, fmtMoney, fmtPhone, withBusy } = PetPro;

  function fmtDay(iso) {
    return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  // R-9: species named only for non-dogs — "(Beagle)" already reads as a dog,
  // but a cat has to say so. Mirrors petDetail() in app.js.
  function petSummary(pets) {
    if (!pets?.length) return '';
    return pets.map((p) => {
      const species = p.species && p.species !== 'dog' ? p.species : null;
      const detail = [p.breed, species].filter(Boolean).join(' ');
      return detail ? `${p.name} (${detail})` : p.name;
    }).join(' · ');
  }
  // Owner-facing cadence wording. Deliberately plainer than the professional
  // app's CADENCES: an owner reads "billed per visit", not "per_visit".
  const CADENCES = {
    per_visit: 'per visit', per_day: 'per day', weekly: 'weekly',
    biweekly: 'every 2 weeks', monthly: 'monthly',
    per_package: 'per package', one_time: 'one-time',
  };

  const PAW_LOGIN = `<svg width="64" height="64" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#6D9280"/><g fill="#F7F2EB"><ellipse cx="15" cy="16" rx="3.4" ry="4.4" transform="rotate(-18 15 16)"/><ellipse cx="29" cy="16" rx="3.4" ry="4.4" transform="rotate(18 29 16)"/><ellipse cx="9.5" cy="23.5" rx="2.8" ry="3.6" transform="rotate(-38 9.5 23.5)"/><ellipse cx="34.5" cy="23.5" rx="2.8" ry="3.6" transform="rotate(38 34.5 23.5)"/><path d="M22 21c4.4 0 8.4 3.5 8.4 7.6 0 2.9-2.2 4.6-4.7 4.6-1.5 0-2.6-0.6-3.7-0.6s-2.2 0.6-3.7 0.6c-2.5 0-4.7-1.7-4.7-4.6C13.6 24.5 17.6 21 22 21z"/></g></svg>`;

  // O-2: last known unread count, so the badge survives navigation between
  // renders without re-fetching the overview on every page.
  let unreadCount = 0;

  function header(active) {
    const tab = (id, label) =>
      `<a href="#/${id}" class="${active === id ? 'active' : ''}">${label}${
        id === 'messages' && unreadCount ? ` <span class="unread-dot">${unreadCount}</span>` : ''
      }</a>`;
    return `
      <header class="app-header"><div class="inner">
        <a class="brand" href="#/home">🐾 PetPro Connect</a>
        <nav class="app-nav">
          ${tab('home', 'Home')}
          ${tab('billing', 'Billing')}
          ${tab('messages', 'Messages')}
          ${tab('profile', 'Profile')}
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
        <!-- C-6: said before the field, not after it — a cold tester went
             looking for a signup button because this sat below the button. -->
        <p class="login-lede">There's no account to create and no password to remember. Enter your email and we'll send you a secure link.</p>
        <form id="login-form">
          <div><label for="f-email">Your email</label>
            <input id="f-email" type="email" required autocomplete="username" placeholder="The email your walker has on file" /></div>
          <button class="btn btn-primary" type="submit">Email me a login link</button>
        </form>
        <div class="login-foot">The link lasts about an hour — check spam if it's slow to arrive.</div>
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

    // R-16: the owner is told before their agreement lapses, not after.
    // Date-only maths, so a term ending today reads as today at any hour.
    const daysUntil = (ymd) => {
      const [y, m, d] = String(ymd).split('-').map(Number);
      const today = new Date();
      return Math.round(
        (new Date(y, m - 1, d) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5
      );
    };
    const signedContracts = ov.contracts.filter((k) => k.status === 'signed');
    const expiringSoon = signedContracts.filter((k) => {
      if (!k.end_date) return false;
      const days = daysUntil(k.end_date);
      return days >= 0 && days <= (k.renewal_notice_days ?? 30);
    });

    // Cues: contracts awaiting signature, invoices awaiting payment.
    const unsigned = ov.contracts.filter((k) => k.status === 'draft' || k.status === 'sent');
    const openInvoices = ov.invoices.filter((inv) => inv.status === 'open' || inv.status === 'draft');
    unreadCount = ov.unread_messages ?? 0;
    const cues = [
      ...(unreadCount ? [`
        <div class="card cue-card">
          <div class="cue-text">
            <div class="cue-title">${unreadCount} new message${unreadCount > 1 ? 's' : ''} from ${esc(proName(ov.clients[0]?.id))}</div>
            <div class="cue-sub">Tap to read and reply.</div>
          </div>
          <button class="btn btn-primary" data-nav="#/messages">Read</button>
        </div>`] : []),
      ...unsigned.map((k) => `
        <div class="card cue-card">
          <div class="cue-text">
            <div class="cue-title">${esc(proName(k.client_id))} sent an agreement to sign</div>
            <div class="cue-sub">Generated ${esc(fmtDate(k.created_at))}</div>
          </div>
          <button class="btn btn-primary" data-nav="#/contract/${k.id}">Review &amp; sign</button>
        </div>`),
      // R-16: informational, not an action — renewing is the walker's move,
      // so this deliberately offers "message them" rather than a button
      // implying the owner can renew it themselves.
      ...expiringSoon.map((k) => {
        const days = daysUntil(k.end_date);
        return `
        <div class="card cue-card">
          <div class="cue-text">
            <div class="cue-title">Your agreement with ${esc(proName(k.client_id))} ends ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}</div>
            <div class="cue-sub">Runs until ${esc(fmtDateOnly(k.end_date))}. ${esc(proName(k.client_id))} will be in touch about continuing — message them if you have questions.</div>
          </div>
          <button class="btn btn-quiet" data-nav="#/messages">Message</button>
        </div>`;
      }),
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

    const signedRows = signedContracts.map((k) => `
      <div class="card contract-row">
        <div class="what">
          <div class="title">Service agreement with ${esc(proName(k.client_id))}</div>
          <div class="meta">Signed ${esc(fmtDate(k.signed_at))} by ${esc(k.signer_name ?? '')}${
            k.end_date ? ` · runs until ${esc(fmtDateOnly(k.end_date))}` : ''
          }</div>
        </div>
        <span class="pill pill-sage">signed</span>
        <div class="row-actions"><button class="btn btn-ghost" data-nav="#/contract/${k.id}">View</button></div>
      </div>`);

    // R-15: what they actually signed up for — service, price, cadence — so
    // the home screen answers "what am I paying for?" without opening the
    // agreement. Sessions are shown when the service is a package.
    const planRows = (ov.services ?? []).map((s) => {
      // R-2/R-3 + R-15: "how many walks have I paid for and got left?" is the
      // question the founder's tester actually asked. A used-up package still
      // shows, so a client can see they need to buy more rather than being
      // surprised by an invoice after the next walk.
      const b = s.session_balance;
      const prepaid = b
        ? b.remaining > 0
          ? `<span class="pill pill-sage">${esc(b.remaining)} of ${esc(b.purchased)} visits left</span>`
          : `<span class="pill pill-alert">all ${esc(b.purchased)} prepaid visits used</span>`
        : '';
      return `
      <div class="card contract-row">
        <div class="what">
          <div class="title">${esc(s.name)}</div>
          <div class="meta">${esc(fmtMoney(s.price_cents))} ${esc(CADENCES[s.billing_cadence] ?? s.billing_cadence)}${
            s.session_count ? ` · ${esc(s.session_count)} sessions included` : ''
          }${s.duration_minutes ? ` · ${esc(s.duration_minutes)} min` : ''}${
            s.end_date ? ` · until ${esc(fmtDateOnly(s.end_date))}` : ''
          }</div>
        </div>
        ${prepaid}
      </div>`;
    });

    const paidTotal = ov.invoices
      .filter((inv) => inv.status === 'paid')
      .reduce((sum, inv) => sum + inv.amount_cents, 0);

    appEl.innerHTML = header('home') + `
      <div class="page">
        <h1 class="page-title">${firstName ? `Welcome, ${esc(firstName)}` : 'Welcome'}</h1>
        <p class="page-sub">${ov.clients.map((c) => esc(petSummary(c.pets))).filter(Boolean).join(' · ') || 'Your pet care, in one place'}</p>

        ${cues.length ? `<div class="eyebrow">Needs your attention</div><div class="stack">${cues.join('')}</div>` : ''}

        <div class="eyebrow">Upcoming visits</div>
        <div class="stack">${apptRows.join('') || '<div class="card empty">No upcoming visits scheduled.</div>'}</div>

        ${planRows.length ? `<div class="eyebrow">Your plan</div><div class="stack">${planRows.join('')}</div>` : ''}

        <div class="eyebrow">Agreements</div>
        <div class="stack">${signedRows.join('') || '<div class="card empty">No signed agreements yet.</div>'}</div>

        ${paidTotal ? `
        <div class="eyebrow">Billing</div>
        <div class="card contract-row">
          <div class="what">
            <div class="title">${esc(fmtMoney(paidTotal))} paid to date</div>
            <div class="meta">Every invoice, open and paid, with dates and what it covered.</div>
          </div>
          <div class="row-actions"><button class="btn btn-quiet" data-nav="#/billing">View billing</button></div>
        </div>` : ''}
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

  // ---------------------------------------------------------- profile ----
  // C-2, read-only per D2: the owner sees what their professional holds on
  // file and messages them to correct it. No write path exists by design —
  // the client record belongs to the professional's CRM.
  // ----------------------------------------------------------- billing ----
  // R-12: the old payment history was a flat tail on the home screen — no
  // total, no dates beyond "Paid <date>", no way to see an open invoice next
  // to a paid one, and nothing said what a payment covered beyond a
  // description that is often blank. This is the whole billing record,
  // newest first, grouped by year so a date range is readable at a glance.
  // (A printable per-invoice document is still P2-7 — see C-4.)
  async function renderBilling() {
    appEl.innerHTML = header('billing') + `<div class="page loading">Loading your billing…</div>`;
    let ov;
    try {
      ov = await api('GET', '/api/portal/overview');
    } catch (err) {
      toast(err.message);
      appEl.innerHTML = header('billing') + `<div class="page"><div class="empty">Couldn't load your billing. <a class="backlink" href="#/billing">Retry</a></div></div>`;
      return;
    }
    unreadCount = ov.unread_messages ?? 0;

    const clientById = Object.fromEntries(ov.clients.map((c) => [c.id, c]));
    const proName = (clientId) => {
      const pro = clientById[clientId]?.professional;
      return pro ? (pro.business_name || pro.full_name) : 'your professional';
    };
    const serviceById = Object.fromEntries((ov.services ?? []).map((s) => [s.id, s]));

    // Void invoices are shown too: an owner who saw a charge appear and then
    // vanish deserves to see that it was cancelled, not to wonder.
    const invoices = [...ov.invoices].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    const paid = invoices.filter((inv) => inv.status === 'paid');
    const open = invoices.filter((inv) => inv.status === 'open' || inv.status === 'draft');
    const paidTotal = paid.reduce((sum, inv) => sum + inv.amount_cents, 0);
    const openTotal = open.reduce((sum, inv) => sum + inv.amount_cents, 0);

    const pill = {
      paid: '<span class="pill pill-sage">paid</span>',
      open: '<span class="pill pill-alert">due</span>',
      draft: '<span class="pill pill-draft">draft</span>',
      void: '<span class="pill pill-draft">cancelled</span>',
      uncollectible: '<span class="pill pill-draft">written off</span>',
    };

    const invoiceRow = (inv) => {
      const svc = inv.service_id ? serviceById[inv.service_id] : null;
      const covered = inv.description || svc?.name || 'Services';
      return `
        <div class="card contract-row">
          <div class="what">
            <div class="title">${esc(fmtMoney(inv.amount_cents))} — ${esc(covered)}</div>
            <div class="meta">${esc(proName(inv.client_id))} · billed ${esc(fmtDate(inv.created_at))}${
              inv.status === 'paid' && inv.paid_at ? ` · paid ${esc(fmtDate(inv.paid_at))}` : ''
            }${
              inv.status !== 'paid' && inv.due_date ? ` · due ${esc(fmtDateOnly(inv.due_date))}` : ''
            }</div>
          </div>
          ${pill[inv.status] ?? ''}
          ${inv.status === 'open' || inv.status === 'draft'
            ? `<div class="row-actions"><button class="btn btn-primary" data-pay-invoice="${inv.id}">Pay now</button></div>`
            : ''}
        </div>`;
    };

    // Group by calendar year — the cheapest thing that makes a multi-year
    // history scannable without building a date-range picker nobody asked for.
    const byYear = new Map();
    for (const inv of invoices) {
      const year = new Date(inv.created_at).getFullYear();
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(inv);
    }
    const yearSections = [...byYear.entries()].map(([year, rows]) => {
      const yearPaid = rows
        .filter((inv) => inv.status === 'paid')
        .reduce((sum, inv) => sum + inv.amount_cents, 0);
      return `
        <div class="eyebrow">${year}${yearPaid ? ` · ${esc(fmtMoney(yearPaid))} paid` : ''}</div>
        <div class="stack">${rows.map(invoiceRow).join('')}</div>`;
    });

    appEl.innerHTML = header('billing') + `
      <div class="page">
        <h1 class="page-title">Billing</h1>
        <p class="page-sub">Every invoice from your pet care professional — what it covered, when it was billed, and when it was paid.</p>

        <div class="stack" style="margin-top:16px">
          <div class="card contract-row">
            <div class="what">
              <div class="meta">Paid to date</div>
              <div class="title">${esc(fmtMoney(paidTotal))}</div>
            </div>
            ${openTotal ? `<div class="what" style="text-align:right">
              <div class="meta">Awaiting payment</div>
              <div class="title">${esc(fmtMoney(openTotal))}</div>
            </div>` : ''}
          </div>
        </div>

        ${yearSections.join('') || '<div class="card empty">No invoices yet.</div>'}
      </div>`;

    document.querySelectorAll('[data-pay-invoice]').forEach((btn) => {
      btn.onclick = () =>
        withBusy(btn, async () => {
          try {
            const { checkout_url } = await api('POST', `/api/portal/invoices/${btn.dataset.payInvoice}/checkout`);
            location.href = checkout_url;
          } catch (err) {
            toast(err.message);
          }
        });
    });
    wireNav();
  }

  async function renderProfile() {
    appEl.innerHTML = header('profile') + `<div class="page loading">Loading your details…</div>`;
    let ov;
    try {
      ov = await api('GET', '/api/portal/overview');
    } catch (err) {
      toast(err.message);
      appEl.innerHTML = header('profile') + `<div class="page"><div class="empty">Couldn't load your details. <a class="backlink" href="#/profile">Retry</a></div></div>`;
      return;
    }
    unreadCount = ov.unread_messages ?? 0;

    const row = (label, value) => value
      ? `<div class="contract-row"><div class="what"><div class="meta">${esc(label)}</div><div class="title">${esc(value)}</div></div></div>`
      : '';

    // R-14: the old card ran the owner's details and their walker's details
    // together, with the walker's name rendered as a bare title — so "is this
    // my name or theirs? is this a person or a business?" had no answer on
    // screen. Two separately headed cards now, and every line is labelled,
    // including business name and contact name as distinct rows.
    const sections = ov.clients.map((c) => `
      <div class="profile-block">
        <div class="eyebrow">Your details</div>
        <div class="card fieldset">
          ${row('Your name', c.full_name)}
          ${row('Your email', c.email)}
          ${row('Your phone', c.phone ? fmtPhone(c.phone) : '')}
          ${row('Your address', c.address)}
          ${row('Your emergency contact', [c.emergency_contact_name, c.emergency_contact_phone ? fmtPhone(c.emergency_contact_phone) : '']
            .filter(Boolean).join(' · '))}
          ${(c.pets ?? []).length ? row('Your pets', petSummary(c.pets)) : ''}
        </div>
        ${c.professional ? `
        <div class="eyebrow">Your pet care professional</div>
        <div class="card fieldset">
          ${row('Business name', c.professional.business_name)}
          ${row('Your contact there', c.professional.full_name)}
          ${c.professional.phone ? `
            <div class="contract-row"><div class="what">
              <div class="meta">Their phone</div>
              <div class="title"><a href="tel:${esc(String(c.professional.phone).replace(/[^+\d]/g, ''))}">${esc(fmtPhone(c.professional.phone))}</a></div>
            </div></div>` : ''}
          ${c.professional.email ? `
            <div class="contract-row"><div class="what">
              <div class="meta">Their email</div>
              <div class="title"><a href="mailto:${esc(c.professional.email)}">${esc(c.professional.email)}</a></div>
            </div></div>` : ''}
          <div class="form-foot" style="margin-top:0">
            <div class="spacer"></div>
            <button class="btn btn-quiet" data-nav="#/messages">Message them</button>
          </div>
        </div>` : ''}
      </div>`);

    appEl.innerHTML = header('profile') + `
      <div class="page">
        <h1 class="page-title">Profile</h1>
        <p class="page-sub">Your details as your professional has them on file, and how to reach your professional. Something wrong? Message them and they'll update it.</p>
        ${sections.join('') || '<div class="card empty">No details on file yet.</div>'}
      </div>`;
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
      unreadCount = 0; // opening the thread is what clears the badge
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
    if (parts[0] === 'billing') { renderBilling(); return; }
    if (parts[0] === 'profile') { renderProfile(); return; }
    renderHome();
  }

  window.addEventListener('hashchange', render);
  render();
})();
