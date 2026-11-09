\set ON_ERROR_STOP on

-- This script runs only inside the disposable PostgreSQL 17 container.
BEGIN;

CREATE SCHEMA test_harness;
REVOKE ALL ON SCHEMA test_harness FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA test_harness TO authenticated;

-- SECURITY INVOKER test helpers call the same RPC and apply the same RLS as
-- authenticated PostgREST requests. They are confined to this disposable DB.
CREATE FUNCTION test_harness.expect_update_rejected(
  p_order_id uuid,
  p_stage text,
  p_quantity numeric,
  p_issue_note text,
  p_update_date date,
  p_expected_sqlstate text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public, test_harness, auth
AS $function$
DECLARE
  v_before integer;
  v_after integer;
  v_state text;
  v_rejected boolean := false;
BEGIN
  SELECT count(*) INTO v_before
  FROM public.production_updates AS u
  WHERE u.order_id = p_order_id;
  BEGIN
    PERFORM public.submit_production_update(
      p_order_id, p_stage, p_quantity, p_issue_note, p_update_date
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> p_expected_sqlstate THEN
      RAISE EXCEPTION 'Expected SQLSTATE %, received %.', p_expected_sqlstate, v_state;
    END IF;
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Expected the production update to be rejected with SQLSTATE %.', p_expected_sqlstate;
  END IF;
  SELECT count(*) INTO v_after
  FROM public.production_updates AS u
  WHERE u.order_id = p_order_id;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'A rejected production update left a history row.';
  END IF;
END;
$function$;

CREATE FUNCTION test_harness.expect_final_stage_rejected(
  p_order_id uuid,
  p_stage text,
  p_expected_sqlstate text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public, test_harness, auth
AS $function$
DECLARE
  v_before text;
  v_after text;
  v_state text;
  v_rejected boolean := false;
BEGIN
  SELECT o.final_production_stage INTO v_before
  FROM public.orders AS o WHERE o.id = p_order_id;
  BEGIN
    PERFORM public.configure_order_final_stage(p_order_id, p_stage);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> p_expected_sqlstate THEN
      RAISE EXCEPTION 'Expected SQLSTATE %, received %.', p_expected_sqlstate, v_state;
    END IF;
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Expected final-stage configuration to be rejected with SQLSTATE %.', p_expected_sqlstate;
  END IF;
  SELECT o.final_production_stage INTO v_after
  FROM public.orders AS o WHERE o.id = p_order_id;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'A rejected final-stage decision changed the order.';
  END IF;
END;
$function$;

CREATE FUNCTION test_harness.expect_order_stage_insert_rejected(
  p_po_number text,
  p_current_stage text,
  p_final_stage text,
  p_expected_constraint text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public, test_harness, auth
AS $function$
DECLARE
  v_before integer;
  v_after integer;
  v_state text;
  v_constraint text;
  v_rejected boolean := false;
BEGIN
  SELECT count(*) INTO v_before FROM public.orders WHERE po_number=p_po_number;
  BEGIN
    INSERT INTO public.orders
      (po_number,buyer_id,style_name,colour,total_quantity,completed_quantity,
       current_stage,ex_factory_date,final_production_stage)
    VALUES
      (p_po_number,'10000000-0000-4000-8000-000000000001',
       'Invalid Stage Test','Grey',10,0,p_current_stage,current_date+10,p_final_stage);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_state = RETURNED_SQLSTATE,
      v_constraint = CONSTRAINT_NAME;
    IF v_state <> '23514' OR v_constraint IS DISTINCT FROM p_expected_constraint THEN
      RAISE EXCEPTION 'Expected check constraint %, received SQLSTATE % and constraint %.',
        p_expected_constraint,v_state,v_constraint;
    END IF;
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Invalid order stage values were accepted.';
  END IF;
  SELECT count(*) INTO v_after FROM public.orders WHERE po_number=p_po_number;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'Rejected order insertion left a row behind.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION test_harness.expect_update_rejected(uuid,text,numeric,text,date,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION test_harness.expect_final_stage_rejected(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION test_harness.expect_order_stage_insert_rejected(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION test_harness.expect_update_rejected(uuid,text,numeric,text,date,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION test_harness.expect_final_stage_rejected(uuid,text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION test_harness.expect_order_stage_insert_rejected(text,text,text,text)
  TO authenticated;

-- Phase 2 proposal compatibility checks: verify expected columns, ownership,
-- RLS, helper properties, grants, extension location, and absent private schema.
DO $compatibility$
DECLARE
  v_owner text;
  v_settings text[];
  v_is_definer boolean;
  v_rls_enabled boolean;
  v_force_rls boolean;
  v_return_type text;
BEGIN
  IF current_user <> 'postgres' OR
     (SELECT rolsuper OR rolbypassrls OR NOT rolcreaterole
      FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'The migration role does not match the Phase 2 preflight expectations.';
  END IF;
  IF to_regclass('private.delay_alerts') IS NOT NULL OR
     to_regnamespace('private') IS NOT NULL OR
     EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'delay_alert_writer') THEN
    RAISE EXCEPTION 'The core baseline unexpectedly created Phase 2 objects.';
  END IF;
  IF to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL OR
     NOT has_function_privilege('postgres','extensions.hmac(bytea,bytea,text)','EXECUTE') OR
     NOT has_function_privilege('postgres','auth.uid()','EXECUTE') OR
     NOT has_function_privilege('authenticated','auth.uid()','EXECUTE') THEN
    RAISE EXCEPTION 'Phase 2 HMAC/auth function prerequisites are missing.';
  END IF;
  IF NOT has_table_privilege('authenticated','public.profiles','SELECT') OR
     NOT has_table_privilege('authenticated','public.orders','SELECT') OR
     NOT has_table_privilege('postgres','public.orders','REFERENCES') OR
     NOT has_schema_privilege('postgres','public','CREATE') THEN
    RAISE EXCEPTION 'Phase 2 required core table/schema privileges are missing.';
  END IF;
  SELECT pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity
    INTO v_owner, v_rls_enabled, v_force_rls
  FROM pg_class AS c
  WHERE c.oid = 'public.orders'::regclass;
  IF v_owner <> 'postgres' OR NOT v_rls_enabled OR v_force_rls THEN
    RAISE EXCEPTION 'orders owner/RLS/FORCE state is incompatible with Phase 2.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class AS c
    WHERE c.oid='public.profiles'::regclass
      AND pg_get_userbyid(c.relowner)='postgres'
      AND c.relrowsecurity AND NOT c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'profiles owner/RLS/FORCE state is incompatible with Phase 2.';
  END IF;
  SELECT p.proconfig, p.prosecdef, pg_get_userbyid(p.proowner), p.prorettype::regtype::text
    INTO v_settings, v_is_definer, v_owner, v_return_type
  FROM pg_proc AS p WHERE p.oid = 'public.current_user_buyer_id()'::regprocedure;
  IF v_owner <> 'postgres' OR NOT v_is_definer OR v_return_type <> 'uuid' OR
     NOT EXISTS (SELECT 1 FROM unnest(v_settings) AS setting WHERE setting LIKE 'search_path=pg_catalog,%') OR
     NOT has_function_privilege('authenticated','public.current_user_buyer_id()','EXECUTE') THEN
    RAISE EXCEPTION 'current_user_buyer_id() does not meet the Phase 2 helper contract.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class AS c WHERE c.oid='public.profiles'::regclass
      AND c.relrowsecurity AND NOT c.relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class AS c WHERE c.oid='public.orders'::regclass
      AND c.relrowsecurity AND NOT c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Phase 2 requires RLS on orders/profiles without FORCE RLS.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders'
      AND column_name='final_production_stage' AND data_type='text' AND is_nullable='YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders'
      AND column_name='completed_quantity' AND data_type='integer'
  ) THEN
    RAISE EXCEPTION 'Phase 2 required orders columns do not match the baseline.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('buyers','id','uuid'),
      ('buyers','company_name','text'),
      ('profiles','id','uuid'),
      ('profiles','role','text'),
      ('profiles','buyer_id','uuid'),
      ('orders','id','uuid'),
      ('orders','buyer_id','uuid'),
      ('orders','total_quantity','integer'),
      ('orders','completed_quantity','integer'),
      ('orders','current_stage','text'),
      ('orders','ex_factory_date','date'),
      ('orders','assigned_supervisor_id','uuid'),
      ('production_updates','id','uuid'),
      ('production_updates','order_id','uuid'),
      ('production_updates','stage','text'),
      ('production_updates','quantity_completed','integer'),
      ('production_updates','issue_note','text'),
      ('production_updates','photo_url','text'),
      ('production_updates','update_date','date'),
      ('production_updates','supervisor_id','uuid'),
      ('tna_milestones','order_id','uuid'),
      ('tna_milestones','milestone_name','text'),
      ('tna_milestones','planned_date','date'),
      ('tna_milestones','actual_date','date'),
      ('tna_milestones','status','text')
    ) AS expected(table_name,column_name,data_type)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns AS actual
      WHERE actual.table_schema='public'
        AND actual.table_name=expected.table_name
        AND actual.column_name=expected.column_name
        AND actual.data_type=expected.data_type
    )
  ) THEN
    RAISE EXCEPTION 'A required app/Phase 2 table column or type is missing.';
  END IF;
