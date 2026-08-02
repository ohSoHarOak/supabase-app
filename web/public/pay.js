/* PetPro Connect — public pay page (R-17, decisions D6/D7).

   The smallest of the three frontends on purpose. A pet owner who isn't
   standing next to their walker gets an emailed link and pays here, with no
   account and no password — the 256-bit token in ?t= is the whole authority.

   It can do exactly two things: show one invoice, and start a Stripe Checkout
   for it. There is no session, nothing is stored, and no other data is
   reachable from here. Formatters come from shared.js so this page can't
   drift from the other two (T-3 / PH-3). */

(() => {
  'use strict';

  const appEl = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const toast = PetPro.createToast(toastEl);
  const { esc, fmtMoney, fmtDate, fmtDateOnly, withBusy } = PetPro;

  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const justPaid = params.get('paid') === '1';
  const canceled = params.get('canceled') === '1';

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    let json;
    try { json = await res.json(); } catch { json = null; }
    if (!json || json.ok !== true) {
      throw new Error(json?.error?.message || `Request failed (${res.status}).`);
    }
    return json.data;
  }

  function shell(inner) {
    return `<div class="login-wrap"><div class="login-card">${inner}</div></div>`;
  }

  function renderInvalid(message) {
    appEl.innerHTML = shell(`
      <div class="login-brand">
        <div class="wordmark">PetPro Connect</div>
        <div class="tag">Invoice</div>
      </div>
      <div class="card empty" style="margin-top:8px">${esc(message)}</div>
      <div class="login-foot">If you were sent this link and it isn't working, reply to the email and your pet care professional can send a new one.</div>`);
  }

  async function render() {
    if (!token) return renderInvalid('This payment link is incomplete. Open the link straight from your email.');

    appEl.innerHTML = shell('<div class="page loading">Loading your invoice…</div>');
    let data;
    try {
      data = await api('GET', `/api/pay/${encodeURIComponent(token)}`);
    } catch (err) {
      return renderInvalid(err.message);
    }

    const { invoice, business_name: businessName } = data;
    const paid = invoice.status === 'paid';
    const payable = invoice.status === 'open' || invoice.status === 'draft';

    // Coming back from Stripe, the webhook may not have landed yet — say so
    // honestly rather than showing "unpaid" to someone who just paid.
    const pendingConfirm = justPaid && !paid;

    appEl.innerHTML = shell(`
      <div class="login-brand">
        <div class="wordmark">${esc(businessName)}</div>
        <div class="tag">${paid ? 'Paid invoice' : 'Your invoice'}</div>
      </div>

      ${paid ? '<div class="success-banner">✓ This invoice is paid. Thank you!</div>' : ''}
      ${pendingConfirm ? '<div class="card empty">Your payment is being confirmed — this can take a few seconds. Refresh in a moment.</div>' : ''}
      ${canceled && !paid ? '<div class="card empty">Payment cancelled — nothing was charged. You can still pay below.</div>' : ''}

      <div class="card fieldset" style="margin-top:8px; gap:10px">
        <div class="contract-row"><div class="what">
          <div class="meta">For</div>
          <div class="title">${esc(invoice.description || 'Pet care services')}</div>
        </div></div>
        <div class="contract-row"><div class="what">
          <div class="meta">Amount</div>
          <div class="title num" style="font-size:24px">${esc(fmtMoney(invoice.amount_cents))}</div>
        </div></div>
        ${invoice.due_date && !paid ? `<div class="contract-row"><div class="what">
          <div class="meta">Due</div><div class="title">${esc(fmtDateOnly(invoice.due_date))}</div>
        </div></div>` : ''}
        ${paid && invoice.paid_at ? `<div class="contract-row"><div class="what">
          <div class="meta">Paid</div><div class="title">${esc(fmtDate(invoice.paid_at))}</div>
        </div></div>` : ''}
      </div>

      ${payable ? `
        <button class="btn btn-primary" id="pay-btn" style="margin-top:16px">Pay ${esc(fmtMoney(invoice.amount_cents))}</button>
        <div class="login-foot">You'll be taken to Stripe's secure payment page. No account or password needed — ${esc(businessName)} never sees your card details.</div>`
      : !paid ? `<div class="card empty" style="margin-top:12px">This invoice is no longer payable. Reply to the email if you think that's wrong.</div>` : ''}
    `);

    const btn = document.getElementById('pay-btn');
    if (btn) {
      btn.onclick = () =>
        withBusy(btn, async () => {
          try {
            const { checkout_url } = await api('POST', `/api/pay/${encodeURIComponent(token)}/checkout`);
            location.href = checkout_url;
          } catch (err) {
            toast(err.message);
          }
        });
    }
  }

  render();
})();
