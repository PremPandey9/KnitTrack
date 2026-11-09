-- KnitTrack Delay Alerts Phase 2 — REVIEW PROPOSAL ONLY
-- This file has not been executed. It is intentionally a migration proposal.
-- Requires the matching server implementation in src/lib/delay-alert-signing-core.ts.
-- The application sends phase1-v1, and uses "~" as described in the mapping below.

/* -------------------------------------------------------------------------- */
/* 0. READ-ONLY PREFLIGHT                                                     */
/* Run these statements separately before considering the migration.         */
/* -------------------------------------------------------------------------- */

-- Expected: current_user=postgres, rolsuper=false, rolcreaterole=true,
-- rolcreatedb=true, public CREATE=true, private schema absent, writer absent.
SELECT current_user AS migration_role,
       r.rolsuper,
       r.rolcreaterole,
       r.rolcreatedb,
       r.rolbypassrls,
       current_setting('server_encoding') AS server_encoding,
       has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public_objects
FROM pg_roles r
WHERE r.rolname = current_user;

-- Verify existing owners, RLS and FORCE RLS. The narrowly-scoped order-context
-- SECURITY DEFINER helper below requires orders/profiles to be owned by postgres
-- and not FORCE RLS; it does not change either table's policies or RLS flags.
SELECT c.oid::regclass AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('orders', 'profiles', 'buyers', 'production_updates')
ORDER BY c.relname;

-- Expected columns/types used by the migration and trusted context helper.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'orders' AND column_name IN
       ('id','buyer_id','total_quantity','completed_quantity','final_production_stage','ex_factory_date'))
    OR (table_name = 'profiles' AND column_name IN ('id','role','buyer_id')))
ORDER BY table_name, ordinal_position;

-- Existing RLS policies are read for review only. The migration does not drop,
-- replace, or alter policies on any existing table.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('orders','profiles','buyers','production_updates')
ORDER BY tablename, policyname;

-- Required pgcrypto functions are already installed in extensions per preflight.
SELECT to_regprocedure('extensions.hmac(bytea,bytea,text)') AS hmac_function,
       to_regprocedure('extensions.digest(bytea,text)') AS digest_function,
       to_regprocedure('public.current_user_buyer_id()') AS buyer_helper,
       (SELECT p.prorettype = 'uuid'::regtype AND p.prosecdef
          FROM pg_proc p WHERE p.oid='public.current_user_buyer_id()'::regprocedure)
         AS buyer_helper_returns_uuid_security_definer,
       (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p
         WHERE p.oid='public.current_user_buyer_id()'::regprocedure) AS buyer_helper_owner,
       (SELECT p.proconfig FROM pg_proc p
         WHERE p.oid='public.current_user_buyer_id()'::regprocedure) AS buyer_helper_settings,
       (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
         WHERE p.oid='public.current_user_buyer_id()'::regprocedure) AS buyer_helper_definition,
       has_function_privilege('authenticated', 'public.current_user_buyer_id()', 'EXECUTE')
         AS authenticated_can_call_buyer_helper,
       has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE') AS authenticated_can_call_auth_uid,
       has_schema_privilege('public', 'CREATE') AS public_schema_create_available;

-- Review current_user_buyer_id() owner, SECURITY DEFINER status, source and
-- pinned search_path before migration. Do not alter this existing helper here.
-- Stop if it is not owned by a trusted role or its path is not pinned to trusted
-- schemas. A SECURITY DEFINER flag alone does not make it safe.
SELECT p.oid::regprocedure AS function_name,
       pg_get_userbyid(p.proowner) AS owner,
       r.rolcanlogin AS owner_can_login,
       r.rolbypassrls AS owner_bypasses_rls,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       EXISTS (
         SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS setting
         WHERE setting ~ '^search_path=pg_catalog(,|$)'
           AND position('$user' IN setting)=0
           AND position('pg_temp' IN setting)=0
       ) AS has_pinned_safe_search_path,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_roles r ON r.oid=p.proowner
WHERE p.oid='public.current_user_buyer_id()'::regprocedure;

-- GRANT statements below require ownership or grant-option authority. CREATE
-- privilege alone does not prove that this non-superuser migration role may
-- delegate schema/function privileges to delay_alert_writer.
SELECT n.nspname,
       pg_get_userbyid(n.nspowner) AS schema_owner,
       has_schema_privilege(current_user, n.oid, 'USAGE') AS current_usage,
       has_schema_privilege(current_user, n.oid, 'CREATE') AS current_create,
       EXISTS (
         SELECT 1 FROM aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
         WHERE a.privilege_type='USAGE' AND a.is_grantable
           AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
             OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
       ) AS current_usage_grant_option,
       EXISTS (
         SELECT 1 FROM aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
         WHERE a.privilege_type='CREATE' AND a.is_grantable
           AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
             OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
       ) AS current_create_grant_option
FROM pg_namespace n
WHERE n.nspname IN ('public','auth','extensions');

SELECT p.oid::regprocedure AS function_name,
       pg_get_userbyid(p.proowner) AS function_owner,
       p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS current_user_owns_function,
       EXISTS (
         SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         WHERE a.privilege_type='EXECUTE' AND a.is_grantable
           AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
             OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
       ) AS current_user_has_execute_grant_option
FROM pg_proc p
WHERE p.oid IN ('auth.uid()'::regprocedure,
                'extensions.hmac(bytea,bytea,text)'::regprocedure);

-- This is a required no-FORCE-RLS check for the private context helper. If either
-- result is true, stop: do not bypass or weaken the existing policies to proceed.
SELECT bool_or(c.relforcerowsecurity) FILTER (WHERE c.relname IN ('orders','profiles'))
       AS orders_or_profiles_force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('orders','profiles');

/* -------------------------------------------------------------------------- */
/* 1. MIGRATION                                                              */
/* Run only after reviewing all preflight output and approving this proposal. */
/* -------------------------------------------------------------------------- */

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE
  v_current_role text := current_user;
  v_has_force_rls boolean;
BEGIN
  IF v_current_role <> 'postgres' THEN
    RAISE EXCEPTION 'Run this migration as the verified postgres migration role.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    RAISE EXCEPTION 'Expected Supabase anon, authenticated, and service_role roles are required.';
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Expected the Supabase postgres role to be non-superuser; review this environment.';
  END IF;
  IF NOT (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'The migration role needs CREATEROLE to create the restricted writer role.';
  END IF;
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Expected migration role without BYPASSRLS; review this environment.';
  END IF;
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'The payload contract requires UTF8 database encoding.';
  END IF;
  IF to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'Required pgcrypto extensions.hmac(bytea,bytea,text) is unavailable.';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR
     to_regprocedure('public.current_user_buyer_id()') IS NULL THEN
    RAISE EXCEPTION 'Required auth.uid() or current_user_buyer_id() helper is unavailable.';
  END IF;
  IF NOT (SELECT p.prorettype = 'uuid'::regtype AND p.prosecdef
          FROM pg_proc p WHERE p.oid='public.current_user_buyer_id()'::regprocedure) THEN
    RAISE EXCEPTION 'current_user_buyer_id() must retain its verified UUID SECURITY DEFINER behavior.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_roles owner_role ON owner_role.oid=p.proowner
    WHERE p.oid='public.current_user_buyer_id()'::regprocedure
      AND pg_get_userbyid(p.proowner)='postgres'
      AND NOT owner_role.rolbypassrls
      AND EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS setting
        WHERE setting ~ '^search_path=pg_catalog(,|$)'
          AND position('$user' IN setting)=0
          AND position('pg_temp' IN setting)=0
      )
  ) THEN
    RAISE EXCEPTION 'current_user_buyer_id() needs a trusted postgres owner and pinned search_path; inspect and separately secure the existing helper.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.current_user_buyer_id()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated must already have EXECUTE on current_user_buyer_id(); do not silently change the existing helper grants.';
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'The migration role cannot create the public RPC.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace n
    WHERE n.nspname='public'
      AND (n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
        OR pg_has_role(current_user, pg_get_userbyid(n.nspowner), 'USAGE')
        OR EXISTS (
          SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
          WHERE a.privilege_type='CREATE' AND a.is_grantable
            AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
              OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
        ))
  ) THEN
    RAISE EXCEPTION 'The migration role lacks authority to temporarily grant CREATE on public to the writer.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace n
    WHERE n.nspname IN ('public','auth','extensions')
      AND n.nspowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND NOT pg_has_role(current_user, pg_get_userbyid(n.nspowner), 'USAGE')
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
        WHERE a.privilege_type='USAGE' AND a.is_grantable
          AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
            OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
      )
  ) THEN
    RAISE EXCEPTION 'The migration role lacks authority to grant required schema USAGE to delay_alert_writer.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='auth.uid()'::regprocedure
      AND (p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
        OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
        OR EXISTS (
          SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.privilege_type='EXECUTE' AND a.is_grantable
            AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
              OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
        ))
  ) THEN
    RAISE EXCEPTION 'The migration role cannot grant the required auth.uid() EXECUTE privilege to delay_alert_writer.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='extensions.hmac(bytea,bytea,text)'::regprocedure
      AND (p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
        OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
        OR EXISTS (
          SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.privilege_type='EXECUTE' AND a.is_grantable
            AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
              OR (a.grantee<>0 AND pg_has_role(current_user,a.grantee,'USAGE')))
        ))
  ) THEN
    RAISE EXCEPTION 'The migration role cannot grant extensions.hmac() EXECUTE to delay_alert_writer.';
  END IF;
  IF to_regclass('public.delay_alerts') IS NOT NULL OR
     to_regclass('public.delay_alert_events') IS NOT NULL OR
     to_regclass('private.delay_alert_signing_keys') IS NOT NULL OR
     to_regclass('private.delay_alert_requests') IS NOT NULL OR
     to_regprocedure('public.record_delay_candidate(text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Delay-alert objects already exist; review rather than applying this first-install migration.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'delay_alert_writer') THEN
    RAISE EXCEPTION 'delay_alert_writer already exists; review its attributes and grants before proceeding.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'private') THEN
    RAISE EXCEPTION 'private schema already exists; this proposal assumes it is absent and will not reuse it silently.';
  END IF;

  SELECT bool_or(c.relforcerowsecurity)
    INTO v_has_force_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('orders','profiles');
  IF coalesce(v_has_force_rls, false) THEN
    RAISE EXCEPTION 'orders or profiles uses FORCE ROW LEVEL SECURITY; review the helper security design before migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='buyer_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='total_quantity' AND data_type='integer'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='completed_quantity' AND data_type='integer'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='final_production_stage' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='ex_factory_date' AND data_type='date'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='role'
      AND data_type='text'
  ) THEN
    RAISE EXCEPTION 'Verified orders/profiles columns do not match this proposal.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='orders' AND c.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='profiles' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Existing orders and profiles RLS must remain enabled.';
  END IF;
  IF NOT has_table_privilege('authenticated','public.profiles','SELECT') THEN
    RAISE EXCEPTION 'Authenticated SELECT on profiles is required by merchandiser/buyer role policies.';
  END IF;
  IF NOT has_table_privilege(current_user, 'public.orders', 'REFERENCES') THEN
    RAISE EXCEPTION 'The migration role lacks REFERENCES privilege needed for the orders foreign key.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('orders','profiles')
      AND pg_get_userbyid(c.relowner) <> 'postgres'
  ) THEN
    RAISE EXCEPTION 'This helper design assumes postgres owns orders and profiles.';
  END IF;
