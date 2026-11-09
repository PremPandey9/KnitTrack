# Disposable Delay Alerts Phase 2 database test

This isolated PostgreSQL fixture models the Supabase roles, `auth.uid()`, the
buyer helper, source-table RLS, and verified orders/profiles columns required by
the proposal. It uses only fixed test identities and a test-only database
password. It does not read `.env.local` or contact Supabase.

The container image starts with the fixed `knittrack_bootstrap` superuser. Its
init script creates a separate `postgres` login role for migration execution
with `NOSUPERUSER`, `NOCREATEDB`, `CREATEROLE`, and `NOBYPASSRLS`, then assigns
only the database/schema/function grants and fixture ownership the proposal
preflight requires. The bootstrap superuser is never demoted. The runner and
helpers connect as this non-superuser `postgres` migration role after fixture
initialization. It is `NOINHERIT`; the explicit `authenticated` membership is
used only where test scripts issue `SET ROLE authenticated`.

Requirements: Docker Desktop with Compose, Node.js, and PowerShell. From the
repository root run:

```powershell
powershell -ExecutionPolicy Bypass -File supabase/tests/delay-alerts-phase-2/run.ps1
```

The runner generates a fresh Compose project name for every invocation and passes
that exact name to every helper. Its `finally` cleanup names the same project and
compose file, so Compose removes only that run's containers, networks, and
attached volumes. It does not run any global Docker cleanup command. The helpers
refuse to run without the generated project name from `run.ps1`. Review the
test-only fixed HMAC key in the test SQL before use; it must never be copied into
an environment variable or production database.

The fixture is a PostgreSQL compatibility harness, not a claim that the hosted
Supabase runtime has been tested. A hosted migration still requires separate
approval and a Supabase staging test.

For application signing-key generation, private-table provisioning, matching
key verification, rotation, rollout, and rollback, see the repository
[deployment guide](../../../deployment.md). That guide concerns real
environments; the fixed HMAC value in this fixture is disposable test data and
must never be reused outside the local fixture.
