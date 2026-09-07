# Test Project & Migrations

*How local development, tests, and schema changes stay off the production database. Decided 2026-07-19 (see `PHASE_2_ROADMAP.md` → Workstream 0 / test-data strategy).*

## The model: two Supabase projects

| Project | Holds | Reached by |
|---|---|---|
| **TEST** | throwaway data | your local `.env` — so `npm run dev`, `npm test`, `npm run migrate` all hit it |
| **PROD** | real accounts, signed contracts, payments | the deployed Render app (creds in Render's dashboard) + deliberate prod migrations only |

**Why two, and why prod can't just be "cleaned up":** the `events` log is append-only (a hard constraint enforced by a DB trigger) and accounts can't be hard-deleted (Workstream D exists because of this). So anything a test run creates in prod — accounts, events, messages — is there *forever*; a cleanup script can only deactivate + scrub, never remove. A separate TEST project can be reset or dropped wholesale, and it doubles as the place to **rehearse a migration before it touches prod**.

The wiring is deliberately boring: **there is no `SUPABASE_TEST_URL` vs `SUPABASE_PROD_URL` pair to pick between.** Local `.env` names exactly one project. Point it at TEST and you cannot fat-finger prod locally.

## One-time setup

1. **Create a second Supabase project** (e.g. "sitstayplay-test") in the Supabase dashboard.
2. **Copy `.env.example` to `.env`** and fill in the TEST project's values (Project Settings → API for the keys; Connect → Session pooler URI for `DATABASE_URL`).
3. **Bring the TEST schema up to date** — apply every migration to the empty project:
   ```powershell
   npm run migrate
   ```
   It prints `Target database: postgres.<ref>@...` first — confirm the ref is your **test** project — then applies `001` … `022` in order. Re-runs are safe (it records each in `schema_migrations` and skips applied ones).
4. Now `npm run dev` (in one terminal) + `npm test` (in another) exercise the TEST project. Nothing to remember per-run.

> `.env`, `.env.prod`, and any other `.env.*` are gitignored (only `.env.example` is tracked) — credentials never get committed.

## Current schema state — update this when you migrate

*The one place that says what the databases are actually at right now. **Dated changelog entries elsewhere are history, not state** — they were true when written and go stale silently.*

| Project | Ref | At migration | Confirmed |
|---|---|---|---|
| **PROD** | `tlfcilvsycjidmyrpsxi` | **025** (`profile_business_logo`) | 2026-08-24 |
| **TEST** | `dzejaycyjjaqajmatmjs` | **025** | 2026-08-24 |

**Update the row and the date every time you apply a migration to prod.** A stale entry here is worse than none — on 2026-08-24 a roadmap changelog line from 2026-08-01 ("migration 024 applied to the test project only; not yet applied to prod") was read as current state and produced a false "prod is two migrations behind" alarm, plus a needless `npm run migrate` against production.

**To check without changing anything**, run this in the Supabase SQL editor for the project (read-only — unlike `npm run migrate`, which applies whatever is pending as a side effect):

```sql
SELECT filename, applied_at FROM schema_migrations ORDER BY filename DESC LIMIT 5;
```

## Running a migration

**Against TEST (the default — and where you rehearse):**
```powershell
npm run migrate
```

**Against PROD (deliberate, only after it's verified on TEST):**
Keep a gitignored `.env.prod` holding the prod project's values (same shape as `.env`). Then point the runner at it for that one command:
```powershell
$env:DOTENV_CONFIG_PATH = ".env.prod"; npm run migrate; Remove-Item Env:\DOTENV_CONFIG_PATH
```
`dotenv` loads `.env.prod` instead of `.env` for that run. The `Target database:` line will show your **prod** ref — read it before letting it proceed. After migrating prod, deploy the app code that depends on the new schema, **and update the schema-state table above**.

⚠️ **The runner has no confirmation prompt.** It prints the target and then applies every pending migration. So `npm run migrate` is not a way to *check* prod — pointing it at prod to "see what's pending" applies whatever it finds. Use the read-only `SELECT` above for that. Verify the target ref before the command, not after:

```powershell
node -e "require('dotenv').config({path:'.env.prod'}); console.log(new URL(process.env.DATABASE_URL).username)"
```

## Rehearsing migration 022 (PH-2) — the current task

Migration 022 splits `pets.emergency_vet` into `emergency_vet_name` + `emergency_vet_phone` and backfills by splitting on the first digit run (the old column is kept). To rehearse:

1. `npm run migrate` against TEST (confirm the target ref).
2. In the Supabase TEST SQL editor, spot-check the split on real-shaped rows:
   ```sql
   SELECT emergency_vet, emergency_vet_name, emergency_vet_phone FROM pets;
   ```
   Confirm "Clinic, 5551234" landed as name `Clinic` / phone `5551234`, and a name-only value kept the phone `NULL`.
3. Run `npm run dev` + `npm test` against TEST and drive the pet form in the app (add a clinic + phone → the pet card shows a tappable number).
4. Only then apply 022 to PROD (the `.env.prod` command above) and deploy.

## Note on the `weekN-test.ps1` scripts

Those accept `-BaseUrl`. Anything that writes data should point at a **local server backed by TEST** (`http://localhost:3000`, the default), not `https://petpro-app.onrender.com` — the Render URL is prod, and running write-heavy tests against it is the other way test rows leak into production.