END;
$preflight$;

-- Dedicated non-login, non-bypass function owner. It is never granted to API roles.
CREATE ROLE delay_alert_writer
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE SCHEMA private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA private FROM service_role;

-- Temporary grants solely to create SECURITY DEFINER functions owned by the
-- restricted role. They are revoked before the migration commits.
GRANT delay_alert_writer TO postgres;
GRANT CREATE ON SCHEMA public, private TO delay_alert_writer;
GRANT USAGE ON SCHEMA public, private, auth, extensions TO delay_alert_writer;

CREATE TABLE public.delay_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT intentionally prevents deleting an order after any alert exists.
  -- The private single-use request ledger also restricts deletion permanently
  -- until an administrator performs an explicit retention/purge procedure.
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL,
  risk_level text NOT NULL,
  calculated_at timestamptz NOT NULL,
  calculation_version text NOT NULL,
  total_quantity integer,
  completed_quantity integer,
  remaining_quantity integer,
  final_production_stage text,
  ex_factory_date date,
  observation_window_start date,
  observation_window_end date,
  history_date_count integer NOT NULL,
  observed_daily_output numeric,
  required_daily_output numeric,
  pace_ratio numeric,
  days_remaining integer,
  approval_status text NOT NULL DEFAULT 'pending',
  approved_by uuid,
  approved_at timestamptz,
  dismissed_by uuid,
  dismissed_at timestamptz,
  dismissal_reason text,
  superseded_by uuid,
  superseded_at timestamptz,
  superseded_by_calculation_status text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT delay_alerts_candidate_risk_ck
    CHECK (risk_level IN ('Overdue','High Risk','At Risk','Watch')),
  CONSTRAINT delay_alerts_status_ck
    CHECK (approval_status IN ('pending','approved','dismissed','superseded')),
  CONSTRAINT delay_alerts_version_ck
    CHECK (calculation_version = 'phase1-v1'),
  CONSTRAINT delay_alerts_quantity_ck CHECK (
    total_quantity IS NOT NULL AND total_quantity > 0 AND
    completed_quantity IS NOT NULL AND completed_quantity >= 0 AND
    completed_quantity <= total_quantity AND
    remaining_quantity IS NOT NULL AND remaining_quantity > 0 AND
    remaining_quantity::numeric = total_quantity::numeric - completed_quantity::numeric
  ),
  CONSTRAINT delay_alerts_candidate_fields_ck CHECK (
    final_production_stage IS NOT NULL AND btrim(final_production_stage) <> '' AND
    ex_factory_date IS NOT NULL AND
    observation_window_start IS NOT NULL AND observation_window_end IS NOT NULL AND
    observation_window_start = observation_window_end - 13 AND
    history_date_count BETWEEN 0 AND 14 AND
    days_remaining IS NOT NULL AND days_remaining >= 0
  ),
  CONSTRAINT delay_alerts_status_metrics_ck CHECK (
    (risk_level = 'Overdue' AND
      days_remaining = 0 AND history_date_count = 0 AND
      observed_daily_output IS NULL AND required_daily_output IS NULL AND pace_ratio IS NULL)
    OR
    (risk_level IN ('High Risk','At Risk','Watch') AND
      days_remaining >= 1 AND history_date_count BETWEEN 5 AND 14 AND
      observed_daily_output IS NOT NULL AND observed_daily_output > 0 AND
      required_daily_output IS NOT NULL AND required_daily_output > 0 AND
      pace_ratio IS NOT NULL AND pace_ratio > 0)
  ),
  CONSTRAINT delay_alerts_pace_consistency_ck CHECK (
    CASE WHEN risk_level = 'Overdue' THEN true ELSE
      abs(required_daily_output - (remaining_quantity::numeric / days_remaining))
        <= greatest(0.0000000001::numeric,
                    abs(remaining_quantity::numeric / days_remaining) * 0.0000000001::numeric)
    END
  ),
  CONSTRAINT delay_alerts_ratio_consistency_ck CHECK (
    CASE WHEN risk_level = 'Overdue' THEN true ELSE
      abs(pace_ratio - (observed_daily_output / required_daily_output))
        <= greatest(0.000000001::numeric,
                    abs(observed_daily_output / required_daily_output) * 0.000000001::numeric)
    END
  ),
  CONSTRAINT delay_alerts_risk_threshold_ck CHECK (
    -- Phase 1 now rounds the canonical Number#toString() decimal with the same
    -- positive half-away-from-zero rule as PostgreSQL round(numeric, 10).
    (risk_level = 'Overdue') OR
    (risk_level = 'High Risk' AND round(pace_ratio, 10) < 0.80) OR
    (risk_level = 'At Risk' AND round(pace_ratio, 10) >= 0.80 AND round(pace_ratio, 10) < 1.00) OR
    (risk_level = 'Watch' AND round(pace_ratio, 10) >= 1.00 AND round(pace_ratio, 10) < 1.10)
  ),
  CONSTRAINT delay_alerts_factory_dates_ck CHECK (
    observation_window_end = (calculated_at AT TIME ZONE 'Asia/Kolkata')::date AND
    (risk_level <> 'Overdue' OR ex_factory_date < observation_window_end) AND
    (risk_level = 'Overdue' OR
      days_remaining = greatest(0, ex_factory_date - observation_window_end + 1))
  ),
  CONSTRAINT delay_alerts_audit_pair_ck CHECK (
    (approved_by IS NULL) = (approved_at IS NULL) AND
    (dismissed_by IS NULL) = (dismissed_at IS NULL) AND
    (superseded_by IS NULL) = (superseded_at IS NULL)
  ),
  CONSTRAINT delay_alerts_status_audit_ck CHECK (
    (approval_status = 'pending' AND approved_at IS NULL AND dismissed_at IS NULL AND superseded_at IS NULL) OR
    (approval_status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND dismissed_at IS NULL AND superseded_at IS NULL) OR
    (approval_status = 'dismissed' AND dismissed_by IS NOT NULL AND dismissed_at IS NOT NULL AND superseded_at IS NULL) OR
    (approval_status = 'superseded' AND superseded_by IS NOT NULL AND superseded_at IS NOT NULL)
  ),
  CONSTRAINT delay_alerts_reason_ck CHECK (
    dismissal_reason IS NULL OR char_length(dismissal_reason) <= 2000
  ),
  CONSTRAINT delay_alerts_superseded_reason_ck CHECK (
    superseded_by_calculation_status IS NULL OR
    superseded_by_calculation_status IN
      ('Complete','Overdue','High Risk','At Risk','Watch','On Track','Review Needed')
  )
);