END;
$compatibility$;

-- The successful seed should produce the two buyers, five profiles, two orders,
-- eight daily update rows, and two milestones. The total reflects finished
-- Finishing output only; Cutting and Packing throughput remains intermediate.
DO $seed_result$
BEGIN
  IF (SELECT count(*) FROM public.buyers) <> 2 OR
     (SELECT count(*) FROM public.profiles) <> 5 OR
     (SELECT count(*) FROM public.orders) <> 2 OR
     (SELECT count(*) FROM public.production_updates) <> 8 OR
     (SELECT count(*) FROM public.tna_milestones) <> 2 THEN
    RAISE EXCEPTION 'Successful synthetic seed row counts are incorrect.';
  END IF;
  IF (SELECT completed_quantity FROM public.orders WHERE po_number='STAGING-DEMO-B-001') <> 20 OR
     (SELECT completed_quantity FROM public.orders WHERE po_number='STAGING-DEMO-C-001') <> 0 THEN
    RAISE EXCEPTION 'Seeded completed quantity includes intermediate-stage throughput.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.production_updates
    WHERE photo_url IS DISTINCT FROM ''
  ) THEN
    RAISE EXCEPTION 'Seeded RPC updates did not retain the empty photo URL behavior.';
  END IF;
END;
$seed_result$;

