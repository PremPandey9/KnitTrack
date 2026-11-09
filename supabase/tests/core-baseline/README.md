# Disposable KnitTrack core-baseline integration test

This is a separate PostgreSQL 17 fixture for the proposed core migrations and
staging seed. It does not reuse or edit the Delay Alerts fixture. It uses only
the fixed synthetic Auth IDs/emails in `auth-users.sql` and the disposable test
passwords in `compose.yaml`/`bootstrap.sql`. It never reads `.env.local`, calls a
hosted Supabase endpoint, or exposes a host port.

## Run

From the repository root, with Docker Desktop/Compose and PowerShell available:

```powershell
powershell -ExecutionPolicy Bypass -File supabase/tests/core-baseline/run.ps1
```

The runner starts one PostgreSQL 17 container under a fresh Compose project
name. Every Compose command uses that same name; the final `down --volumes`
targets only that project. There are no global Docker cleanup commands. The
migration files, seed folder, and test folder are mounted read-only. PostgreSQL
is reachable only inside the Compose network; no host port is published.

## Test sequence

1. Bootstrap a separate superuser and the non-superuser migration role named
   `postgres`; create only the minimal `auth.users`, `auth.uid()`, `extensions`,
   and pgcrypto test dependencies.
2. Apply both proposed migrations in timestamp order as the non-superuser.
3. Run the seed before Auth users exist and require a clean failure with no
   partial rows.
4. Insert synthetic Auth identities as the fixture bootstrap role, run the
   seed successfully, then require a duplicate-seed failure.
5. Verify the successful seed counts and run RLS, RPC, quantity, assignment,
   final-stage, permission, and Phase 2 compatibility assertions.

The harness intentionally supplies only a simplified Auth-compatible fixture.
Passing it does not prove Supabase Auth internals, hosted grants, migration
ownership, or staging configuration. Review the migration assumptions and run
separate staging checks only after approval.
