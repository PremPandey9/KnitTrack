# KnitTrack

KnitTrack is a production order tracking application for knitwear exporters. It is built with Next.js 16, TypeScript, and Supabase.

## Features

- Email/password sign-in backed by Supabase Auth.
- Role-based access for merchandisers, supervisors, and buyers, enforced in server-side code and Supabase RLS.
- Order creation and management, supervisor assignment, TNA milestones, and production update history.
- Finished-goods progress tracking that does not count intermediate-stage throughput as completed quantity.
- Buyer portal with read-only access to orders, production history, and milestones belonging to that buyer.
- Merchandiser delay-risk calculations based on finished-stage production history.

## Requirements and local setup

Use Node.js 20.9.0 or newer and npm. From the repository root:

```bash
npm ci
```

Create `.env.local` from `.env.example` only if `.env.local` does not already exist, then set the URL and publishable key for the Supabase project you intend to use. Do not overwrite existing environment settings without checking which project they target. `.env.local` is ignored by Git.

Required Supabase variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (preferred); `NEXT_PUBLIC_SUPABASE_ANON_KEY` is supported as a legacy fallback.

These are public client configuration values. The application does not use a Supabase service-role key. Never put one in a `NEXT_PUBLIC_*` variable, source file, or browser bundle.

Run the development server:

```bash
npm run dev
```

Open the local URL printed by Next.js. For a separate staging session, use a dedicated terminal/process with the staging URL and publishable key; public `NEXT_PUBLIC_*` values are embedded into client code during production builds.

## Roles

| Role | Access |
| --- | --- |
| Merchandiser | View and manage orders, assign supervisors, manage TNA milestones, inspect production updates, and review delay-risk calculations. |
| Supervisor | View assigned orders and submit production updates for those orders. |
| Buyer | Read only the buyer's own orders, progress, production history, and milestones. |

Buyer isolation and write restrictions are enforced by database RLS and server-side authorization, not only by hidden UI controls.

## Supabase schema and demo data

The baseline migrations are in `supabase/migrations/` and must be applied in timestamp order to a **new, dedicated Supabase project**:

1. `20261109090001_core_schema.sql`
2. `20261109090002_core_security.sql`

The baseline was deployed to KnitTrack-Staging and its synthetic demo seed was reported successful. The migration files are not a production migration history and are not safe to replay on a project that already has these objects. Read [the baseline migration guide](supabase/migrations/README.md) before using them elsewhere.

The seed `supabase/seed/staging_demo.sql` requires five synthetic Auth users and is a **psql script**, not SQL Editor input. It uses psql commands and aborts if the demo records already exist. Follow the Auth-user prerequisites and safe command guidance in the migration guide. Never run this seed against production or a database containing conflicting records.

## Checks and tests

```bash
npm test
npm run test:delay-risk
npm run lint
npx tsc --noEmit
npm run build
```

`npm test` runs all Node.js test files. The focused delay-risk command runs only the delay-risk unit tests. The disposable PostgreSQL 17 baseline integration suite requires Docker Desktop/Compose and PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File supabase/tests/core-baseline/run.ps1
```

The fixture uses synthetic data and does not connect to hosted Supabase. Its README explains the test scope and limitations.

## Deployment

Use separate environment configuration and separate builds/deployments for staging and production. Set the appropriate Supabase URL and publishable key for that environment before building. Do not promote a client bundle built with one environment's `NEXT_PUBLIC_*` values to another environment.

See [deployment.md](deployment.md) for environment setup, staging checks, deployment cautions, and Delay Alerts key operations. The baseline database guidance is in [supabase/migrations/README.md](supabase/migrations/README.md).

## Known limitations and status

- Production photo upload is unavailable. Supabase Storage and its policies are not configured; the current production update path stores an empty photo URL.
- Delay Alerts Phase 2 is not deployed. Keep `DELAY_ALERTS_ENABLED` unset or `false`; do not provision a Phase 2 signing key or expose alerts to buyers until that migration is separately reviewed and deployed.
- Tamil AI classification is not implemented in the current source tree.
- Offline queueing is not implemented in the current source tree.
- TNA milestone columns are defined by the baseline migration; confirm compatibility before using a different database schema.