-- Buyer B can read only B's rows, including milestone/history rows.
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
SET LOCAL ROLE authenticated;
DO $buyer_b_isolation$
BEGIN
  IF (SELECT count(*) FROM public.orders WHERE po_number='STAGING-DEMO-B-001') <> 1 OR
     (SELECT count(*) FROM public.orders WHERE po_number='STAGING-DEMO-C-001') <> 0 OR
     (SELECT count(*) FROM public.production_updates WHERE order_id='20000000-0000-4000-8000-000000000001') <> 7 OR
     (SELECT count(*) FROM public.production_updates WHERE order_id='20000000-0000-4000-8000-000000000002') <> 0 OR
     (SELECT count(*) FROM public.tna_milestones WHERE order_id='20000000-0000-4000-8000-000000000001') <> 1 OR
     (SELECT count(*) FROM public.tna_milestones WHERE order_id='20000000-0000-4000-8000-000000000002') <> 0 OR
     (SELECT count(*) FROM public.buyers WHERE id='10000000-0000-4000-8000-000000000002') <> 0 OR
     (SELECT count(*) FROM public.profiles) <> 1 THEN
    RAISE EXCEPTION 'Buyer B can see cross-company or non-own profile data.';
  END IF;
END;
$buyer_b_isolation$;
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000001','Finishing',1,NULL,current_date,'42501'
);
SELECT test_harness.expect_final_stage_rejected(
  '20000000-0000-4000-8000-000000000001','Packing','42501'
);
RESET ROLE;