CREATE UNIQUE INDEX delay_alerts_one_pending_or_approved_per_order_uq
  ON public.delay_alerts(order_id)
  WHERE approval_status IN ('pending','approved');
CREATE INDEX delay_alerts_buyer_approved_idx
  ON public.delay_alerts(buyer_id, calculated_at DESC)
  WHERE approval_status = 'approved';
CREATE INDEX delay_alerts_order_history_idx
  ON public.delay_alerts(order_id, created_at DESC);

CREATE TABLE public.delay_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.delay_alerts(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  event_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_type text NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  calculation_status text,
  dismissal_reason text,
  CONSTRAINT delay_alert_events_type_ck
    CHECK (event_type IN ('created','approved','dismissed','superseded','calculation_changed')),
  CONSTRAINT delay_alert_events_previous_ck
    CHECK (previous_status IS NULL OR previous_status IN ('pending','approved','dismissed','superseded')),
  CONSTRAINT delay_alert_events_new_ck
    CHECK (new_status IN ('pending','approved','dismissed','superseded')),
  CONSTRAINT delay_alert_events_calculation_status_ck
    CHECK (calculation_status IS NULL OR calculation_status IN
      ('Complete','Overdue','High Risk','At Risk','Watch','On Track','Review Needed')),
  CONSTRAINT delay_alert_events_reason_ck
    CHECK (dismissal_reason IS NULL OR char_length(dismissal_reason) <= 2000)
);
CREATE INDEX delay_alert_events_alert_time_idx
  ON public.delay_alert_events(alert_id, event_at, id);

CREATE TABLE private.delay_alert_signing_keys (
  key_id text PRIMARY KEY,
  key_material bytea NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT delay_alert_signing_key_id_ck CHECK (key_id = 'v1'),
  CONSTRAINT delay_alert_signing_key_length_ck CHECK (octet_length(key_material) >= 32)
);

CREATE TABLE private.delay_alert_requests (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  -- Retained request IDs provide replay protection; this FK means an order
  -- cannot be deleted while its request ledger entry is retained.
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL,
  key_id text NOT NULL,
  calculation_status text NOT NULL,
  calculated_at timestamptz NOT NULL,
  calculation_version text NOT NULL,
  total_quantity integer,
  completed_quantity integer,
  remaining_quantity integer,
  final_production_stage text,
  ex_factory_date date,
  observation_window_start date,
  observation_window_end date,
  history_date_count integer NOT NULL,
  observed_daily_output numeric,
  required_daily_output numeric,
  pace_ratio numeric,
  days_remaining integer,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT delay_alert_requests_key_fk
    FOREIGN KEY (key_id) REFERENCES private.delay_alert_signing_keys(key_id) ON DELETE RESTRICT,
  CONSTRAINT delay_alert_requests_status_ck
    CHECK (calculation_status IN
      ('Complete','Overdue','High Risk','At Risk','Watch','On Track','Review Needed')),
  CONSTRAINT delay_alert_requests_version_ck CHECK (calculation_version='phase1-v1'),
  CONSTRAINT delay_alert_requests_history_ck CHECK (history_date_count BETWEEN 0 AND 14),
  CONSTRAINT delay_alert_requests_optional_quantity_ck CHECK (
    total_quantity IS NULL OR completed_quantity IS NULL OR remaining_quantity IS NULL OR
    (total_quantity > 0 AND completed_quantity >= 0 AND completed_quantity <= total_quantity AND
     remaining_quantity = greatest(0, total_quantity::numeric-completed_quantity::numeric))
  )
);

-- New tables use RLS. FORCE is safe here because all API and writer access has
-- explicit policies; the migration owner policy is intentionally administrative.
ALTER TABLE public.delay_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delay_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delay_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delay_alert_events FORCE ROW LEVEL SECURITY;
ALTER TABLE private.delay_alert_signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.delay_alert_signing_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE private.delay_alert_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.delay_alert_requests FORCE ROW LEVEL SECURITY;

-- Only the constrained definer role can access the internal writer paths.
CREATE POLICY delay_alerts_writer_select ON public.delay_alerts
  FOR SELECT TO delay_alert_writer USING (true);
CREATE POLICY delay_alerts_writer_insert ON public.delay_alerts
  FOR INSERT TO delay_alert_writer WITH CHECK (approval_status = 'pending');
CREATE POLICY delay_alerts_writer_update ON public.delay_alerts
  FOR UPDATE TO delay_alert_writer USING (true)
  WITH CHECK (approval_status IN ('pending','approved','dismissed','superseded'));
CREATE POLICY delay_alert_events_writer_insert ON public.delay_alert_events
  FOR INSERT TO delay_alert_writer WITH CHECK (actor_id = auth.uid());
CREATE POLICY delay_alert_keys_writer_select ON private.delay_alert_signing_keys
  FOR SELECT TO delay_alert_writer USING (true);
CREATE POLICY delay_alert_requests_writer_insert ON private.delay_alert_requests
  FOR INSERT TO delay_alert_writer WITH CHECK (actor_id = auth.uid());

-- Administrative maintenance policy applies only to the postgres migration owner
-- on the new objects; it does not alter policies on existing tables.
CREATE POLICY delay_alerts_postgres_admin ON public.delay_alerts
  TO postgres USING (true) WITH CHECK (true);
CREATE POLICY delay_alert_events_postgres_admin ON public.delay_alert_events
  TO postgres USING (true) WITH CHECK (true);
CREATE POLICY delay_alert_keys_postgres_admin ON private.delay_alert_signing_keys
  TO postgres USING (true) WITH CHECK (true);
CREATE POLICY delay_alert_requests_postgres_admin ON private.delay_alert_requests
  TO postgres USING (true) WITH CHECK (true);

-- Merchandisers can review alerts. Buyers can see only approved alerts where the
-- stored buyer_id equals their existing authenticated profile buyer_id.
CREATE POLICY delay_alerts_merchandiser_select ON public.delay_alerts
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND lower(btrim(p.role)) = 'merchandiser')
  );
CREATE POLICY delay_alerts_buyer_approved_select ON public.delay_alerts
  FOR SELECT TO authenticated USING (
    approval_status = 'approved'
    AND buyer_id = public.current_user_buyer_id()
    AND public.current_user_buyer_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.orders o
                WHERE o.id = delay_alerts.order_id AND o.buyer_id = delay_alerts.buyer_id)
    AND EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid() AND lower(btrim(p.role)) = 'buyer')
  );
CREATE POLICY delay_alerts_merchandiser_update ON public.delay_alerts
  FOR UPDATE TO authenticated
  USING (
    approval_status IN ('pending','approved')
    AND EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid() AND lower(btrim(p.role)) = 'merchandiser')
  )
  WITH CHECK (
    approval_status IN ('approved','dismissed')
    AND EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid() AND lower(btrim(p.role)) = 'merchandiser')
  );

CREATE POLICY delay_alert_events_merchandiser_select ON public.delay_alert_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND lower(btrim(p.role)) = 'merchandiser')
  );
CREATE POLICY delay_alert_events_buyer_approved_select ON public.delay_alert_events
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.delay_alerts a
      WHERE a.id = delay_alert_events.alert_id
        AND a.approval_status = 'approved'
        AND a.buyer_id = public.current_user_buyer_id()
        AND public.current_user_buyer_id() IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.orders o
                    WHERE o.id = a.order_id AND o.buyer_id = a.buyer_id)
        AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND lower(btrim(p.role)) = 'buyer')
    )
  );

