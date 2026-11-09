\set ON_ERROR_STOP on

DO $$
DECLARE
  v_role pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO v_role FROM pg_roles WHERE rolname='delay_alert_writer';
  IF NOT FOUND OR v_role.rolcanlogin OR v_role.rolsuper OR v_role.rolcreatedb OR
     v_role.rolcreaterole OR v_role.rolinherit OR v_role.rolbypassrls THEN
    RAISE EXCEPTION 'delay_alert_writer role attributes are too broad';
  END IF;

  IF NOT has_table_privilege('delay_alert_writer','public.delay_alerts','SELECT') OR
     NOT has_table_privilege('delay_alert_writer','public.delay_alerts','INSERT') OR
     NOT has_table_privilege('delay_alert_writer','public.delay_alerts','UPDATE') OR
     NOT has_table_privilege('delay_alert_writer','public.delay_alert_events','INSERT') OR
     NOT has_table_privilege('delay_alert_writer','private.delay_alert_signing_keys','SELECT') OR
     NOT has_table_privilege('delay_alert_writer','private.delay_alert_requests','INSERT') THEN
    RAISE EXCEPTION 'Writer is missing a required alert-table privilege';
  END IF;
  IF has_table_privilege('delay_alert_writer','public.delay_alerts','DELETE') OR
     has_table_privilege('delay_alert_writer','public.delay_alert_events','SELECT') OR
     has_table_privilege('delay_alert_writer','public.delay_alert_events','UPDATE') OR
     has_table_privilege('delay_alert_writer','public.delay_alert_events','DELETE') OR
     has_table_privilege('delay_alert_writer','private.delay_alert_signing_keys','INSERT') OR
     has_table_privilege('delay_alert_writer','private.delay_alert_requests','SELECT') OR
     has_table_privilege('delay_alert_writer','public.orders','SELECT') OR
     has_table_privilege('delay_alert_writer','public.profiles','SELECT') OR
     has_table_privilege('delay_alert_writer','public.buyers','SELECT') THEN
    RAISE EXCEPTION 'Writer has a forbidden table privilege';
  END IF;

  IF NOT has_table_privilege('authenticated','public.delay_alerts','SELECT') OR
     NOT has_table_privilege('authenticated','public.delay_alert_events','SELECT') OR
     has_table_privilege('authenticated','public.delay_alerts','INSERT') OR
     has_table_privilege('authenticated','public.delay_alerts','DELETE') OR
     has_table_privilege('authenticated','public.delay_alert_events','INSERT') OR
     has_table_privilege('authenticated','public.delay_alert_events','UPDATE') OR
     has_table_privilege('authenticated','public.delay_alert_events','DELETE') OR
     NOT has_column_privilege('authenticated','public.delay_alerts','approval_status','UPDATE') OR
     NOT has_column_privilege('authenticated','public.delay_alerts','dismissal_reason','UPDATE') OR
     has_column_privilege('authenticated','public.delay_alerts','risk_level','UPDATE') OR
     has_column_privilege('authenticated','public.delay_alerts','buyer_id','UPDATE') THEN
    RAISE EXCEPTION 'Authenticated direct table/column privileges are incorrect';
  END IF;

  IF NOT has_function_privilege('delay_alert_writer','auth.uid()','EXECUTE') OR
     NOT has_function_privilege('delay_alert_writer','extensions.hmac(bytea,bytea,text)','EXECUTE') OR
     NOT has_function_privilege('delay_alert_writer','private.delay_alert_order_context(uuid,uuid)','EXECUTE') OR
     NOT has_function_privilege('delay_alert_writer','private.delay_alert_actor_role(uuid)','EXECUTE') OR
     NOT has_function_privilege('authenticated','public.record_delay_candidate(text,text,text)','EXECUTE') OR
     has_function_privilege('service_role','public.record_delay_candidate(text,text,text)','EXECUTE') OR
     has_function_privilege('authenticated','private.set_delay_alert_audit_fields()','EXECUTE') THEN
    RAISE EXCEPTION 'Function execution grants are incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid='public.record_delay_candidate(text,text,text)'::regprocedure
      AND r.rolname='delay_alert_writer' AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=pg_catalog']
  ) THEN
    RAISE EXCEPTION 'RPC owner, SECURITY DEFINER mode, or fixed search_path is wrong';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.current_user_buyer_id()'::regprocedure
      AND p.prosecdef
      AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS setting
                  WHERE setting ~ '^search_path=pg_catalog(,|$)')
  ) THEN
    RAISE EXCEPTION 'Buyer helper owner/security/search_path preflight is not satisfied';
  END IF;

  IF (SELECT count(*) FROM pg_trigger
      WHERE tgrelid='public.delay_alerts'::regclass AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'Expected both before-write and after-change audit triggers';
  END IF;
  IF (SELECT count(*) FROM pg_policy
      WHERE polrelid IN ('public.delay_alerts'::regclass,
                         'public.delay_alert_events'::regclass,
                         'private.delay_alert_signing_keys'::regclass,
                         'private.delay_alert_requests'::regclass)) < 10 THEN
    RAISE EXCEPTION 'Expected writer, admin, merchandiser and buyer RLS policies';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
      WHERE conname IN ('delay_alerts_order_id_fkey',
                        'delay_alert_events_alert_id_fkey',
                        'delay_alert_requests_order_id_fkey',
                        'delay_alert_requests_key_fk')
        AND confdeltype='r') <> 4 THEN
    RAISE EXCEPTION 'All order/alert/key retention foreign keys must use RESTRICT';
  END IF;
END;
$$;

SELECT 'database privilege, owner, RLS, trigger, and FK assertions passed' AS result;