-- Buyer C is independently isolated from Buyer B.
SELECT set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
SET LOCAL ROLE authenticated;
DO $buyer_c_isolation$
BEGIN
  IF (SELECT count(*) FROM public.orders WHERE po_number='STAGING-DEMO-C-001') <> 1 OR
     (SELECT count(*) FROM public.orders WHERE po_number='STAGING-DEMO-B-001') <> 0 OR
     (SELECT count(*) FROM public.production_updates WHERE order_id='20000000-0000-4000-8000-000000000002') <> 1 OR
     (SELECT count(*) FROM public.production_updates WHERE order_id='20000000-0000-4000-8000-000000000001') <> 0 OR
     (SELECT count(*) FROM public.tna_milestones WHERE order_id='20000000-0000-4000-8000-000000000002') <> 1 OR
     (SELECT count(*) FROM public.tna_milestones WHERE order_id='20000000-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'Buyer C can see Buyer B data or cannot see its own data.';
  END IF;
END;
$buyer_c_isolation$;
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000002','Knitting',1,NULL,current_date,'42501'
);
RESET ROLE;

-- A supervisor sees only orders assigned to that exact account, not orders
-- assigned to another supervisor or orders owned by a different buyer.
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $supervisor_one_scope$
BEGIN
  IF (SELECT count(*) FROM public.orders WHERE po_number='STAGING-DEMO-B-001') <> 1 OR
     (SELECT count(*) FROM public.orders WHERE po_number='STAGING-DEMO-C-001') <> 0 OR
     (SELECT count(*) FROM public.production_updates WHERE order_id='20000000-0000-4000-8000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'Supervisor one can read an order/update assigned to another supervisor.';
  END IF;
END;
$supervisor_one_scope$;
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000002','Knitting',1,NULL,current_date,'P0002'
);
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000001','Embroidery',1,NULL,current_date,'22023'
);
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000001','Cutting',0,NULL,current_date,'22023'
);
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000001','Cutting',1.5,NULL,current_date,'22023'
);
SELECT test_harness.expect_final_stage_rejected(
  '20000000-0000-4000-8000-000000000001','Packing','42501'
);
DO $supervisor_write_permissions$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.orders SET assigned_supervisor_id='33333333-3333-4333-8333-333333333333'
  WHERE po_number='STAGING-DEMO-B-001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'A supervisor changed order assignment.'; END IF;
END;
$supervisor_write_permissions$;
RESET ROLE;

-- Second supervisor sees only C and is the only supervisor allowed to submit
-- an update for C. This successful update is intermediate until final stage is
-- configured later in the merchandiser section.
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SET LOCAL ROLE authenticated;
DO $supervisor_two_scope$
BEGIN
  IF (SELECT count(*) FROM public.orders WHERE po_number='STAGING-DEMO-C-001') <> 1 OR
     (SELECT count(*) FROM public.orders WHERE po_number='STAGING-DEMO-B-001') <> 0 THEN
    RAISE EXCEPTION 'Supervisor two can read orders outside their assignment.';
  END IF;