-- SECURITY DEFINER helper is narrowly scoped because delay_alert_writer is not
-- granted SELECT on orders/profiles. It returns only the actor's role and the
-- addressed order's trusted context, and locks that order row. The function is
-- private and executable only by delay_alert_writer. Existing RLS policies remain
-- untouched; the preflight aborts if FORCE RLS prevents this table-owner helper.
CREATE FUNCTION private.delay_alert_order_context(p_order_id uuid, p_actor_id uuid)
RETURNS TABLE (
  actor_role text,
  actual_buyer_id uuid,
  actual_total_quantity integer,
  actual_completed_quantity integer,
  actual_final_production_stage text,
  actual_ex_factory_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $context$
BEGIN
  RETURN QUERY
  SELECT p.role,
         o.buyer_id,
         o.total_quantity,
         o.completed_quantity,
         o.final_production_stage,
         o.ex_factory_date
  FROM public.profiles p
  JOIN public.orders o ON o.id = p_order_id
  WHERE p.id = p_actor_id
  FOR UPDATE OF o;
END;
$context$;

-- Returns only the authenticated actor's role. Kept separate from the order
-- locking helper so approval triggers never lock an order after an alert row.
CREATE FUNCTION private.delay_alert_actor_role(p_actor_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $actor_role$
  SELECT p.role
  FROM public.profiles p
  WHERE p.id = p_actor_id
$actor_role$;

-- Set the append-only audit data in the same transaction as each state/snapshot
-- change. Authenticated users have no event-table write privilege or policy.
-- The trigger function is SECURITY DEFINER so it can insert through its limited
-- writer grant; callers cannot invoke it as an ordinary function.
GRANT USAGE ON SCHEMA private TO delay_alert_writer;
GRANT CREATE ON SCHEMA private TO delay_alert_writer;
SET ROLE delay_alert_writer;
CREATE FUNCTION private.set_delay_alert_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $audit$
DECLARE
  v_actor uuid := auth.uid();
  v_event_type text;
  v_calculation_status text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required for delay-alert audit.';
  END IF;

  IF TG_WHEN = 'BEFORE' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.approval_status <> 'pending' THEN
        RAISE EXCEPTION 'New delay alerts must start pending.';
      END IF;
      NEW.created_by := v_actor;
      NEW.created_at := clock_timestamp();
      NEW.last_checked_at := NEW.created_at;
      NEW.approved_by := NULL; NEW.approved_at := NULL;
      NEW.dismissed_by := NULL; NEW.dismissed_at := NULL;
      NEW.superseded_by := NULL; NEW.superseded_at := NULL;
      RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id OR
       NEW.order_id IS DISTINCT FROM OLD.order_id OR
       NEW.buyer_id IS DISTINCT FROM OLD.buyer_id OR
       NEW.created_by IS DISTINCT FROM OLD.created_by OR
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Delay-alert identity and creation audit fields are immutable.';
    END IF;

    IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
      IF NOT (
        (OLD.approval_status = 'pending' AND NEW.approval_status IN ('approved','dismissed','superseded')) OR
        (OLD.approval_status = 'approved' AND NEW.approval_status IN ('dismissed','superseded')) OR
        (OLD.approval_status = 'dismissed' AND NEW.approval_status = 'superseded')
      ) THEN
        RAISE EXCEPTION 'Invalid delay-alert state transition: % to %.',
          OLD.approval_status, NEW.approval_status;
      END IF;

      IF NEW.approval_status IN ('approved','dismissed') AND
         lower(btrim(coalesce(private.delay_alert_actor_role(v_actor),''))) <> 'merchandiser' THEN
        RAISE EXCEPTION 'Only merchandisers may approve or dismiss delay alerts.';
      END IF;

      IF NEW.approval_status = 'approved' THEN
        IF NEW.dismissal_reason IS DISTINCT FROM OLD.dismissal_reason THEN
          RAISE EXCEPTION 'Approval cannot set or change a dismissal reason.';
        END IF;
        NEW.approved_by := v_actor;
        NEW.approved_at := clock_timestamp();
      ELSIF NEW.approval_status = 'dismissed' THEN
        IF NEW.dismissal_reason IS NOT NULL AND char_length(NEW.dismissal_reason) > 2000 THEN
          RAISE EXCEPTION 'Dismissal reason exceeds 2,000 characters.';
        END IF;
        NEW.dismissed_by := v_actor;
        NEW.dismissed_at := clock_timestamp();
      ELSE
        NEW.superseded_by := v_actor;
        NEW.superseded_at := clock_timestamp();
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.dismissal_reason IS DISTINCT FROM OLD.dismissal_reason THEN
      RAISE EXCEPTION 'Dismissal reason can change only with a dismissal transition.';
    END IF;
    IF ROW(NEW.risk_level, NEW.calculated_at, NEW.calculation_version,
           NEW.total_quantity, NEW.completed_quantity, NEW.remaining_quantity,
           NEW.final_production_stage, NEW.ex_factory_date,
           NEW.observation_window_start, NEW.observation_window_end,
           NEW.history_date_count, NEW.observed_daily_output,
           NEW.required_daily_output, NEW.pace_ratio, NEW.days_remaining)
       IS DISTINCT FROM
       ROW(OLD.risk_level, OLD.calculated_at, OLD.calculation_version,
           OLD.total_quantity, OLD.completed_quantity, OLD.remaining_quantity,
           OLD.final_production_stage, OLD.ex_factory_date,
           OLD.observation_window_start, OLD.observation_window_end,
           OLD.history_date_count, OLD.observed_daily_output,
           OLD.required_daily_output, OLD.pace_ratio, OLD.days_remaining) AND
       OLD.approval_status <> 'pending' THEN
      RAISE EXCEPTION 'Approved or dismissed snapshots must be superseded before replacement.';
    END IF;
    RETURN NEW;
  END IF;

  -- AFTER trigger: the parent row now exists, so the event FK can be checked.
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.delay_alert_events
      (alert_id, actor_id, event_type, previous_status, new_status, calculation_status)
    VALUES (NEW.id, v_actor, 'created', NULL, NEW.approval_status, NEW.risk_level);
    RETURN NULL;
  END IF;

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF NEW.approval_status = 'approved' THEN
      v_event_type := 'approved';
      v_calculation_status := NEW.risk_level;
    ELSIF NEW.approval_status = 'dismissed' THEN
      v_event_type := 'dismissed';
      v_calculation_status := NEW.risk_level;
    ELSE
      v_event_type := 'superseded';
      v_calculation_status := coalesce(NEW.superseded_by_calculation_status, NEW.risk_level);
    END IF;
    INSERT INTO public.delay_alert_events
      (alert_id, actor_id, event_type, previous_status, new_status,
       calculation_status, dismissal_reason)
    VALUES (NEW.id, v_actor, v_event_type, OLD.approval_status, NEW.approval_status,
            v_calculation_status,
            CASE WHEN NEW.approval_status='dismissed' THEN NEW.dismissal_reason END);
    RETURN NULL;
  END IF;

  IF ROW(NEW.risk_level, NEW.calculated_at, NEW.calculation_version,
         NEW.total_quantity, NEW.completed_quantity, NEW.remaining_quantity,
         NEW.final_production_stage, NEW.ex_factory_date,
         NEW.observation_window_start, NEW.observation_window_end,
         NEW.history_date_count, NEW.observed_daily_output,
         NEW.required_daily_output, NEW.pace_ratio, NEW.days_remaining)
     IS DISTINCT FROM
     ROW(OLD.risk_level, OLD.calculated_at, OLD.calculation_version,
         OLD.total_quantity, OLD.completed_quantity, OLD.remaining_quantity,
         OLD.final_production_stage, OLD.ex_factory_date,
         OLD.observation_window_start, OLD.observation_window_end,
         OLD.history_date_count, OLD.observed_daily_output,
         OLD.required_daily_output, OLD.pace_ratio, OLD.days_remaining) THEN
    INSERT INTO public.delay_alert_events
      (alert_id, actor_id, event_type, previous_status, new_status, calculation_status)
    VALUES (NEW.id, v_actor, 'calculation_changed', OLD.approval_status,
            NEW.approval_status, NEW.risk_level);
  END IF;
  RETURN NULL;
END;
$audit$;

CREATE FUNCTION public.record_delay_candidate(
  p_key_id text,
  p_payload text,
  p_signature_hex text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $record$
DECLARE
  v_lines text[];
  v_names text[] := ARRAY[
    'key_id','request_id','actor_id','order_id','buyer_id','risk_level',
    'calculated_at','calculation_version','total_quantity','completed_quantity',
    'remaining_quantity','final_production_stage_b64url','ex_factory_date',
    'observation_window_start','observation_window_end','history_date_count',
    'observed_daily_output','required_daily_output','pace_ratio','days_remaining'
  ];
  v_values text[];
  v_i integer;
  v_value text;
  v_key_id text;
  v_request_text text;
  v_actor_text text;
  v_order_text text;
  v_buyer_text text;
  v_risk text;
  v_calculated_text text;
  v_version text;
  v_total_text text;
  v_completed_text text;
  v_remaining_text text;
  v_stage_b64 text;
  v_due_text text;
  v_window_start_text text;
  v_window_end_text text;
  v_history_text text;
  v_observed_text text;
  v_required_text text;
  v_pace_text text;
  v_days_text text;
  v_request_id uuid;
  v_actor_id uuid;
  v_order_id uuid;
  v_buyer_id uuid;
  v_uid uuid;
  v_calculated_at timestamptz;
  v_total integer;
  v_completed integer;
  v_remaining integer;
  v_stage_bytes bytea;
  v_stage text;
  v_due date;
  v_window_start date;
  v_window_end date;
  v_history integer;
  v_observed numeric;
  v_required numeric;
  v_pace numeric;
  v_days integer;
  v_key bytea;
  v_expected_signature text;
  v_now timestamptz;
  v_local_today date;
  v_expected_days integer;
  v_comparison_pace numeric;
  v_context record;
  v_constraint_name text;
  v_existing public.delay_alerts%ROWTYPE;
  v_material boolean;
  v_new_id uuid;
  v_int_re text := '^(0|-?[1-9][0-9]*)$';
  v_num_re text := '^-?(0|[1-9][0-9]*)(\.[0-9]+)?([e][+-]?(0|[1-9][0-9]*))?$';
BEGIN
  -- Explicit NULL rejection precedes every parse or cryptographic operation.
  IF p_signature_hex IS NULL THEN
    RAISE EXCEPTION 'Signature is required.' USING ERRCODE='22023';
  END IF;
  IF p_key_id IS NULL OR p_payload IS NULL OR p_key_id <> 'v1' THEN
    RAISE EXCEPTION 'Key ID and payload are required.' USING ERRCODE='22023';
  END IF;
  IF p_signature_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Signature must be 64 lowercase hexadecimal characters.' USING ERRCODE='22023';
  END IF;
  IF position(chr(13) IN p_payload) > 0 OR right(p_payload,1) = chr(10) THEN
    RAISE EXCEPTION 'Payload must use LF separators without CR or trailing LF.' USING ERRCODE='22023';
  END IF;

  v_lines := string_to_array(p_payload, chr(10));
  IF cardinality(v_lines) <> 21 OR v_lines[1] <> 'knittrack-delay-v1' THEN
    RAISE EXCEPTION 'Payload must contain the exact 21-line version 1 contract.' USING ERRCODE='22023';
  END IF;
  FOR v_i IN 1..20 LOOP
    IF split_part(v_lines[v_i+1], '=', 1) <> v_names[v_i] OR
       position('=' IN v_lines[v_i+1]) = 0 THEN
      RAISE EXCEPTION 'Payload field order or name is invalid at line %.', v_i+1 USING ERRCODE='22023';
    END IF;
    v_values[v_i] := substring(v_lines[v_i+1] FROM char_length(v_names[v_i]) + 2);
  END LOOP;

  v_key_id := v_values[1];
  IF v_key_id <> p_key_id OR v_key_id <> 'v1' THEN
    RAISE EXCEPTION 'Payload and RPC key IDs do not match.' USING ERRCODE='22023';
  END IF;
  SELECT key_material INTO v_key
  FROM private.delay_alert_signing_keys
  WHERE key_id = v_key_id AND is_active;
  IF NOT FOUND OR v_key IS NULL OR octet_length(v_key) < 32 THEN
    RAISE EXCEPTION 'No active signing key is configured for this key ID.' USING ERRCODE='22023';
  END IF;

  v_expected_signature := encode(
    extensions.hmac(convert_to(p_payload, 'UTF8'), v_key, 'sha256'), 'hex'
  );
  IF v_expected_signature IS DISTINCT FROM p_signature_hex THEN
    RAISE EXCEPTION 'Delay alert signature verification failed.' USING ERRCODE='28000';
  END IF;

  v_request_text := v_values[2];
  v_actor_text := v_values[3];
  v_order_text := v_values[4];
  v_buyer_text := v_values[5];
  IF v_request_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
     v_actor_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
     v_order_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
     v_buyer_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Payload UUIDs must be canonical lowercase UUID strings.' USING ERRCODE='22023';
  END IF;
  v_request_id := v_request_text::uuid;
  v_actor_id := v_actor_text::uuid;
  v_order_id := v_order_text::uuid;
  v_buyer_id := v_buyer_text::uuid;
  v_uid := auth.uid();
  IF v_uid IS NULL OR v_actor_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Payload actor does not match the authenticated user.' USING ERRCODE='28000';
  END IF;

  v_risk := v_values[6];
  IF v_risk NOT IN ('Complete','Overdue','High Risk','At Risk','Watch','On Track','Review Needed') THEN
    RAISE EXCEPTION 'Unsupported Phase 1 risk classification.' USING ERRCODE='22023';
  END IF;
  v_calculated_text := v_values[7];
  IF v_calculated_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
    RAISE EXCEPTION 'calculated_at must use Date.toISOString() UTC millisecond format.' USING ERRCODE='22023';
  END IF;
  v_calculated_at := v_calculated_text::timestamptz;
  v_version := v_values[8];
  IF v_version <> 'phase1-v1' THEN
    RAISE EXCEPTION 'Unsupported calculation version.' USING ERRCODE='22023';
  END IF;

  -- Every nullable field is checked for the literal sentinel BEFORE casting.
  -- The signer currently always sends non-null observation-window dates, but
  -- accepting the sentinel keeps the parser total for the declared contract.
  v_total_text := v_values[9];
  IF v_total_text = '~' THEN v_total := NULL;
  ELSE
    IF v_total_text !~ v_int_re THEN RAISE EXCEPTION 'Invalid total_quantity.' USING ERRCODE='22023'; END IF;
    v_total := v_total_text::integer;
  END IF;
  v_completed_text := v_values[10];
  IF v_completed_text = '~' THEN v_completed := NULL;
  ELSE
    IF v_completed_text !~ v_int_re THEN RAISE EXCEPTION 'Invalid completed_quantity.' USING ERRCODE='22023'; END IF;
    v_completed := v_completed_text::integer;
  END IF;
  v_remaining_text := v_values[11];
  IF v_remaining_text = '~' THEN v_remaining := NULL;
  ELSE
    IF v_remaining_text !~ v_int_re THEN RAISE EXCEPTION 'Invalid remaining_quantity.' USING ERRCODE='22023'; END IF;
    v_remaining := v_remaining_text::integer;
  END IF;

  v_stage_b64 := v_values[12];
  IF v_stage_b64 = '~' THEN
    v_stage := NULL;
  ELSE
    IF v_stage_b64 !~ '^[A-Za-z0-9_-]*$' OR length(v_stage_b64) % 4 = 1 THEN
      RAISE EXCEPTION 'Final stage is not canonical unpadded base64url.' USING ERRCODE='22023';
    END IF;
    v_stage_bytes := decode(
      translate(v_stage_b64, '-_', '+/') ||
        CASE length(v_stage_b64) % 4 WHEN 0 THEN '' WHEN 2 THEN '==' WHEN 3 THEN '=' ELSE '' END,
      'base64'
    );
    v_stage := convert_from(v_stage_bytes, 'UTF8');
    IF rtrim(translate(replace(encode(v_stage_bytes, 'base64'), chr(10), ''), '+/', '-_'), '=')
       IS DISTINCT FROM v_stage_b64 THEN
      RAISE EXCEPTION 'Final stage base64url encoding is not canonical.' USING ERRCODE='22023';
    END IF;
  END IF;

  v_due_text := v_values[13];
  IF v_due_text = '~' THEN v_due := NULL;
  ELSE
    IF v_due_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid ex_factory_date.' USING ERRCODE='22023'; END IF;
    v_due := v_due_text::date;
  END IF;
  v_window_start_text := v_values[14];
  IF v_window_start_text = '~' THEN v_window_start := NULL;
  ELSE
    IF v_window_start_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid observation_window_start.' USING ERRCODE='22023'; END IF;
    v_window_start := v_window_start_text::date;
  END IF;
  v_window_end_text := v_values[15];
  IF v_window_end_text = '~' THEN v_window_end := NULL;
  ELSE
    IF v_window_end_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid observation_window_end.' USING ERRCODE='22023'; END IF;
    v_window_end := v_window_end_text::date;
  END IF;
  v_history_text := v_values[16];
  IF v_history_text !~ '^(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'history_date_count must be a non-negative integer.' USING ERRCODE='22023'; END IF;
  v_history := v_history_text::integer;
  IF v_history > 14 THEN RAISE EXCEPTION 'history_date_count cannot exceed the 14-day window.' USING ERRCODE='22023'; END IF;

  v_observed_text := v_values[17];
  IF v_observed_text = '~' THEN v_observed := NULL;
  ELSE
    IF v_observed_text !~ v_num_re THEN RAISE EXCEPTION 'Invalid observed_daily_output.' USING ERRCODE='22023'; END IF;
    v_observed := v_observed_text::numeric;
  END IF;
  v_required_text := v_values[18];
  IF v_required_text = '~' THEN v_required := NULL;
  ELSE
    IF v_required_text !~ v_num_re THEN RAISE EXCEPTION 'Invalid required_daily_output.' USING ERRCODE='22023'; END IF;
    v_required := v_required_text::numeric;
  END IF;
  v_pace_text := v_values[19];
  IF v_pace_text = '~' THEN v_pace := NULL;
  ELSE
    IF v_pace_text !~ v_num_re THEN RAISE EXCEPTION 'Invalid pace_ratio.' USING ERRCODE='22023'; END IF;
    v_pace := v_pace_text::numeric;
  END IF;
  v_days_text := v_values[20];
  IF v_days_text = '~' THEN v_days := NULL;
  ELSE
    IF v_days_text !~ v_int_re THEN RAISE EXCEPTION 'Invalid days_remaining.' USING ERRCODE='22023'; END IF;
    v_days := v_days_text::integer;
  END IF;

  v_now := clock_timestamp();
  IF v_calculated_at < v_now - interval '5 minutes' OR
     v_calculated_at > v_now + interval '30 seconds' THEN
    RAISE EXCEPTION 'Signed calculation is older than five minutes or more than thirty seconds in the future.' USING ERRCODE='22023';
  END IF;

  -- Serialize requests for the same order and request UUID. The helper locks the
  -- matching order row, coordinating with order updates that take the same row lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('knittrack-delay-order:' || v_order_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('knittrack-delay-request:' || v_request_id::text, 0));
  SELECT * INTO v_context FROM private.delay_alert_order_context(v_order_id, v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No order/profile context is available for this request.' USING ERRCODE='42501';
  END IF;
  IF lower(btrim(coalesce(v_context.actor_role,''))) <> 'merchandiser' THEN
    RAISE EXCEPTION 'Only a merchandiser may record delay calculations.' USING ERRCODE='42501';
  END IF;
  IF v_context.actual_buyer_id IS DISTINCT FROM v_buyer_id THEN
    RAISE EXCEPTION 'Signed buyer_id does not match the order buyer.' USING ERRCODE='22023';
  END IF;
  IF v_context.actual_total_quantity IS DISTINCT FROM v_total OR
     v_context.actual_completed_quantity IS DISTINCT FROM v_completed OR
     v_context.actual_final_production_stage IS DISTINCT FROM v_stage OR
     v_context.actual_ex_factory_date IS DISTINCT FROM v_due THEN
    RAISE EXCEPTION 'Signed order snapshot does not match the locked order row.' USING ERRCODE='40001';
  END IF;

  -- Validate candidate payloads strictly. Invalid candidates raise and roll back;
  -- they are never silently converted into Review Needed.
  IF v_risk IN ('Overdue','High Risk','At Risk','Watch') THEN
    IF v_total IS NULL OR v_completed IS NULL OR v_remaining IS NULL OR
       v_total <= 0 OR v_completed < 0 OR v_completed > v_total OR
       v_remaining <= 0 OR
       v_remaining::numeric <> v_total::numeric - v_completed::numeric OR
       v_stage IS NULL OR btrim(v_stage) = '' OR v_due IS NULL OR
       v_window_start IS NULL OR v_window_end IS NULL OR v_history IS NULL OR
       v_days IS NULL THEN
      RAISE EXCEPTION 'Candidate snapshot is missing required order, date, stage, or quantity fields.' USING ERRCODE='22023';
    END IF;
    v_local_today := (v_calculated_at AT TIME ZONE 'Asia/Kolkata')::date;
    IF v_window_end <> v_local_today OR v_window_start <> v_window_end - 13 THEN
      RAISE EXCEPTION 'Candidate observation window does not match Phase 1.' USING ERRCODE='22023';
    END IF;
    IF v_days <> greatest(0, v_due - v_local_today + 1) THEN
      RAISE EXCEPTION 'Candidate days_remaining is inconsistent with the ex-factory date.' USING ERRCODE='22023';
    END IF;

    IF v_risk = 'Overdue' THEN
      IF v_due >= v_local_today OR v_days <> 0 OR v_history <> 0 OR
         v_observed IS NOT NULL OR v_required IS NOT NULL OR v_pace IS NOT NULL THEN
        RAISE EXCEPTION 'Overdue snapshot is inconsistent with Phase 1.' USING ERRCODE='22023';
      END IF;
    ELSE
      IF v_due < v_local_today OR v_days < 1 OR v_history < 5 OR
         v_observed IS NULL OR v_observed <= 0 OR
         v_required IS NULL OR v_required <= 0 OR
         v_pace IS NULL OR v_pace <= 0 THEN
        RAISE EXCEPTION 'Pace-based candidate snapshot is incomplete or inconsistent.' USING ERRCODE='22023';
      END IF;
      IF abs(v_required - (v_remaining::numeric / v_days)) >
         greatest(0.0000000001::numeric,
                  abs(v_remaining::numeric / v_days) * 0.0000000001::numeric) THEN
        RAISE EXCEPTION 'required_daily_output does not match remaining quantity and days.' USING ERRCODE='22023';
      END IF;
      IF abs(v_pace - (v_observed / v_required)) >
         greatest(0.000000001::numeric, abs(v_observed / v_required) * 0.000000001::numeric) THEN
        RAISE EXCEPTION 'pace_ratio does not match observed and required rates.' USING ERRCODE='22023';
      END IF;
      v_comparison_pace := round(v_pace, 10);
      -- The server classifies the same canonical decimal text submitted here,
      -- using PostgreSQL-compatible half-away-from-zero rounding at scale 10.
      IF (v_risk = 'High Risk' AND v_comparison_pace >= 0.80) OR
         (v_risk = 'At Risk' AND (v_comparison_pace < 0.80 OR v_comparison_pace >= 1.00)) OR
         (v_risk = 'Watch' AND (v_comparison_pace < 1.00 OR v_comparison_pace >= 1.10)) THEN
        RAISE EXCEPTION 'Candidate risk level does not match the Phase 1 pace threshold.' USING ERRCODE='22023';
      END IF;
    END IF;
  END IF;

  -- A non-candidate can carry NULL snapshot fields. Non-NULL values above have
  -- already been type-checked and the order/buyer identity is still verified.
  -- Request insertion is single-use and shares this transaction with superseding.
  BEGIN
    INSERT INTO private.delay_alert_requests
      (request_id, actor_id, order_id, buyer_id, key_id, calculation_status, calculated_at,
       calculation_version, total_quantity, completed_quantity, remaining_quantity,
       final_production_stage, ex_factory_date, observation_window_start,
       observation_window_end, history_date_count, observed_daily_output,
       required_daily_output, pace_ratio, days_remaining)
    VALUES
      (v_request_id, v_actor_id, v_order_id, v_buyer_id, v_key_id, v_risk, v_calculated_at,
       v_version, v_total, v_completed, v_remaining, v_stage, v_due,
       v_window_start, v_window_end, v_history, v_observed, v_required, v_pace, v_days);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name <> 'delay_alert_requests_pkey' THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'This signed request ID has already been used.' USING ERRCODE='23505';
  END;

  IF v_risk IN ('Complete','On Track','Review Needed') THEN
    UPDATE public.delay_alerts
    SET approval_status = 'superseded',
        superseded_by_calculation_status = v_risk,
        last_checked_at = v_now
    WHERE order_id = v_order_id
      AND approval_status IN ('pending','approved','dismissed');
    RETURN NULL;
  END IF;

  SELECT a.* INTO v_existing
  FROM public.delay_alerts a
  WHERE a.order_id = v_order_id
    AND a.approval_status IN ('pending','approved','dismissed')
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_material :=
      v_existing.risk_level IS DISTINCT FROM v_risk OR
      v_existing.calculation_version IS DISTINCT FROM v_version OR
      v_existing.total_quantity IS DISTINCT FROM v_total OR
      v_existing.completed_quantity IS DISTINCT FROM v_completed OR
      v_existing.remaining_quantity IS DISTINCT FROM v_remaining OR
      v_existing.final_production_stage IS DISTINCT FROM v_stage OR
      v_existing.ex_factory_date IS DISTINCT FROM v_due OR
      v_existing.observation_window_start IS DISTINCT FROM v_window_start OR
      v_existing.observation_window_end IS DISTINCT FROM v_window_end OR
      v_existing.history_date_count IS DISTINCT FROM v_history OR
      v_existing.observed_daily_output IS DISTINCT FROM v_observed OR
      v_existing.required_daily_output IS DISTINCT FROM v_required OR
      v_existing.pace_ratio IS DISTINCT FROM v_pace OR
      v_existing.days_remaining IS DISTINCT FROM v_days;

    IF NOT v_material THEN
      UPDATE public.delay_alerts SET last_checked_at = v_now WHERE id = v_existing.id;
      RETURN v_existing.id;
    END IF;

    IF v_existing.approval_status = 'pending' THEN
      UPDATE public.delay_alerts
      SET risk_level = v_risk,
          calculated_at = v_calculated_at,
          calculation_version = v_version,
          total_quantity = v_total,
          completed_quantity = v_completed,
          remaining_quantity = v_remaining,
          final_production_stage = v_stage,
          ex_factory_date = v_due,
          observation_window_start = v_window_start,
          observation_window_end = v_window_end,
          history_date_count = v_history,
          observed_daily_output = v_observed,
          required_daily_output = v_required,
          pace_ratio = v_pace,
          days_remaining = v_days,
          last_checked_at = v_now
      WHERE id = v_existing.id
      RETURNING id INTO v_new_id;
      RETURN v_new_id;
    END IF;

    -- An approved or dismissed materially stale snapshot is retired. A fresh
    -- pending row is then inserted, requiring a new merchandiser approval.
    UPDATE public.delay_alerts
    SET approval_status = 'superseded',
        superseded_by_calculation_status = v_risk,
        last_checked_at = v_now
    WHERE id = v_existing.id;
  END IF;

  INSERT INTO public.delay_alerts (
    order_id, buyer_id, risk_level, calculated_at, calculation_version,
    total_quantity, completed_quantity, remaining_quantity,
    final_production_stage, ex_factory_date,
    observation_window_start, observation_window_end, history_date_count,
    observed_daily_output, required_daily_output, pace_ratio, days_remaining,
    approval_status, created_by, last_checked_at
  ) VALUES (
    v_order_id, v_buyer_id, v_risk, v_calculated_at, v_version,
    v_total, v_completed, v_remaining,
    v_stage, v_due, v_window_start, v_window_end, v_history,
    v_observed, v_required, v_pace, v_days,
    'pending', v_actor_id, v_now
  ) RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$record$;
-- Temporary trigger-creation privilege granted by the function owner.
GRANT EXECUTE ON FUNCTION private.set_delay_alert_audit_fields() TO postgres;
RESET ROLE;

-- Trigger creation is performed by the existing orders/alerts table owner.
-- PostgreSQL checks function EXECUTE at CREATE TRIGGER time.
CREATE TRIGGER delay_alerts_stamp_before_write
  BEFORE INSERT OR UPDATE ON public.delay_alerts
  FOR EACH ROW EXECUTE FUNCTION private.set_delay_alert_audit_fields();
CREATE TRIGGER delay_alerts_audit_after_change
  AFTER INSERT OR UPDATE ON public.delay_alerts
  FOR EACH ROW EXECUTE FUNCTION private.set_delay_alert_audit_fields();

-- Revoke default PUBLIC EXECUTE as the actual function owner. Revoke the
-- temporary trigger-creation grant before installing the final ACLs.
SET ROLE delay_alert_writer;
REVOKE ALL ON FUNCTION public.record_delay_candidate(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role, delay_alert_writer;
-- The writer owns this SECURITY DEFINER RPC, so it installs the API EXECUTE
-- grant here. After its temporary postgres membership is revoked, postgres
-- could not grant on this function without an explicit grant option.
GRANT EXECUTE ON FUNCTION public.record_delay_candidate(text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION private.set_delay_alert_audit_fields()
  FROM PUBLIC, anon, authenticated, service_role, postgres, delay_alert_writer;
RESET ROLE;

-- Revoke all API/default/temporary grants before installing the final ACLs.
REVOKE ALL ON TABLE public.delay_alerts, public.delay_alert_events,
  private.delay_alert_signing_keys, private.delay_alert_requests
  FROM PUBLIC, anon, authenticated, service_role, delay_alert_writer;
REVOKE ALL ON FUNCTION private.delay_alert_order_context(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role, delay_alert_writer;
REVOKE ALL ON FUNCTION private.delay_alert_actor_role(uuid)
  FROM PUBLIC, anon, authenticated, service_role, delay_alert_writer;
REVOKE CREATE ON SCHEMA public, private FROM delay_alert_writer;
REVOKE USAGE ON SCHEMA public, private, auth, extensions FROM delay_alert_writer;
REVOKE delay_alert_writer FROM postgres;

-- Final grants: all required table/function grants appear after the relevant
-- revokes. authenticated receives only SELECT and two column-level UPDATE rights.
GRANT USAGE ON SCHEMA public, private, auth, extensions TO delay_alert_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE public.delay_alerts TO delay_alert_writer;
GRANT INSERT ON TABLE public.delay_alert_events TO delay_alert_writer;
GRANT SELECT ON TABLE private.delay_alert_signing_keys TO delay_alert_writer;
GRANT INSERT ON TABLE private.delay_alert_requests TO delay_alert_writer;
GRANT EXECUTE ON FUNCTION private.delay_alert_order_context(uuid,uuid) TO delay_alert_writer;
GRANT EXECUTE ON FUNCTION private.delay_alert_actor_role(uuid) TO delay_alert_writer;
GRANT EXECUTE ON FUNCTION extensions.hmac(bytea,bytea,text) TO delay_alert_writer;
GRANT EXECUTE ON FUNCTION auth.uid() TO delay_alert_writer;

GRANT SELECT ON TABLE public.delay_alerts, public.delay_alert_events TO authenticated;
GRANT UPDATE (approval_status, dismissal_reason) ON TABLE public.delay_alerts TO authenticated;

-- No authenticated INSERT/DELETE, no event INSERT/UPDATE/DELETE, and no buyer or
-- supervisor UPDATE policy are granted. No writer grants on orders/profiles/buyers.

COMMIT;

/* -------------------------------------------------------------------------- */
/* 2. CONDITIONAL APPROVAL/DISMISSAL EXAMPLES                                 */
/* Application must execute one conditional update and check affected rows.   */
/* -------------------------------------------------------------------------- */

-- Approval (the reviewer must bind the action to the exact snapshot displayed).
-- The caller supplies only equality predicates; it cannot write snapshot fields.
-- UPDATE public.delay_alerts
-- SET approval_status = 'approved'
-- WHERE id = :alert_id
--   AND approval_status = 'pending'
--   AND risk_level = :seen_risk_level
--   AND calculated_at = :seen_calculated_at
--   AND calculation_version = :seen_calculation_version
--   AND total_quantity IS NOT DISTINCT FROM :seen_total_quantity
--   AND completed_quantity IS NOT DISTINCT FROM :seen_completed_quantity
--   AND remaining_quantity IS NOT DISTINCT FROM :seen_remaining_quantity
--   AND final_production_stage IS NOT DISTINCT FROM :seen_final_stage
--   AND ex_factory_date IS NOT DISTINCT FROM :seen_ex_factory_date
--   AND observation_window_start IS NOT DISTINCT FROM :seen_window_start
--   AND observation_window_end IS NOT DISTINCT FROM :seen_window_end
--   AND history_date_count = :seen_history_date_count
--   AND observed_daily_output IS NOT DISTINCT FROM :seen_observed_daily_output
--   AND required_daily_output IS NOT DISTINCT FROM :seen_required_daily_output
--   AND pace_ratio IS NOT DISTINCT FROM :seen_pace_ratio
--   AND days_remaining IS NOT DISTINCT FROM :seen_days_remaining
-- RETURNING id;
-- Exactly one row means success. Zero rows means another reviewer acted or a
-- calculation refreshed the pending row after this reviewer loaded it; return
-- a conflict and force the reviewer to inspect the current snapshot again.

-- Dismiss a pending alert. Bind the transition to the state the reviewer saw:
-- UPDATE public.delay_alerts
-- SET approval_status = 'dismissed', dismissal_reason = :reason
-- WHERE id = :alert_id AND approval_status = 'pending'
--   AND risk_level = :seen_risk_level
--   AND calculated_at = :seen_calculated_at
--   AND calculation_version = :seen_calculation_version
--   AND total_quantity IS NOT DISTINCT FROM :seen_total_quantity
--   AND completed_quantity IS NOT DISTINCT FROM :seen_completed_quantity
--   AND remaining_quantity IS NOT DISTINCT FROM :seen_remaining_quantity
--   AND final_production_stage IS NOT DISTINCT FROM :seen_final_stage
--   AND ex_factory_date IS NOT DISTINCT FROM :seen_ex_factory_date
--   AND observation_window_start IS NOT DISTINCT FROM :seen_window_start
--   AND observation_window_end IS NOT DISTINCT FROM :seen_window_end
--   AND history_date_count = :seen_history_date_count
--   AND observed_daily_output IS NOT DISTINCT FROM :seen_observed_daily_output
--   AND required_daily_output IS NOT DISTINCT FROM :seen_required_daily_output
--   AND pace_ratio IS NOT DISTINCT FROM :seen_pace_ratio
--   AND days_remaining IS NOT DISTINCT FROM :seen_days_remaining
-- RETURNING id;
-- A separate, explicit approved->dismissed action may use
-- the same full snapshot predicates with approval_status = 'approved'. Do not
-- use an IN predicate: if approve and dismiss race from pending, the loser must
-- affect zero rows rather than silently applying a second transition.
-- Exactly one row means success. Zero rows means a conflicting/stale action.

/* -------------------------------------------------------------------------- */
/* 3. POST-MIGRATION VERIFICATION (READ ONLY)                                */
/* -------------------------------------------------------------------------- */

-- Role attributes: NOLOGIN, no superuser, no create role/db, no inherit, no bypass.
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls
FROM pg_roles WHERE rolname = 'delay_alert_writer';

-- Effective writer table privileges and forbidden unrelated-table access.
SELECT has_table_privilege('delay_alert_writer','public.delay_alerts','SELECT') AS writer_alert_select,
       has_table_privilege('delay_alert_writer','public.delay_alerts','INSERT') AS writer_alert_insert,
       has_table_privilege('delay_alert_writer','public.delay_alerts','UPDATE') AS writer_alert_update,
       has_table_privilege('delay_alert_writer','public.delay_alert_events','INSERT') AS writer_event_insert,
       has_table_privilege('delay_alert_writer','private.delay_alert_signing_keys','SELECT') AS writer_key_select,
       has_table_privilege('delay_alert_writer','private.delay_alert_requests','INSERT') AS writer_request_insert,
       has_table_privilege('delay_alert_writer','public.orders','SELECT') AS writer_orders_select_must_be_false,
       has_table_privilege('delay_alert_writer','public.profiles','SELECT') AS writer_profiles_select_must_be_false,
       has_table_privilege('delay_alert_writer','public.buyers','SELECT') AS writer_buyers_select_must_be_false;

SELECT has_table_privilege('service_role','public.delay_alerts','SELECT') AS service_alert_select_must_be_false,
       has_table_privilege('service_role','public.delay_alert_events','SELECT') AS service_event_select_must_be_false,
       has_function_privilege('service_role','public.record_delay_candidate(text,text,text)','EXECUTE') AS service_rpc_execute_must_be_false;

-- Writer must have no direct CRUD access to existing business tables, and no
-- deletion or audit-event mutation privilege. The only bridge is the private,
-- EXECUTE-only SECURITY DEFINER context/role helpers.
SELECT target_table, privilege,
       has_table_privilege('delay_alert_writer', target_table, privilege) AS granted_must_be_false
FROM (VALUES
  ('public.orders','SELECT'),('public.orders','INSERT'),('public.orders','UPDATE'),('public.orders','DELETE'),
  ('public.profiles','SELECT'),('public.profiles','INSERT'),('public.profiles','UPDATE'),('public.profiles','DELETE'),
  ('public.buyers','SELECT'),('public.buyers','INSERT'),('public.buyers','UPDATE'),('public.buyers','DELETE'),
  ('public.delay_alerts','DELETE'),
  ('public.delay_alert_events','SELECT'),('public.delay_alert_events','UPDATE'),('public.delay_alert_events','DELETE'),
  ('private.delay_alert_signing_keys','INSERT'),('private.delay_alert_signing_keys','UPDATE'),('private.delay_alert_signing_keys','DELETE'),
  ('private.delay_alert_requests','SELECT'),('private.delay_alert_requests','UPDATE'),('private.delay_alert_requests','DELETE')
) AS expected_absent(target_table, privilege);

SELECT has_schema_privilege('delay_alert_writer','public','USAGE') AS writer_public_usage,
       has_schema_privilege('delay_alert_writer','public','CREATE') AS writer_public_create_must_be_false,
       has_schema_privilege('delay_alert_writer','private','USAGE') AS writer_private_usage,
       has_schema_privilege('delay_alert_writer','private','CREATE') AS writer_private_create_must_be_false,
       pg_has_role('postgres','delay_alert_writer','MEMBER') AS postgres_writer_membership_must_be_false;

-- Authenticated table and column privileges.
SELECT has_table_privilege('authenticated','public.delay_alerts','SELECT') AS auth_alert_select,
       has_table_privilege('authenticated','public.delay_alerts','INSERT') AS auth_alert_insert_must_be_false,
       has_table_privilege('authenticated','public.delay_alerts','DELETE') AS auth_alert_delete_must_be_false,
       has_column_privilege('authenticated','public.delay_alerts','approval_status','UPDATE') AS auth_status_update,
       has_column_privilege('authenticated','public.delay_alerts','dismissal_reason','UPDATE') AS auth_reason_update,
       has_column_privilege('authenticated','public.delay_alerts','risk_level','UPDATE') AS auth_risk_update_must_be_false,
       has_table_privilege('authenticated','public.delay_alert_events','SELECT') AS auth_events_select,
       has_table_privilege('authenticated','public.delay_alert_events','INSERT') AS auth_events_insert_must_be_false,
       has_table_privilege('authenticated','public.delay_alert_events','UPDATE') AS auth_events_update_must_be_false,
       has_table_privilege('authenticated','public.delay_alert_events','DELETE') AS auth_events_delete_must_be_false;

SELECT column_name,
       has_column_privilege('authenticated','public.delay_alerts',column_name,'UPDATE') AS authenticated_can_update_column
FROM information_schema.columns
WHERE table_schema='public' AND table_name='delay_alerts'
ORDER BY ordinal_position;

-- Required function execution privileges and forbidden helper/trigger access.
SELECT has_function_privilege('authenticated','public.record_delay_candidate(text,text,text)','EXECUTE') AS auth_rpc_execute,
       has_function_privilege('delay_alert_writer','auth.uid()','EXECUTE') AS writer_auth_uid_execute,
       has_function_privilege('delay_alert_writer','extensions.hmac(bytea,bytea,text)','EXECUTE') AS writer_hmac_execute,
       has_function_privilege('delay_alert_writer','gen_random_uuid()','EXECUTE') AS writer_uuid_default_execute,
       has_function_privilege('delay_alert_writer','private.delay_alert_order_context(uuid,uuid)','EXECUTE') AS writer_context_execute,
       has_function_privilege('delay_alert_writer','private.delay_alert_actor_role(uuid)','EXECUTE') AS writer_actor_role_execute,
       has_function_privilege('authenticated','private.delay_alert_order_context(uuid,uuid)','EXECUTE') AS auth_context_execute_must_be_false,
       has_function_privilege('authenticated','private.delay_alert_actor_role(uuid)','EXECUTE') AS auth_actor_role_execute_must_be_false,
       has_function_privilege('authenticated','private.set_delay_alert_audit_fields()','EXECUTE') AS auth_trigger_execute_must_be_false;

-- Function owner, security mode, and pinned search_path.
SELECT p.oid::regprocedure AS function_name,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings
FROM pg_proc p
WHERE p.oid IN (
  'public.record_delay_candidate(text,text,text)'::regprocedure,
  'private.delay_alert_order_context(uuid,uuid)'::regprocedure,
  'private.delay_alert_actor_role(uuid)'::regprocedure,
  'private.set_delay_alert_audit_fields()'::regprocedure
)
ORDER BY 1;

-- RLS and FORCE state for all newly created tables.
SELECT c.oid::regclass AS table_name, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='public' AND c.relname IN ('delay_alerts','delay_alert_events'))
   OR (n.nspname='private' AND c.relname IN ('delay_alert_signing_keys','delay_alert_requests'))
ORDER BY 1;

-- Verify approved-buyer and merchandiser policies exist; no policy on existing tables is altered.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE (schemaname='public' AND tablename IN ('delay_alerts','delay_alert_events'))
   OR (schemaname='private' AND tablename IN ('delay_alert_signing_keys','delay_alert_requests'))
ORDER BY schemaname, tablename, policyname;

-- Verify the partial uniqueness rule and the version/risk checks.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='delay_alerts'
ORDER BY indexname;
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.delay_alerts'::regclass,'public.delay_alert_events'::regclass)
ORDER BY table_name, conname;

-- Verify the buyer helper is still present and SECURITY DEFINER.
SELECT p.oid::regprocedure AS function_name,
       p.prosecdef,
       pg_get_userbyid(p.proowner) AS owner,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       p.proconfig AS function_settings,
       EXISTS (
         SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS setting
         WHERE setting ~ '^search_path=pg_catalog(,|$)'
           AND position('$user' IN setting)=0
           AND position('pg_temp' IN setting)=0
       ) AS has_pinned_safe_search_path,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
WHERE p.oid = 'public.current_user_buyer_id()'::regprocedure;

-- Verify all three foreign-key retention rules that use ON DELETE RESTRICT.
-- An order with any candidate request or alert cannot be deleted while its
-- request/alert rows remain; an alert with audit history cannot be deleted.
SELECT conrelid::regclass AS referencing_table,
       conname,
       pg_get_constraintdef(oid) AS definition,
       confdeltype = 'r' AS delete_is_restrict
FROM pg_constraint
WHERE conname IN ('delay_alerts_order_id_fkey',
                  'delay_alert_events_alert_id_fkey',
                  'delay_alert_requests_order_id_fkey',
                  'delay_alert_requests_key_fk')
ORDER BY referencing_table, conname;

-- Existing policy names/definitions should match the preflight output exactly.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('orders','profiles','buyers','production_updates')
ORDER BY tablename, policyname;

/* -------------------------------------------------------------------------- */
/* 4. ROLLBACK (DESTRUCTIVE; export audit/alert/request data first)            */
/* Run only with explicit approval after preserving required audit records.    */
/* -------------------------------------------------------------------------- */

-- BEGIN;
-- DROP TRIGGER IF EXISTS delay_alerts_stamp_before_write ON public.delay_alerts;
-- DROP TRIGGER IF EXISTS delay_alerts_audit_after_change ON public.delay_alerts;
-- GRANT delay_alert_writer TO postgres;
-- SET ROLE delay_alert_writer;
-- DROP FUNCTION IF EXISTS public.record_delay_candidate(text,text,text);
-- DROP FUNCTION IF EXISTS private.set_delay_alert_audit_fields();
-- RESET ROLE;
-- DROP FUNCTION IF EXISTS private.delay_alert_order_context(uuid,uuid);
-- DROP FUNCTION IF EXISTS private.delay_alert_actor_role(uuid);
-- DROP TABLE IF EXISTS public.delay_alert_events;
-- DROP TABLE IF EXISTS public.delay_alerts;
-- DROP TABLE IF EXISTS private.delay_alert_requests;
-- DROP TABLE IF EXISTS private.delay_alert_signing_keys;
-- REVOKE EXECUTE ON FUNCTION auth.uid() FROM delay_alert_writer;
-- REVOKE EXECUTE ON FUNCTION extensions.hmac(bytea,bytea,text) FROM delay_alert_writer;
-- REVOKE USAGE ON SCHEMA public, private, auth, extensions FROM delay_alert_writer;
-- REVOKE delay_alert_writer FROM postgres;
-- DROP ROLE delay_alert_writer;
-- DROP SCHEMA private RESTRICT; -- succeeds only if no later object was added there
-- COMMIT;
