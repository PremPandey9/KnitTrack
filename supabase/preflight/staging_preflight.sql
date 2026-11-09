/*
  KnitTrack-Staging read-only preflight

  Run this before applying either core baseline migration. It contains only
  SELECT statements and PostgreSQL metadata inspection. It does not change
  schemas, roles, permissions, data, extensions, or feature flags.

  Read each result's status and resolution before proceeding. A PASS describes
  only the metadata inspected here; it is not approval to apply a migration.
*/

-- 1. Server version and execution identity.
SELECT CASE
         WHEN substring(version() FROM 'PostgreSQL ([0-9]+)')::integer >= 15
           THEN 'PASS' ELSE 'BLOCKER'
       END AS status,
       'PostgreSQL version' AS check_name,
       version() AS observed,
       'The baseline was exercised on PostgreSQL 17 and expects PostgreSQL 15 or newer. Resolve an older version before migration.' AS meaning_and_resolution
UNION ALL
SELECT CASE WHEN current_user = 'postgres' THEN 'PASS' ELSE 'BLOCKER' END,
       'Current migration user',
       'current_user=' || current_user || '; session_user=' || session_user,
       'Apply migrations as the trusted postgres role. Reconnect using that project role; do not substitute service_role.';

SELECT CASE WHEN current_setting('server_encoding')='UTF8' THEN 'PASS' ELSE 'BLOCKER' END AS status,
       'Database encoding for Phase 2 HMAC payload' AS check_name,
       current_setting('server_encoding') AS observed,
       'The Phase 2 signed payload is defined as UTF-8 bytes. If the database is not UTF8, stop and use a compatible staging database.' AS meaning_and_resolution;

-- 2. Required Supabase roles and security-relevant attributes.
WITH expected_roles(role_name) AS (
  VALUES ('postgres'), ('anon'), ('authenticated'), ('service_role')
)
SELECT CASE
         WHEN r.oid IS NULL THEN 'BLOCKER'
         WHEN e.role_name = 'postgres' AND
              (r.rolsuper OR r.rolbypassrls OR NOT r.rolcreaterole) THEN 'BLOCKER'
         WHEN e.role_name IN ('anon','authenticated') AND
              (r.rolsuper OR r.rolbypassrls) THEN 'BLOCKER'
         WHEN e.role_name = 'service_role' AND NOT r.rolbypassrls THEN 'WARNING'
         ELSE 'PASS'
       END AS status,
       'Required role: ' || e.role_name AS check_name,
       CASE WHEN r.oid IS NULL THEN 'MISSING'
            ELSE format('login=%s superuser=%s createrole=%s createdb=%s bypassrls=%s',
                        r.rolcanlogin,r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolbypassrls)
       END AS observed,
       CASE
         WHEN r.oid IS NULL THEN 'Supabase role is absent. Confirm this is a Supabase project and restore the expected platform role before proceeding.'
         WHEN e.role_name = 'postgres' AND
              (r.rolsuper OR r.rolbypassrls OR NOT r.rolcreaterole)
           THEN 'The Phase 2 proposal requires postgres to be non-superuser, non-BYPASSRLS, and CREATEROLE. Resolve the role configuration with the project administrator.'
         WHEN e.role_name IN ('anon','authenticated') AND (r.rolsuper OR r.rolbypassrls)
           THEN 'An API role has elevated bypass privileges. Restore the intended least-privilege Supabase role attributes before proceeding.'
         WHEN e.role_name = 'service_role' AND NOT r.rolbypassrls
           THEN 'Review the platform service_role configuration. Do not grant BYPASSRLS to application roles as a workaround.'
         ELSE 'Role exists with attributes compatible with the expected Supabase role model.'
       END AS meaning_and_resolution
FROM expected_roles e
LEFT JOIN pg_roles r ON r.rolname = e.role_name
ORDER BY check_name;

-- 3. Role membership and role-creation requirements.
SELECT CASE
         WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN 'BLOCKER'
         WHEN NOT (SELECT rolcreaterole FROM pg_roles WHERE rolname='postgres') THEN 'BLOCKER'
         ELSE 'PASS'
       END AS status,
       'Phase 2 writer-role creation capability' AS check_name,
       coalesce((SELECT 'postgres CREATEROLE=' || rolcreaterole::text
                 FROM pg_roles WHERE rolname='postgres'),'postgres role missing') AS observed,
       'The Phase 2 proposal creates a dedicated non-login delay_alert_writer role. If this is a blocker, have the Supabase project administrator resolve migration-role capability before reviewing Phase 2.' AS meaning_and_resolution