END;
$supervisor_two_scope$;
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000001','Finishing',1,NULL,current_date,'P0002'
);
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000002','Knitting',3,NULL,current_date
);
DO $supervisor_attribution$
BEGIN
  IF (SELECT supervisor_id FROM public.production_updates
      WHERE order_id='20000000-0000-4000-8000-000000000002'
      ORDER BY created_at DESC LIMIT 1) <> '33333333-3333-4333-8333-333333333333' OR
     (SELECT completed_quantity FROM public.orders
      WHERE id='20000000-0000-4000-8000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'Supervisor attribution or intermediate quantity behavior is incorrect.';
  END IF;
END;
$supervisor_attribution$;
RESET ROLE;

-- Merchandiser can see/manage all core rows and perform permitted writes.
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $merchandiser_access$
DECLARE
  v_new_order uuid;
  v_denied boolean := false;
BEGIN
  IF (SELECT count(*) FROM public.orders) <> 2 OR
     (SELECT count(*) FROM public.buyers) <> 2 OR
     (SELECT count(*) FROM public.profiles) <> 5 OR
     (SELECT count(*) FROM public.production_updates) <> 9 OR
     (SELECT count(*) FROM public.tna_milestones) <> 2 THEN
    RAISE EXCEPTION 'Merchandiser does not have the intended all-order management reads.';
  END IF;

  PERFORM test_harness.expect_order_stage_insert_rejected(
    'STAGING-DEMO-INVALID-CURRENT-001','Embroidery','Finishing','orders_current_stage_ck'
  );
  PERFORM test_harness.expect_order_stage_insert_rejected(
    'STAGING-DEMO-INVALID-FINAL-001','Knitting','Embroidery','orders_final_stage_ck'
  );

  INSERT INTO public.orders
    (po_number,buyer_id,style_name,colour,total_quantity,completed_quantity,
     current_stage,ex_factory_date)
  VALUES
    ('STAGING-DEMO-NEW-001','10000000-0000-4000-8000-000000000001',
     'Demo Hoodie','Grey',50,0,'Knitting',current_date+45)
  RETURNING id INTO v_new_order;
  IF (SELECT final_production_stage FROM public.orders WHERE id=v_new_order) <> 'Finishing' THEN
    RAISE EXCEPTION 'New order did not default final_production_stage to Finishing.';
  END IF;
  PERFORM public.configure_order_final_stage(v_new_order,'Stitching');
  IF (SELECT final_production_stage FROM public.orders WHERE id=v_new_order) <> 'Stitching' THEN
    RAISE EXCEPTION 'Final-stage configuration before finished production did not succeed.';
  END IF;

  INSERT INTO public.tna_milestones(order_id,milestone_name,planned_date,status)
  VALUES(v_new_order,'Fit Sample Approval',current_date+3,'Not started');
  UPDATE public.tna_milestones SET status='In progress'
  WHERE order_id=v_new_order AND milestone_name='Fit Sample Approval';
  DELETE FROM public.tna_milestones
  WHERE order_id=v_new_order AND milestone_name='Fit Sample Approval';

  v_denied := false;
  BEGIN
    UPDATE public.orders SET completed_quantity=1 WHERE id=v_new_order;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Authenticated user directly changed finished quantity.'; END IF;
END;
$merchandiser_access$;

-- An order with no supervisor is invisible to a supervisor and cannot receive
-- that supervisor's update. Merchandisers can assign an actual supervisor and
-- cannot assign a buyer account.
RESET ROLE;
SELECT id AS unassigned_order_id
FROM public.orders WHERE po_number='STAGING-DEMO-NEW-001' \gset
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $unassigned_order$
BEGIN
  IF (SELECT count(*) FROM public.orders WHERE po_number='STAGING-DEMO-NEW-001') <> 0 THEN
    RAISE EXCEPTION 'Supervisor can read an unassigned order.';
  END IF;
END;
$unassigned_order$;
SELECT test_harness.expect_update_rejected(
  :'unassigned_order_id'::uuid, 'Cutting', 1, NULL, current_date, 'P0002'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
UPDATE public.orders
SET assigned_supervisor_id='22222222-2222-4222-8222-222222222222'
WHERE po_number='STAGING-DEMO-NEW-001';
DO $invalid_supervisor_assignment$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    UPDATE public.orders
    SET assigned_supervisor_id='44444444-4444-4444-8444-444444444444'
    WHERE po_number='STAGING-DEMO-NEW-001';
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'A buyer account was accepted as assigned supervisor.'; END IF;
END;
$invalid_supervisor_assignment$;

SELECT public.configure_order_final_stage(
  '20000000-0000-4000-8000-000000000002','Knitting'
);
DO $final_stage_changed$
BEGIN
  IF (SELECT final_production_stage FROM public.orders
      WHERE id='20000000-0000-4000-8000-000000000002') <> 'Knitting' THEN
    RAISE EXCEPTION 'Merchandiser could not configure final production stage.';
  END IF;
END;
$final_stage_changed$;
SELECT test_harness.expect_final_stage_rejected(
  '20000000-0000-4000-8000-000000000002','Embroidery','22023'
);

-- Only configured final-stage output advances finished quantity. Intermediate
-- output is still stored and updates current_stage.
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000001','Sewing',10,NULL,current_date
);
DO $intermediate_progress$
BEGIN
  IF (SELECT completed_quantity FROM public.orders
      WHERE id='20000000-0000-4000-8000-000000000001') <> 20 OR
     (SELECT current_stage FROM public.orders
      WHERE id='20000000-0000-4000-8000-000000000001') <> 'Sewing' THEN
    RAISE EXCEPTION 'Intermediate-stage output changed finished quantity or failed to update current stage.';
  END IF;
END;
$intermediate_progress$;
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000001',' fInIsHiNg ',5,NULL,current_date
);
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000002','Knitting',3,
  'integration merch attribution assertion',current_date
);
DO $final_progress$
BEGIN
  IF (SELECT completed_quantity FROM public.orders
      WHERE id='20000000-0000-4000-8000-000000000001') <> 25 OR
     (SELECT completed_quantity FROM public.orders
      WHERE id='20000000-0000-4000-8000-000000000002') <> 3 THEN
    RAISE EXCEPTION 'Final-stage updates did not increment completed quantity correctly.';
  END IF;
  IF (SELECT count(*) FROM public.production_updates
      WHERE order_id='20000000-0000-4000-8000-000000000002'
        AND issue_note='integration merch attribution assertion') <> 1 OR
     EXISTS (SELECT 1 FROM public.production_updates
      WHERE order_id='20000000-0000-4000-8000-000000000002'
        AND issue_note='integration merch attribution assertion'
        AND supervisor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Merchandiser update was incorrectly attributed to a supervisor.';
  END IF;
END;
$final_progress$;

DO $final_stage_reconciliation_guard$
DECLARE
  v_original_stage text;
  v_current_stage text;
  v_message text;
  v_rejected boolean := false;
BEGIN
  SELECT final_production_stage INTO v_original_stage
  FROM public.orders WHERE po_number='STAGING-DEMO-B-001';
  BEGIN
    PERFORM public.configure_order_final_stage(
      '20000000-0000-4000-8000-000000000001','Packing'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_rejected := true;
  END;
  IF NOT v_rejected OR
     v_message NOT LIKE '%Reconcile existing finished quantities separately%' THEN
    RAISE EXCEPTION 'Changing final stage after finished output was counted must return the reconciliation guidance.';
  END IF;
  SELECT final_production_stage INTO v_current_stage
  FROM public.orders WHERE po_number='STAGING-DEMO-B-001';
  IF v_current_stage IS DISTINCT FROM v_original_stage THEN
    RAISE EXCEPTION 'A rejected final-stage change modified the order.';
  END IF;
END;
$final_stage_reconciliation_guard$;

SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000001','Finishing',76,NULL,current_date,'22023'
);
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000001','   ',1,NULL,current_date,'22023'
);
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000001','Embroidery',1,NULL,current_date,'22023'
);
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000001','Finishing',2147483648,NULL,current_date,'22023'
);
SELECT test_harness.expect_update_rejected(
  '20000000-0000-4000-8000-000000000001','Finishing',1,repeat('x',2001),current_date,'22023'
);

DO $privilege_assertions$
BEGIN
  IF has_column_privilege('authenticated','public.orders','completed_quantity','UPDATE') OR
     has_column_privilege('authenticated','public.orders','current_stage','UPDATE') OR
     has_column_privilege('authenticated','public.orders','buyer_id','UPDATE') OR
     NOT has_column_privilege('authenticated','public.orders','assigned_supervisor_id','UPDATE') OR
     has_table_privilege('authenticated','public.profiles','INSERT') OR
     has_table_privilege('authenticated','public.profiles','UPDATE') OR
     has_table_privilege('authenticated','public.buyers','INSERT') OR
     has_table_privilege('authenticated','public.buyers','UPDATE') THEN
    RAISE EXCEPTION 'Core grants are broader/narrower than the intended application permissions.';
  END IF;
END;
$privilege_assertions$;

ROLLBACK;
