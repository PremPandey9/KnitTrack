# KnitTrack deployment and Delay Alerts operations

This guide covers local/staging/production application configuration and the
future Phase 2 HMAC signing workflow. Delay Alerts Phase 2 is not deployed and
must remain disabled for the current submission. The SQL in
`supabase/proposals/delay-alerts-phase-2.sql` is a review proposal, not an
applied migration. Do not provision a signing key or enable the feature.

## Application setup and deployment

1. Install the locked dependencies with `npm ci`.
2. Configure the target environment with that project's Supabase URL and
   publishable key. For local work, use `.env.example` as a placeholder guide;
   keep real environment files out of Git. For a temporary local staging
   session, process-scoped PowerShell variables override `.env.local` without
   editing it.
3. Build and validate the app with `npm test`, `npm run lint`,
   `npx tsc --noEmit`, and `npm run build`.
4. Deploy the build using the chosen hosting provider's Next.js deployment
   process. Configure environment variables in that environment's protected
   settings, and use a separate deployment/environment for staging and
   production. Run `npm run start` for a self-hosted production server.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and the publishable key to the target project
   **before the production build**. Next.js embeds `NEXT_PUBLIC_*` values into
   client bundles at build time; do not promote a bundle built for one Supabase
   project to another environment.
6. For a new Supabase project, review and apply the two baseline migrations in
   timestamp order, then create the synthetic staging Auth users and run the
   psql seed as described in `supabase/migrations/README.md`. KnitTrack-Staging
   already has the baseline and demo seed according to the project owner.
   Never apply the staging seed or staging credentials to production.
7. Verify sign-in, each of the three roles, buyer isolation, order workflows,
   and production update flows in the target environment. Keep Delay Alerts
   disabled and do not provision its signing key.

The application uses the Supabase publishable/anon key with the authenticated
cookie session and database RLS. It does not need the service-role key. Never
put service-role credentials in browser-visible variables or application
source.

### Baseline recovery

Each baseline SQL file is wrapped in a transaction, so an error should roll back
that file's incomplete changes. If migration 001 committed but migration 002
failed, inspect the database state before retrying; do not rerun migration 001
blindly. There is no automatic/destructive baseline rollback script. For a new,
otherwise-empty staging project, use the project's approved restore/recreate
procedure if a completed baseline must be removed. Back up or preserve any data
created after deployment before restoring or recreating a project. The demo
seed is one-time and aborts when its fixed records already exist.

## Environment variables

| Variable | Local development | Staging | Production |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Required; project URL | Required; staging URL | Required; production URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Required when available; legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted by the client helper | Same | Same |
| `DELAY_ALERTS_ENABLED` | Omit or set to `false` | Omit or set to `false` until migration, key match, and checks complete; then set to `true` only for an explicitly approved staged rollout | Omit or set to `false` until staging has passed and production rollout is approved |
| `DELAY_ALERT_HMAC_KEY_V1` | Omit while disabled; if exercising the feature against a dedicated local fixture, use a local-only random key and matching local DB key | Required only when the feature is enabled; provision independently from production | Required only when the feature is enabled; unique to production |

The signing implementation reads `DELAY_ALERT_HMAC_KEY_V1` in server-only
code. Never prefix it with `NEXT_PUBLIC_`, put it in a client component, expose
it through an API response, or add it to Git, a README, screenshots, build
logs, or support tickets. Store it in the hosting provider's encrypted server
environment/secret manager. Do not copy a production key to local development
or staging. Existing Supabase public URL and publishable/anon key are client
configuration; a Supabase service-role key is not needed for this feature and
must not be used by the application.

## Generate a key

