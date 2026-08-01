# Key Rotation Drill

*Written for Security Review #1 (Phase 2 Workstream Q). A credential leaks the moment it lands somewhere it shouldn't — a shared chat, a screenshot, a log, a bad paste (we've had two). This is the checklist for making it not matter. None of these takes more than ~5 minutes.*

**Rotate when:** a secret is pasted into any chat/ticket/screenshot, printed in a log, committed by accident, shared with a contractor who's leaving, or you just aren't sure. When in doubt, rotate — it's cheap.

---

## Where every credential lives

There are **two of everything** — a **TEST** project and a **PROD** project. A secret's blast radius depends on which stores hold it. Rotating one means updating **every** store in its row.

| Credential | What it grants | TEST copy lives in | PROD copy lives in |
|---|---|---|---|
| `SUPABASE_SERVICE_KEY` | Full DB access, **bypasses RLS** (runtime app) | local `.env`, GitHub Actions secrets | local `.env.prod`, **Render** |
| `SUPABASE_ANON_KEY` | Public-by-design key (browser Realtime) | local `.env`, GitHub Actions secrets | local `.env.prod`, Render |
| `DATABASE_URL` (DB password) | Direct Postgres owner (migrations only) | local `.env`, GitHub Actions secrets | local `.env.prod` (usually **not** Render) |
| `STRIPE_SECRET_KEY` | Charge/refund on the Stripe account | local `.env`, GitHub Actions secrets | local `.env.prod`, Render |
| `STRIPE_WEBHOOK_SECRET` | Forge webhook events | local `.env` | local `.env.prod`, Render |
| `RESEND_API_KEY` | Send email as us | local `.env` | local `.env.prod`, Render |

> `SUPABASE_URL`, `EMAIL_FROM`, `PORT` are identifiers/config, not secrets — no rotation needed.
> Reminder: **PROD creds never go in a committed file.** `.env` and `.env.*` are gitignored (only `.env.example` is tracked). GitHub Actions secrets hold **TEST** values only — CI never touches prod.

---

## The generic drill (any credential)

1. **Mint the new secret** at the source (Supabase / Stripe / Resend dashboard).
2. **Update every store in that credential's row above** — local file(s), Render, GitHub Actions secrets — with the new value.
3. **Redeploy / restart** whatever consumes it (Render redeploys on an env-var change).
4. **Verify** it works (per-credential checks below).
5. **Invalidate the old secret** (most dashboards do this on rotation; where it's a "create new + delete old" flow, delete the old one **after** step 4 confirms the new one works).

Do step 2 for **all** stores before deleting the old key, or you'll take down whatever you missed.

---

## Per-credential procedures

### Supabase DB password (`DATABASE_URL`)
Lowest blast radius — only the migration runner uses it, so **no app downtime**.
1. Supabase dashboard → the right project → **Settings/Database → Reset database password** → copy.
2. Update `DATABASE_URL` in the store(s): local `.env` (test) or `.env.prod` (prod), and the **GitHub Actions `DATABASE_URL` secret** if it was the test password.
   - **URL-encode special characters** in the password (e.g. `%` → `%25`) or the connection URI won't parse.
3. Verify: `npm run migrate` (or the `.env.prod` variant) prints `Target database: …` and `Done — nothing to apply.` Confirm the ref in that line is the project you meant.

### Supabase service + anon keys (`SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`)
Highest blast radius: Supabase rotates the project's **JWT secret**, which invalidates **both** keys **and logs out every user session** at once. Schedule it.
1. Supabase dashboard → **Settings → API → JWT Keys → rotate** (or roll the secret). Copy the **new** `service_role` and `anon` keys.
2. Update **both** keys everywhere in their rows: local `.env` (test) or `.env.prod` (prod), **Render** (prod), **GitHub Actions secrets** (test).
3. Render redeploys automatically on the env change. Verify: `GET /health` is 200, then log in through the UI (old sessions are gone — everyone re-authenticates once).

### Stripe secret key (`STRIPE_SECRET_KEY`)
1. Stripe dashboard → **Developers → API keys → Roll** the secret key. Stripe keeps the old one alive for a short grace window you set.
2. Update `STRIPE_SECRET_KEY` in local file(s), **Render**, and the **GitHub Actions secret** (test key).
3. Verify: create + pay a test invoice (or run `npm test`, whose step 11 creates a Stripe Checkout). Then **expire the old key** in Stripe.

### Stripe webhook signing secret (`STRIPE_WEBHOOK_SECRET`)
1. Stripe dashboard → **Developers → Webhooks → [endpoint] → Roll signing secret**.
2. Update `STRIPE_WEBHOOK_SECRET` in local file(s) and **Render**.
3. Verify: send a test event from the Stripe webhook page → the app returns 200 (signature verified).

### Resend API key (`RESEND_API_KEY`)
1. Resend dashboard → **API Keys → Create** a new key.
2. Update `RESEND_API_KEY` in local file(s) and **Render**.
3. Verify: trigger one email (e.g. send an invoice), confirm delivery, then **delete the old key** in Resend.

---

## After any rotation
- `GET /health` → 200.
- `npm test` green against the affected environment.
- Nothing new committed: `git status` clean, and the value never appears in `git log -p`.
- If the leak was in a chat/ticket/screenshot, the rotation is what closes it — the exposed string is now worthless.
