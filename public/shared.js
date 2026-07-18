/* PetPro Connect — shared frontend module (T-3).

   The professional app (app.js) and the pet-owner portal (portal.js) are two
   independent hash-routed frontends that share one styles.css. Everything in
   here was duplicated between them; keeping two copies is what caused the F-8
   regression, where a contract-pane change landed in one frontend and the
   other silently broke for real testers.

   Loaded by index.html and portal.html as a plain <script defer> BEFORE the
   page's own file — no build step, matching the rest of this project.

   WHAT BELONGS HERE: anything identical in both frontends, and especially
   anything coupled to styles.css (markup carrying [data-*] structural hooks).
   WHAT DOES NOT: anything legitimately different. `api()` stays per-frontend
   because its 401 branch differs by design — the professional re-logs in with
   a password, the owner requests a new magic link.

   scripts/check-structure.mjs verifies the [data-*] hooks below survive. */

window.PetPro = (() => {
  'use strict';

  // ------------------------------------------------------------ format ----

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function fmtMoney(cents) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  /* US 10/11-digit numbers become (555)010-1234; anything else — international,
     extensions, letters — is left exactly as typed. Stored values only change
     when a form saves them. */
  function fmtPhone(raw) {
    const text = String(raw ?? '').trim();
    if (!text || !/^[\d\s\-().+]+$/.test(text)) return text;
    const digits = text.replace(/\D/g, '');
    const us =
      digits.length === 10 ? digits
      : digits.length === 11 && digits[0] === '1' ? digits.slice(1)
      : null;
    return us ? `(${us.slice(0, 3)})${us.slice(3, 6)}-${us.slice(6)}` : text;
  }

  /* Format phone fields when the user leaves them. Delegated because these
     forms are re-rendered constantly — per-input listeners would need
     re-wiring on every render. Call once at startup. */
  function installPhoneFormatting() {
    document.addEventListener('focusout', (e) => {
      if (e.target instanceof HTMLInputElement && 'phone' in e.target.dataset) {
        e.target.value = fmtPhone(e.target.value);
      }
    });
  }

  // ---------------------------------------------------------------- ui ----

  /* Disable a button for the duration of an async action. The `btn.disabled`
     check is the double-submit guard — without it a fast double-click fires
     the action twice. (The portal's old copy of this lacked that guard; it
     drifted from the professional app's. Unified here.) */
  async function withBusy(btn, fn) {
    if (!btn) return fn();
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

  /* Build a toast function bound to a page's toast element. Errors linger
     twice as long as confirmations — there is usually something to read. */
  function createToast(toastEl) {
    let timer;
    return function toast(message, kind = 'error') {
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
      clearTimeout(timer);
      timer = setTimeout(() => { toastEl.hidden = true; }, kind === 'ok' ? 4000 : 8000);
    };
  }

  // ------------------------------------------------- contract sign pane ----

  /* The contract viewer: zoom controls + the scroll shell + the sandboxed
     iframe. The iframe is sandboxed so the contract's own styles can't leak
     into the app and app scripts can't touch the document.

     [data-doc-shell] and [data-doc-frame] are structural hooks — styles.css
     has a STRUCTURAL CONTRACT block keyed on them. Don't rename them without
     updating that block and scripts/check-structure.mjs. */
  function contractPane({ frameTitle }) {
    return `
      <div class="doc-pane">
        <div class="doc-tools">
          <span class="hint">Zoom</span>
          <button class="btn btn-ghost" id="zoom-out" type="button" aria-label="Zoom out">−</button>
          <span class="num" id="zoom-label" aria-live="polite">100%</span>
          <button class="btn btn-ghost" id="zoom-in" type="button" aria-label="Zoom in">＋</button>
        </div>
        <div class="doc-shell" data-doc-shell>
          <iframe class="doc-frame" id="doc-frame" data-doc-frame title="${esc(frameTitle)}" sandbox=""></iframe>
        </div>
      </div>`;
  }

  /* Load a contract into the pane and wire its zoom controls. Scaling the
     iframe while compensating its width makes the document reflow to the
     visible width at every zoom level, instead of growing a horizontal
     scrollbar. Call after the markup from contractPane() is in the DOM. */
  function wireContractPane(html) {
    const frame = document.getElementById('doc-frame');
    frame.srcdoc = html;

    const label = document.getElementById('zoom-label');
    const out = document.getElementById('zoom-out');
    const inn = document.getElementById('zoom-in');
    let zoom = 1;
    const apply = () => {
      frame.style.width = `${100 / zoom}%`;
      frame.style.height = `${100 / zoom}%`;
      frame.style.transform = `scale(${zoom})`;
      label.textContent = `${Math.round(zoom * 100)}%`;
      out.disabled = zoom <= 0.55;
      inn.disabled = zoom >= 1.75;
    };
    out.onclick = () => { zoom = Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10); apply(); };
    inn.onclick = () => { zoom = Math.min(1.8, Math.round((zoom + 0.1) * 10) / 10); apply(); };
    apply();
  }

  /* The signature capture card. Labels differ between the two frontends (a
     professional signs on a client's behalf in person; an owner signs for
     themselves), so they're parameterised — the structure is not.

     [data-sigpad] is a structural hook: styles.css must keep touch-action:
     none on it or a finger drag scrolls the page instead of drawing, which
     makes signing impossible on phones. */
  function signPadCard({ nameLabel, nameValue = '', nameError, lockNote, submitLabel }) {
    return `
      <div class="card sign-pad-card">
        <div>
          <label for="sig-name">${esc(nameLabel)}</label>
          <input id="sig-name" value="${esc(nameValue)}" />
          <div class="field-error" id="name-err" hidden>${esc(nameError)}</div>
        </div>
        <div>
          <label for="sigpad">Signature</label>
          <canvas id="sigpad" data-sigpad aria-label="Signature area — draw with mouse or finger"></canvas>
          <p class="sig-hint">Sign above with a finger or mouse</p>
          <div class="field-error" id="sig-err" hidden>A signature is required — sign in the box above.</div>
        </div>
        <div class="lock-note">
          <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
          ${esc(lockNote)}
        </div>
        <div style="display:flex; gap:10px">
          <button class="btn btn-ghost" id="sig-clear" type="button">Clear</button>
          <button class="btn btn-primary" style="flex:1" id="sig-submit" type="button">${esc(submitLabel)}</button>
        </div>
      </div>`;
  }

  /* Wire the signature canvas and its Clear button. Returns helpers the
     caller's submit handler needs — what differs between the frontends is
     only what happens on submit (different endpoint, different follow-up),
     never the drawing itself.

     The ResizeObserver + devicePixelRatio dance keeps strokes sharp and the
     pointer-to-canvas mapping correct when the pad is resized or the page is
     rendered on a high-DPI screen. */
  function createSignaturePad() {
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

    return {
      /** Name + signature both present? Shows the inline errors if not. */
      validate() {
        const name = document.getElementById('sig-name').value.trim();
        document.getElementById('name-err').hidden = Boolean(name);
        document.getElementById('sig-err').hidden = drew;
        pad.classList.toggle('err', !drew);
        return name && drew ? name : null;
      },
      dataUrl: () => pad.toDataURL('image/png'),
    };
  }

  return {
    esc, fmtDate, fmtTime, fmtMoney, fmtPhone, installPhoneFormatting,
    withBusy, createToast,
    contractPane, wireContractPane, signPadCard, createSignaturePad,
  };
})();