Generate **32 random bytes or more** with a cryptographically secure random
number generator, represented as lowercase hexadecimal. The application
expects hex text representing the raw key bytes, at least 64 hex characters.
Use a password/secret manager's CSPRNG if it supports generating and storing
random bytes as hex. Alternatively, in a private terminal with command
recording and transcript capture disabled, Node.js can generate a 32-byte key:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex') + '\n')"
```

Capture the output directly into the target environment's secret manager and
the secure database provisioning workflow. Do not put the output in a command
argument, shell history, issue, chat, clipboard manager history, CI log, or
terminal recording. Clear the terminal after transfer. Generate separate keys
for local, staging, and production. The documented key ID is `v1`.

## Provision matching application and database keys

Provision only after the reviewed migration has been applied to that same
Supabase project. The migration creates
`private.delay_alert_signing_keys(key_id, key_material, is_active)`; it does not
insert a signing key. `key_material` is `bytea`, so the lowercase hex secret
must be decoded to bytes before storage.

1. Keep `DELAY_ALERTS_ENABLED` unset or `false`.
2. Generate a fresh environment-specific key as above. Put the exact hex text
   in the hosting provider's **server-side** `DELAY_ALERT_HMAC_KEY_V1` secret
   setting. Do not deploy or enable the flag yet.
3. Using an approved database-owner connection over TLS, insert the same bytes
   into the private table with a parameterized query. The SQL shape is:

   ```sql
   INSERT INTO private.delay_alert_signing_keys (key_id, key_material, is_active)
   VALUES ('v1', decode($1, 'hex'), true);
   ```

   Bind `$1` as a parameter containing the hex value; do not interpolate it
   into SQL text or save a query containing the secret. Use a database client
   that does not log bound parameter values. Do not grant application roles
   direct access to this table. If the `v1` row already exists, stop and follow
   the rotation procedure instead of rerunning this insert.
4. Deploy/restart the server with the secret present and the flag still off.
   Keep the secret server-only. Do not test the key by returning it from an
   action or endpoint.

The insert requires a trusted database administrator because the table is in
the private schema and RLS-protected. Never grant the web application's user,
buyer, supervisor, or general `authenticated` role access just to provision
the key.

### Verify the database and application keys match

Compare HMACs of the same fixed, non-secret challenge. This proves equality
without printing either key. Run the database query through the trusted admin
connection and compute the application value in a secure server-side terminal
where `DELAY_ALERT_HMAC_KEY_V1` is loaded from the secret manager. Compare the
two hex digests locally; do not log them. The HMAC digest is not the signing
key, but treat verification output as operationally sensitive and do not save
it in deployment logs.

Database-side check (run only as the trusted operator after key insertion):

```sql
SELECT encode(
  extensions.hmac(
    convert_to('knittrack-delay-alert-key-check-v1', 'UTF8'),
    key_material,
    'sha256'
  ),
  'hex'
) AS verification_digest
FROM private.delay_alert_signing_keys
WHERE key_id = 'v1' AND is_active;
```

Application-side check (execute in the server environment, not in browser
code; it prints only the challenge digest, never the secret):

```bash
node -e "const c=require('node:crypto'); const h=process.env.DELAY_ALERT_HMAC_KEY_V1; if(!h || !/^(?:[0-9a-fA-F]{2}){32,}$/.test(h)) process.exit(2); process.stdout.write(c.createHmac('sha256', Buffer.from(h,'hex')).update('knittrack-delay-alert-key-check-v1','utf8').digest('hex')+'\n')"
```

Proceed only if exactly one active `v1` row is returned and both digests match.
If they differ, keep the flag off and correct the secret/key row through the
rotation procedure. Never troubleshoot by printing the key.

## Staging rollout and verification

1. Confirm the target is the staging Supabase project and staging hosting
   environment. Verify current schema, RLS, grants, migration role, and a
   recoverable backup/change window.
2. Review and explicitly approve the SQL proposal. Apply it to staging once
   using the documented migration role. It is a first-install migration and
   intentionally stops if its objects already exist; do not treat it as
   idempotent or rerun it after a partial/complete application.
3. Run the migration's post-migration verification queries and the disposable
   PostgreSQL test suite. Then perform hosted staging checks for Supabase role
   ownership, RLS, auth claims, the private schema, `pgcrypto`, function
   privileges, and buyer isolation. A disposable fixture alone does not prove
   hosted Supabase behavior.
4. Provision a new staging-only key in the database and staging server secret
   store. Keep `DELAY_ALERTS_ENABLED` off. Verify matching HMAC challenge
   digests as above and confirm the RPC sees the active `v1` key.
5. Deploy/restart staging with the key available server-side and the flag off.
   Verify pages, server actions, logs, and built client assets do not contain
   the key or signature. Check that candidate submission remains disabled
   while the flag is off.
6. After explicit rollout approval, set `DELAY_ALERTS_ENABLED=true` in the
   staging **server runtime** environment and restart/redeploy. Submit a
   controlled candidate through the merchandiser flow. Verify the RPC accepts
   the signed snapshot, the alert is pending, audit events are correct, and
   buyers see only approved alerts for their currently owned orders. Verify
   buyers and supervisors cannot submit or decide alerts. Monitor server and
   database errors without logging payloads, signatures, or secrets.
7. Keep production disabled until staging acceptance is documented. Repeat
   migration review, independent key generation, provisioning, digest check,
   deployment, and role/isolation tests for production. Never reuse staging's
   key.

## Key rotation

The current signer and migration support only key ID `v1` (the table check
constraint also fixes the key ID). This supports a coordinated replacement,
not zero-downtime dual-key rotation. Keep the feature disabled during rotation:

1. Set `DELAY_ALERTS_ENABLED=false` and redeploy/restart all application
   instances. Confirm candidate submissions are disabled everywhere.
2. Generate a new environment-specific random key and store it as a new secret
   version. Retain the prior version in the secret manager's restricted
   recovery history; do not place either version in source control.
3. Through the trusted database-owner connection, update only the existing
   `v1` row's `key_material` to `decode($1, 'hex')` and keep `is_active=true`.
   Do not delete the row: request-ledger foreign keys retain key IDs. Avoid
   writing the secret to SQL query history or database logs.
4. Update `DELAY_ALERT_HMAC_KEY_V1` to the new value in the same environment,
   deploy/restart every server instance, and compare the verification digests.
   Keep the feature off if any instance or digest is uncertain.
5. After the match and staging checks succeed, explicitly re-enable the flag.

Because the row uses the same ID, old/new keys cannot be active concurrently
under this schema. Existing alerts and audit records remain stored; rotation
does not rewrite or delete them. If key-ID overlap or zero downtime is needed,
design and review a new migration and signer version before attempting it.

## Rollback

For an application or key problem, the immediate rollback is to set
`DELAY_ALERTS_ENABLED=false` (or remove it), redeploy/restart all server
instances, and verify the candidate action returns the disabled result. Keep
the database key row and alert/event/request records intact while investigating.
If a key mismatch caused the incident, restore the previous environment secret
and matching `v1` database key bytes while the feature remains off, then verify
the challenge digests before considering re-enablement.

Do not automatically run the proposal's destructive SQL rollback. It drops
alert, audit, request, signing-key, function, and role objects and can erase
auditable records. If database rollback is required, first export and preserve
alerts/events/request history under the organization's retention policy, obtain
database-owner approval, review dependencies and the exact rollback block, and
schedule a maintenance window. Revoke/disable application use first. Preserve
the signing key in the secret manager until no retained service needs it; then
retire the secret according to key-retention policy. Never paste it into a
rollback script or ticket.

## Operational blockers to clear before enablement

- The SQL proposal must be separately approved and applied; documentation does
  not apply it.
- Hosted Supabase staging verification is required. The disposable PostgreSQL
  fixture is not a substitute for actual Supabase ownership, RLS, auth, and
  extension behavior.
- A private `v1` database key row and matching server-side environment secret
  must be provisioned for each enabled environment.
- `DELAY_ALERTS_ENABLED` must remain unset/false until all checks and rollout
  approval are complete.
