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

1. **Create a second Supabase project** (e.g. "petpro-test") in the Supabase dashboard.
2. **Copy `.env.example` to `.env`** and fill in the TEST project's values (Project Settings → API for the keys; Connect → Session pooler URI for `DATABASE_URL`).
3. **Bring the TEST schema up to date** — apply every migration to the empty project:
   ```powershell
   npm run migrate
   ```
   It prints `Target database: postgres.<ref>@...` first — confirm the ref is your **test** project — then applies `001` … `022` in order. Re-runs are safe (it records each in `schema_migrations` and skips applied ones).
4. Now `npm run dev` (in one terminal) + `npm test` (in another) exercise the TEST project. Nothing to remember per-run.

> `.env`, `.env.prod`, and any other `.env.*` are gitignored (only `.env.example` is tracked) — credentials never get committed.

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
`dotenv` loads `.env.prod` instead of `.env` for that run. The `Target database:` line will show your **prod** ref — read it before letting it proceed. After migrating prod, deploy the app code that depends on the new schema.

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
