# KABS Multi-Tenant Plan: Super Admin + Dealer Admin

## Decisions (confirmed)
- **Auth:** "Continue with Google" only, via Google Cloud OAuth directly. No Firebase, no Supabase Auth, no passwords stored.
- **Signup:** normal self-signup: the first Google sign-in creates the dealer's company + Dealer Admin. KABS super admin is pre-created by email.
- **Data:** stays in Supabase (Postgres + Storage). Google only proves *who* the user is.
- **Pricing sheets:** each dealer uploads and owns its own, private. No sharing between dealers.
- **Users:** one Dealer Admin per company for now. The schema allows more users later.
- **Billing/plans:** out of scope until the product is finalized.

## Roles
| Role | Who | Access |
|---|---|---|
| `super_admin` | KABS | All dealers, AI Training, platform settings, impersonate |
| `dealer_admin` | Dealer | Only their own org's data (pricing, labor, rules, projects) |

## How auth works (Google identity, Supabase data)
1. User clicks Continue with Google, the server runs the OAuth code flow and verifies Google's signed ID token.
2. The server looks up `profiles.google_sub` in Supabase (or creates company + profile on first login).
3. The server issues its own signed session cookie (`kabs_session`, HS256 JWT, shared `SESSION_SECRET`).
4. Next.js and FastAPI both verify that cookie and load `org_id` + `role` from `profiles`.
5. Every query is filtered by that `org_id`. `org_id` is never taken from the request body.
6. Supabase RLS is locked to deny everything for `anon`/`authenticated`. Only the server's service-role key reads or writes.

Needs from you: a Google OAuth Client ID/Secret (Google Cloud console) and a random `SESSION_SECRET`.

## Phases

### Phase 0: Safety and cleanup
- Remove the hardcoded `admin@kabs.com` login and the cookie-existence check.
- Remove the public `/debug/env` endpoint; restrict CORS to the app origin.
- Remove ~190 committed `scan_result_*.json`, `pricing.db`, `db_data_dump.json`, debug logs; add to `.gitignore`.
- Delete the unused `agent_clean.py`.

### Phase 1: Database (SQL migration in `docs/`)
- New tables: `organizations(id, name, status, created_at)` and `profiles(id, firebase_uid unique, email, org_id, role, created_at)`.
- Add `org_id` to: `manufacturers`, `manufacturer_files`, `manufacturer_pricing`, `manufacturer_specifications`, `labor_charges`, `install_rules`, `install_rule_overrides`, `nkba_files`, `training_documents`, `quotation_projects`, `quotation_boms`, `manufacturer_detections`. (`quotation_boms` and detections can inherit via `project_id`.)
- Backfill all existing rows to a "KABS" org. Then make `org_id` NOT NULL and add indexes (`manufacturer_pricing(org_id, manufacturer_id)` is the big one, 44k+ rows).
- Replace all `USING (true)` policies with deny-all; make storage buckets private.
- Storage paths become `{org_id}/...`, served via signed URLs.

### Phase 2: Auth layer
- Frontend: Firebase login page (email/password + Google), `AuthProvider`, session cookie set via server action after token verification.
- Next.js: middleware and a shared `requireUser()` helper returning `{uid, org_id, role}`; used by every server action and API route.
- FastAPI: `get_current_user` dependency (verifies Firebase token) applied to all routers.
- First login flow: a Dealer Admin account is created by the Super Admin (invite). Google sign-in is only allowed if the email matches an invited profile, so there is no open signup.

### Phase 3: Tenant-scope the code
- Add the `org_id` filter to all Supabase calls: ~26 `manufacturer_pricing` queries, BOM generation, `upload-pricing`, `catalog-check`, labor, install rules, NKBA, training, projects.
- `pricing.py` caches (`_CONFIG_CACHE`, `_MFG_DB_CACHE`, `GLOBAL_LOOKUP_CACHE`, file cache) keyed by `org_id + manufacturer_id`.
- One pricing-upload path only (backend), removing the duplicate Next.js route.
- Replace `install_rule_overrides.client_name` free text with `org_id`.

### Phase 4: Dealer Admin panel (`/admin`)
Reuse the existing pages, scoped to the dealer's org:
- Dashboard, Manufacturers + Pricing sheets, Labor & Charges, Install/NKBA rules, Projects/Quotes.
- Company settings (name, logo, proposal terms).
- Hidden for dealers: AI Training and platform settings.
- The estimator flow (`/quotation-ai`) now requires login and shows only the dealer's own projects.

### Phase 5: Super Admin panel (`/super-admin`)
- Dealers list: create, suspend, delete; invite the first Dealer Admin.
- View-as dealer (impersonation, logged).
- AI Training and manufacturer research (global).
- Platform usage stats and an audit log.

### Phase 6: Verify
- Isolation tests: dealer A can never read or write dealer B's rows, files or cache, via UI, server actions or the API.
- Migration dry-run on a copy of the Supabase data before touching production.

## Order of work
Phase 0 > 1 > 2 > 3 > 4 > 5 > 6. Phases 1-3 must land together before any dealer is onboarded.
