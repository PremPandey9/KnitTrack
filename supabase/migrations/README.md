# KnitTrack baseline migrations

These files define the core baseline for a **new Supabase project**. The project
owner reports that both migrations and the synthetic seed have been deployed
successfully to KnitTrack-Staging and that the three roles were tested there.
This does not make the files safe to replay or authorize applying them to
production. Review the assumptions below before using this baseline elsewhere.

## Order

1. `20261109090001_core_schema.sql` creates `buyers`, `profiles`, `orders`,
   `production_updates`, and `tna_milestones`, their constraints/indexes, and
   enables RLS.
2. `20261109090002_core_security.sql` creates the current-user helpers, core RLS
   policies and least-privilege grants, the production-update RPC and its
   validation/progress triggers, and the final-stage configuration RPC.
3. For a fresh **staging** project only, create these synthetic users in its
   Auth admin UI before running the seed: `qa-merchandiser@knittrack.example`,
   `qa-supervisor@knittrack.example`,
   `qa-supervisor-other@knittrack.example`, `qa-buyer-b@knittrack.example`,
   and `qa-buyer-c@knittrack.example`. The seed looks up their Auth UUIDs by
   email, creates profile/company/order/milestone rows, then submits production
   history through the authenticated RPC. It contains no passwords and cannot
   create Auth users. Run it with `psql` in one session, not SQL Editor:

   ```powershell
   psql --dbname "$env:KNITTRACK_STAGING_DB_URL" --password --set ON_ERROR_STOP=1 --file "supabase/seed/staging_demo.sql"
   ```

   Set `KNITTRACK_STAGING_DB_URL` to a staging connection URI **without a
   password** in the current PowerShell process. `--password` prompts for the
   database password interactively. Do not put a password in the command,
   script, `.env.local`, or Git. The seed refuses to proceed if users are missing or
   its fixed demo IDs/PO numbers already exist. It is a one-time seed; inspect
   existing records rather than deleting data to rerun it. Verify role
   isolation and app workflows before continuing.
4. Only after the core setup and those checks pass, review and apply
   `../proposals/delay-alerts-phase-2.sql` as a separate, one-time migration.
   That proposal is not a rerunnable migration, expects the `private` schema
   not to exist, and expects `orders` and `profiles` to have RLS enabled but
   not FORCE RLS.

Do not run `supabase/tests/delay-alerts-phase-2/bootstrap.sql` or other test
fixture SQL against staging. Do not enable `DELAY_ALERTS_ENABLED` as part of
the baseline setup.

## Assumptions requiring review

- Supabase provides `auth.users`, `auth.uid()`, roles `anon` and
  `authenticated`, and the `extensions` schema. `pgcrypto` must expose
  `extensions.hmac(bytea,bytea,text)`; migration 001 fails closed if it does
  not.
- Apply migrations as the trusted `postgres` owner. The Phase 2 proposal has
  additional migration-role/ownership preflight requirements; verify them on
  staging before applying that proposal.
- `profiles.role` is exactly one of `merchandiser`, `supervisor`, or `buyer`.
  Buyer profiles have a buyer ID; the other two roles do not. Profile creation
  and role changes are administrative operations, not authenticated app writes.
- Orders, profiles, production updates, and TNA milestones use the columns and
  types declared by the baseline schema. `tna_milestones` uses
  `milestone_name`, `planned_date`, `actual_date`, and `status`, matching the
  application queries. This is the schema for a new project, not a migration
  for an existing legacy database.
- `assigned_supervisor_id` and production update `supervisor_id` reference
  `auth.users(id)`. Application assignment checks the referenced profile role.
- Production update attribution is supervisor ID for a supervisor submission
  and NULL for a merchandiser submission. The update trigger always stores an
  empty `photo_url` until a reviewed Storage workflow exists.
- `orders.final_production_stage` can be configured or changed only before
  finished units have been counted. Once `completed_quantity` is positive, a
  different final stage is rejected. Reconciling finished quantities after
  production has been counted requires a separate, reviewed reconciliation
  process; quantities are never reset or recalculated automatically.
- Production update history is retained when deleting orders (RESTRICT); TNA
  rows also use RESTRICT. The app currently has no order-delete action.
- The production RPC remains `SECURITY INVOKER`. A narrowly scoped
  postgres-owned `SECURITY DEFINER` trigger validates insert attribution and
  updates order progress without granting authenticated users direct UPDATE
  access to `completed_quantity` or `current_stage`.

The role and RLS design must be independently reviewed and tested in a
disposable database and then verified in the KnitTrack-Staging Supabase project.
Static inspection is not proof of hosted Supabase behavior.