UNION ALL
SELECT CASE
         WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres') OR
              NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN 'BLOCKER'
         WHEN pg_has_role('postgres','authenticated','MEMBER') THEN 'PASS'
         ELSE 'WARNING'
       END,
       'Seed runner SET ROLE authenticated membership',
       CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres')
                  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
                  AND pg_has_role('postgres','authenticated','MEMBER')
            THEN 'postgres is a member of authenticated'
            ELSE 'postgres is not a member of authenticated' END,
       'The synthetic seed uses SET ROLE authenticated to call the production RPC. If membership is absent, the seed cannot run as written; review the intended staging seed execution role and membership with the project administrator.';

-- 4. Required schemas, access, database CREATE, and grant/delegation capability.
WITH schema_state AS (
  SELECT n.nspname,
         pg_get_userbyid(n.nspowner) AS owner_name,
         n.nspowner = (SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned_by_current,
         has_schema_privilege(current_user,n.oid,'USAGE') AS can_use,
         has_schema_privilege(current_user,n.oid,'CREATE') AS can_create,
         EXISTS (
           SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
           WHERE a.privilege_type='USAGE' AND a.is_grantable
             AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                  OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
         ) AS can_grant_usage,
         EXISTS (
           SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
           WHERE a.privilege_type='CREATE' AND a.is_grantable
             AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                  OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
         ) AS can_grant_create
  FROM pg_namespace n
  WHERE n.nspname IN ('public','auth','extensions')
), required_schemas(schema_name) AS (
  VALUES ('public'), ('auth'), ('extensions')
)
SELECT CASE
         WHEN x.nspname IS NULL THEN 'BLOCKER'
         WHEN s.schema_name='public' AND (NOT x.can_use OR NOT x.can_create) THEN 'BLOCKER'
         WHEN s.schema_name IN ('auth','extensions') AND NOT x.can_use THEN 'BLOCKER'
         ELSE 'PASS'
       END AS status,
       'Required schema: ' || s.schema_name AS check_name,
       coalesce(format('exists=true owner=%s current_usage=%s current_create=%s grant_usage_option=%s grant_create_option=%s',
                       x.owner_name,x.can_use,x.can_create,x.can_grant_usage,x.can_grant_create),
                'schema missing') AS observed,
       CASE
         WHEN x.nspname IS NULL THEN 'Supabase-managed schema is missing. Confirm project setup with the platform administrator; do not create or alter platform schemas from this read-only preflight.'
         WHEN s.schema_name='public' AND (NOT x.can_use OR NOT x.can_create) THEN 'The baseline cannot reliably create or resolve its public objects. Have the project administrator resolve the migration role’s public schema USAGE and CREATE capabilities.'
         WHEN s.schema_name IN ('auth','extensions') AND NOT x.can_use THEN 'The migration role cannot resolve the required Supabase Auth or extension objects. Resolve schema USAGE with the project administrator.'
         ELSE 'Required schema is visible; see the separate Phase 2 delegation check for grant-option requirements.'
       END AS meaning_and_resolution
FROM required_schemas s
LEFT JOIN schema_state x ON x.nspname=s.schema_name
ORDER BY check_name;

SELECT CASE WHEN has_database_privilege(current_user,current_database(),'CREATE')
            THEN 'PASS' ELSE 'BLOCKER' END AS status,
       'Database CREATE capability for Phase 2 private schema' AS check_name,
       has_database_privilege(current_user,current_database(),'CREATE')::text AS observed,
       'Phase 2 creates a private schema. If unavailable, the Phase 2 migration cannot create it under this role; ask the project administrator to review the approved migration path.' AS meaning_and_resolution;

-- The Phase 2 migration must be able to delegate temporary schema privileges to
-- its restricted writer role. CREATE alone does not imply GRANT OPTION.
WITH schema_state AS (
  SELECT n.nspname,
         n.nspowner = (SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned_by_current,
         pg_has_role(current_user,pg_get_userbyid(n.nspowner),'USAGE') AS member_of_owner,
         EXISTS (
           SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
           WHERE a.privilege_type='CREATE' AND a.is_grantable
             AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                  OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
         ) AS create_grantable,
         EXISTS (
           SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
           WHERE a.privilege_type='USAGE' AND a.is_grantable
             AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                  OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
         ) AS usage_grantable
  FROM pg_namespace n WHERE n.nspname IN ('public','auth','extensions')
)
SELECT CASE WHEN bool_and(
              owned_by_current OR member_of_owner OR
              (usage_grantable AND (nspname<>'public' OR create_grantable))
            ) THEN 'PASS' ELSE 'BLOCKER' END AS status,
       'Phase 2 schema privilege delegation' AS check_name,
       string_agg(format('%s owner=%s owner_member=%s usage_grantable=%s create_grantable=%s',
                         nspname,owned_by_current,member_of_owner,usage_grantable,create_grantable),'; ' ORDER BY nspname) AS observed,
       'The Phase 2 proposal temporarily grants public CREATE and schema USAGE to delay_alert_writer. Missing ownership, owner membership, or the relevant grant option can make the migration fail. Have the project administrator review privileges; do not broaden access to API roles.' AS meaning_and_resolution
FROM schema_state;

-- 5. pgcrypto and the exact HMAC function/schema expected by both proposals.
WITH pgcrypto_state AS (
  SELECT e.oid,
         n.nspname AS extension_schema,
         to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NOT NULL AS expected_hmac_exists
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid=e.extnamespace
  WHERE e.extname='pgcrypto'
)
SELECT CASE
         WHEN NOT EXISTS (SELECT 1 FROM pgcrypto_state) THEN 'WARNING'
         WHEN extension_schema='extensions' AND expected_hmac_exists THEN 'PASS'
         ELSE 'BLOCKER'
       END AS status,
       'pgcrypto in extensions with hmac(bytea,bytea,text)' AS check_name,
       format('extension_schema=%s hmac_exists=%s',
              coalesce((SELECT extension_schema FROM pgcrypto_state),'missing'),
              to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NOT NULL) AS observed,
       CASE WHEN NOT EXISTS (SELECT 1 FROM pgcrypto_state)
            THEN 'pgcrypto is absent now. Baseline migration 001 attempts to install it in extensions; confirm the extension is available and the migration role can install it, then rerun this preflight before Phase 2.'
            ELSE 'Baseline migration 001 and the Phase 2 verifier expect pgcrypto in extensions and this exact HMAC signature. If installed elsewhere or the function is absent, stop and review extension placement with the staging administrator.'
       END AS meaning_and_resolution
FROM (SELECT 1 AS singleton) one_row
LEFT JOIN pgcrypto_state ON true;

SELECT CASE
         WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto') THEN 'PASS'
         WHEN has_database_privilege(current_user,current_database(),'CREATE')
              AND EXISTS (SELECT 1 FROM pg_namespace n
                          WHERE n.nspname='extensions'
                            AND has_schema_privilege(current_user,n.oid,'CREATE')) THEN 'WARNING'
         ELSE 'BLOCKER'
       END AS status,
       'Baseline migration ability to install pgcrypto if absent' AS check_name,
       format('pgcrypto_present=%s database_create=%s extensions_schema_create=%s',
              EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto'),
              has_database_privilege(current_user,current_database(),'CREATE'),
              coalesce((SELECT has_schema_privilege(current_user,n.oid,'CREATE')
                        FROM pg_namespace n WHERE n.nspname='extensions'),false)) AS observed,
       'If pgcrypto is absent, migration 001 attempts installation in extensions. The metadata checks are necessary but may not prove the extension is installable on this Supabase build; confirm any WARNING with the project administrator and rerun the preflight after installation.' AS meaning_and_resolution;

SELECT CASE WHEN to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL
            THEN 'PASS' ELSE 'BLOCKER' END AS status,
       'UUID generation function' AS check_name,
       coalesce(to_regprocedure('pg_catalog.gen_random_uuid()')::text,'missing') AS observed,
       'Core table primary keys default to gen_random_uuid(). Confirm the server version/platform capability before migration if this function is unavailable.' AS meaning_and_resolution;

-- Check both effective execution and the grant option needed by the Phase 2
-- migration role to delegate EXECUTE to delay_alert_writer.
WITH target_functions AS (
  SELECT 'auth.uid()'::text AS function_name,
         to_regprocedure('auth.uid()') AS function_oid,
         true AS authenticated_required
  UNION ALL
  SELECT 'extensions.hmac(bytea,bytea,text)',
         to_regprocedure('extensions.hmac(bytea,bytea,text)'),
         false
), function_privileges AS (
  SELECT f.function_name, f.function_oid, f.authenticated_required,
         p.proowner,
         has_function_privilege(current_user,f.function_oid,'EXECUTE') AS current_can_execute,
         CASE WHEN f.authenticated_required THEN
              CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
                   THEN has_function_privilege('authenticated',f.function_oid,'EXECUTE')
                   ELSE false END
              ELSE true END AS authenticated_can_execute,
         (p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
          OR pg_has_role(current_user,pg_get_userbyid(p.proowner),'USAGE')
          OR EXISTS (
            SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
            WHERE a.privilege_type='EXECUTE' AND a.is_grantable
              AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                   OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
          )) AS can_grant_execute
  FROM target_functions f
  LEFT JOIN pg_proc p ON p.oid=f.function_oid
)
SELECT CASE
         WHEN function_oid IS NULL AND function_name='extensions.hmac(bytea,bytea,text)'
              AND NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto') THEN 'WARNING'
         WHEN function_oid IS NULL THEN 'BLOCKER'
         WHEN NOT current_can_execute THEN 'BLOCKER'
         WHEN authenticated_required AND NOT authenticated_can_execute THEN 'BLOCKER'
         WHEN NOT can_grant_execute THEN 'BLOCKER'
         ELSE 'PASS'
       END AS status,
       'Function privilege: ' || function_name AS check_name,
       format('exists=%s current_execute=%s authenticated_execute=%s migration_can_grant_execute=%s',
              function_oid IS NOT NULL,current_can_execute,authenticated_can_execute,can_grant_execute) AS observed,
       CASE
         WHEN function_oid IS NULL AND function_name='extensions.hmac(bytea,bytea,text)'
              AND NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto')
           THEN 'Expected before baseline 001 if pgcrypto has not yet been installed. The baseline attempts installation; verify it exists in extensions afterward, before Phase 2.'
         WHEN function_oid IS NULL THEN 'Required Supabase/pgcrypto function is missing. Resolve platform setup before migration.'
         WHEN NOT current_can_execute THEN 'The migration role cannot execute this function. Resolve its privilege through the project administrator.'
         WHEN authenticated_required AND NOT authenticated_can_execute THEN 'Authenticated requests require auth.uid(). Resolve the expected function EXECUTE grant before applying the baseline.'
         WHEN NOT can_grant_execute THEN 'Phase 2 needs the migration role to grant this function to delay_alert_writer. Ownership or EXECUTE WITH GRANT OPTION is required; do not grant access to API roles as a workaround.'
         ELSE 'Effective and delegated execution privileges match the inspected migration requirements.'
       END AS meaning_and_resolution
FROM function_privileges
ORDER BY check_name;

-- Baseline 001 references auth.users for profile/supervisor foreign keys; the
-- seed also reads synthetic Auth users by email.
SELECT CASE
         WHEN to_regclass('auth.users') IS NULL THEN 'BLOCKER'
         WHEN NOT has_table_privilege(current_user,'auth.users','REFERENCES') THEN 'BLOCKER'
         WHEN NOT has_table_privilege(current_user,'auth.users','SELECT') THEN 'WARNING'
         ELSE 'PASS'
       END AS status,
       'Supabase Auth users table access' AS check_name,
       format('auth.users_exists=%s migration_REFERENCES=%s migration_SELECT=%s',
              to_regclass('auth.users') IS NOT NULL,
              CASE WHEN to_regclass('auth.users') IS NULL THEN false ELSE has_table_privilege(current_user,'auth.users','REFERENCES') END,
              CASE WHEN to_regclass('auth.users') IS NULL THEN false ELSE has_table_privilege(current_user,'auth.users','SELECT') END) AS observed,
       'The baseline needs REFERENCES on auth.users; the synthetic seed additionally reads Auth users. Resolve missing privileges through the staging administrator without changing API-role access.' AS meaning_and_resolution;

-- 6. The core baseline creates these five tables and six public functions.
WITH expected_tables(table_name) AS (
  VALUES ('buyers'),('profiles'),('orders'),('production_updates'),('tna_milestones')
), table_state AS (
  SELECT count(*) FILTER (WHERE to_regclass('public.'||table_name) IS NOT NULL) AS present_count,
         string_agg(table_name,', ' ORDER BY table_name)
           FILTER (WHERE to_regclass('public.'||table_name) IS NOT NULL) AS present_names
  FROM expected_tables
)
SELECT CASE WHEN present_count=0 THEN 'PASS'
            WHEN present_count=5 THEN 'WARNING'
            ELSE 'BLOCKER' END AS status,
       'Baseline table name collisions' AS check_name,
       format('%s of 5 exist: %s',present_count,coalesce(present_names,'none')) AS observed,
       CASE WHEN present_count=0 THEN 'The target has no baseline table names; this is the expected pre-migration state.'
            WHEN present_count=5 THEN 'The baseline appears already installed. Do not apply its non-idempotent CREATE TABLE statements again; verify schema and migration history.'
            ELSE 'Partial baseline objects can cause migration failure or an inconsistent schema. Stop and inspect each existing object before deciding on a recovery plan.'
       END AS meaning_and_resolution
FROM table_state;

WITH expected_functions(signature) AS (
  VALUES ('public.current_user_role()'),
         ('public.current_user_buyer_id()'),
         ('public.submit_production_update(uuid,text,numeric,text,date)'),
         ('public.configure_order_final_stage(uuid,text)'),
         ('public._knittrack_validate_production_update()'),
         ('public._knittrack_apply_production_progress()')
), function_state AS (
  SELECT count(*) FILTER (WHERE to_regprocedure(signature) IS NOT NULL) AS present_count,
         string_agg(signature,', ' ORDER BY signature)
           FILTER (WHERE to_regprocedure(signature) IS NOT NULL) AS present_names
  FROM expected_functions
)
SELECT CASE WHEN present_count=0 THEN 'PASS'
            WHEN present_count=6 THEN 'WARNING'
            ELSE 'BLOCKER' END AS status,
       'Baseline function name collisions' AS check_name,
       format('%s of 6 exist: %s',present_count,coalesce(present_names,'none')) AS observed,
       CASE WHEN present_count=0 THEN 'The target has none of the baseline function signatures; this is the expected pre-migration state.'
            WHEN present_count=6 THEN 'Baseline functions appear installed. Do not treat this as a fresh install; verify ownership, definitions, grants, and migration history.'
            ELSE 'Partial helper/RPC state is a collision risk. Stop and inspect before applying either baseline migration.'
       END AS meaning_and_resolution
FROM function_state;

-- 7. Existing Phase 2 objects conflict with the proposal's first-install
-- assumptions. This query checks names only; it does not inspect or alter data.
WITH phase2_objects(object_name,exists_now) AS (
  SELECT 'private schema',to_regnamespace('private') IS NOT NULL
  UNION ALL SELECT 'delay_alert_writer role',EXISTS(SELECT 1 FROM pg_roles WHERE rolname='delay_alert_writer')
  UNION ALL SELECT 'public.delay_alerts table',to_regclass('public.delay_alerts') IS NOT NULL
  UNION ALL SELECT 'public.delay_alert_events table',to_regclass('public.delay_alert_events') IS NOT NULL
  UNION ALL SELECT 'private.delay_alert_signing_keys table',to_regclass('private.delay_alert_signing_keys') IS NOT NULL
  UNION ALL SELECT 'private.delay_alert_requests table',to_regclass('private.delay_alert_requests') IS NOT NULL
  UNION ALL SELECT 'private.delay_alert_order_context(uuid,uuid)',to_regprocedure('private.delay_alert_order_context(uuid,uuid)') IS NOT NULL
  UNION ALL SELECT 'private.delay_alert_actor_role(uuid)',to_regprocedure('private.delay_alert_actor_role(uuid)') IS NOT NULL
  UNION ALL SELECT 'private.set_delay_alert_audit_fields()',to_regprocedure('private.set_delay_alert_audit_fields()') IS NOT NULL
  UNION ALL SELECT 'public.record_delay_candidate(text,text,text)',to_regprocedure('public.record_delay_candidate(text,text,text)') IS NOT NULL
)
SELECT CASE WHEN bool_or(exists_now) THEN 'BLOCKER' ELSE 'PASS' END AS status,
       'Phase 2 first-install object collisions' AS check_name,
       coalesce(string_agg(object_name,', ' ORDER BY object_name) FILTER (WHERE exists_now),'none found') AS observed,
       CASE WHEN bool_or(exists_now)
            THEN 'The Phase 2 proposal expects these objects to be absent and is not a rerunnable migration. Stop and review existing objects; do not drop or overwrite them to force the proposal through.'
            ELSE 'No named Phase 2 conflict was found; the proposal still requires the post-baseline ownership, RLS, helper, and privilege checks described below.'
       END AS meaning_and_resolution
FROM phase2_objects;

-- 8. Phase 2 depends on current_user_buyer_id() created by baseline 002.
SELECT CASE
         WHEN p.oid IS NULL THEN 'WARNING'
         WHEN p.prorettype='uuid'::regtype AND p.prosecdef
              AND pg_get_userbyid(p.proowner)='postgres'
              AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) s
                          WHERE s ~ '^search_path=pg_catalog(,|$)'
                            AND position('$user' IN s)=0 AND position('pg_temp' IN s)=0)
               AND CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
                        THEN has_function_privilege('authenticated',p.oid,'EXECUTE')
                        ELSE false END
           THEN 'PASS'
         ELSE 'BLOCKER'
       END AS status,
       'Phase 2 buyer helper compatibility' AS check_name,
       CASE WHEN p.oid IS NULL THEN 'public.current_user_buyer_id() not present yet'
            ELSE format('owner=%s returns_uuid=%s security_definer=%s settings=%s authenticated_execute=%s',
                        pg_get_userbyid(p.proowner),p.prorettype='uuid'::regtype,p.prosecdef,p.proconfig,
                         CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
                              THEN has_function_privilege('authenticated',p.oid,'EXECUTE')
                              ELSE false END)
       END AS observed,
       CASE WHEN p.oid IS NULL
            THEN 'Expected before baseline 002. Re-run this preflight after applying and reviewing the baseline, before Phase 2.'
             WHEN NOT (p.prorettype='uuid'::regtype AND p.prosecdef
                       AND pg_get_userbyid(p.proowner)='postgres'
                       AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) s
                                   WHERE s ~ '^search_path=pg_catalog(,|$)'
                                     AND position('$user' IN s)=0 AND position('pg_temp' IN s)=0)
                       AND CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
                                THEN has_function_privilege('authenticated',p.oid,'EXECUTE')
                                ELSE false END)
            THEN 'Phase 2 requires the existing helper to return UUID, be postgres-owned SECURITY DEFINER, and be executable by authenticated. Review and separately correct this helper before Phase 2.'
            ELSE 'Helper signature, owner, SECURITY DEFINER flag, authenticated execution, and pinned search_path are compatible with the Phase 2 preflight.'
       END AS meaning_and_resolution
FROM (SELECT p.* FROM pg_proc p WHERE p.oid=to_regprocedure('public.current_user_buyer_id()')) p
RIGHT JOIN (SELECT 1 AS singleton) s ON true;

-- Summary reminder: these checks cannot certify post-migration RLS policies or
-- table owners while the baseline tables are absent. Verify those after baseline
-- installation and rerun the Phase 2 proposal's own full preflight before use.
SELECT CASE
         WHEN to_regclass('public.orders') IS NULL AND to_regclass('public.profiles') IS NULL THEN 'WARNING'
         WHEN to_regclass('public.orders') IS NOT NULL AND to_regclass('public.profiles') IS NOT NULL THEN 'PASS'
         ELSE 'BLOCKER'
       END AS status,
       'Post-baseline RLS and ownership verification' AS check_name,
       format('orders_exists=%s profiles_exists=%s',to_regclass('public.orders') IS NOT NULL,
              to_regclass('public.profiles') IS NOT NULL) AS observed,
       'On an empty target this is expected. After baseline application, verify orders/profiles are owned by postgres, RLS is enabled and FORCE RLS is off, and authenticated SELECT grants/helpers match the reviewed migrations. Run the Phase 2 proposal preflight before any later approval.' AS meaning_and_resolution;
