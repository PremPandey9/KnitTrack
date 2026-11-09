\set ON_ERROR_STOP on

-- Test-only signing key, never use this value outside the disposable container.
INSERT INTO private.delay_alert_signing_keys(key_id, key_material, is_active)
VALUES ('v1', decode(repeat('a5', 32), 'hex'), true);

CREATE SCHEMA test_harness;
GRANT USAGE ON SCHEMA test_harness TO authenticated;
CREATE TABLE test_harness.concurrent_alert(id uuid PRIMARY KEY);
CREATE TABLE test_harness.stale_snapshot(snapshot jsonb NOT NULL);
CREATE FUNCTION test_harness.expect_rpc_error(
  p_key_id text, p_payload text, p_signature text, p_expected text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM public.record_delay_candidate(p_key_id, p_payload, p_signature);
    RAISE EXCEPTION 'test_harness: expected RPC error but call succeeded';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message = 'test_harness: expected RPC error but call succeeded' THEN
      RAISE;
    END IF;
    IF position(p_expected IN v_message) = 0 THEN
      RAISE EXCEPTION 'Unexpected RPC error: % (expected text: %)', v_message, p_expected;
    END IF;
  END;
END;
$$;

-- This test-only invoker trigger runs during the real RPC's request-ledger
-- INSERT. It proves that SECURITY DEFINER switched current_user to the writer,
-- while the writer retains INSERT-only access under forced RLS.
CREATE FUNCTION test_harness.assert_request_writer_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_user <> 'delay_alert_writer' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Request-ledger INSERT did not execute in the expected SECURITY DEFINER context (session_user %, current_user %).',
      session_user, current_user;
  END IF;
  IF NOT has_table_privilege(current_user, TG_RELID, 'INSERT') OR
     has_table_privilege(current_user, TG_RELID, 'SELECT') OR
     NOT has_schema_privilege(current_user, TG_TABLE_SCHEMA, 'USAGE') THEN
    RAISE EXCEPTION 'Writer request-ledger privileges are not INSERT-only with schema USAGE.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_policy p ON p.polrelid = c.oid
    WHERE c.oid = TG_RELID
      AND c.relrowsecurity
      AND c.relforcerowsecurity
      AND p.polcmd = 'a'
      AND 'delay_alert_writer'::regrole::oid = ANY(p.polroles)
      AND position('auth.uid' IN pg_get_expr(p.polwithcheck, p.polrelid)) > 0
  ) THEN
    RAISE EXCEPTION 'Forced RLS or the writer actor-check INSERT policy is missing.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assert_request_writer_context_before_insert
  BEFORE INSERT ON private.delay_alert_requests
  FOR EACH ROW EXECUTE FUNCTION test_harness.assert_request_writer_context();
GRANT EXECUTE ON FUNCTION test_harness.expect_rpc_error(text,text,text,text) TO authenticated;

-- Build a current, valid Overdue payload from the fixture's actual order values.
SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS calculated_at,
       (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS local_today,
       ((now() AT TIME ZONE 'Asia/Kolkata')::date - 13)::text AS window_start,
       (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS window_end,
       o.ex_factory_date::text AS due_date
FROM public.orders o
WHERE o.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
\gset candidate_

SELECT concat_ws(E'\n',
  'knittrack-delay-v1',
  'key_id=v1',
  'request_id=10111111-1111-4111-8111-111111111111',
  'actor_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'order_id=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'buyer_id=11111111-1111-4111-8111-111111111111',
  'risk_level=Overdue',
  'calculated_at=' || :'candidate_calculated_at',
  'calculation_version=phase1-v1',
  'total_quantity=100',
  'completed_quantity=0',
  'remaining_quantity=100',
  'final_production_stage_b64url=RmluaXNoaW5n',
  'ex_factory_date=' || :'candidate_due_date',
  'observation_window_start=' || :'candidate_window_start',
  'observation_window_end=' || :'candidate_window_end',
  'history_date_count=0',
  'observed_daily_output=~',
  'required_daily_output=~',
  'pace_ratio=~',
  'days_remaining=0'
) AS candidate_payload
\gset

SELECT encode(extensions.hmac(convert_to(:'candidate_payload', 'UTF8'),
                              decode(repeat('a5', 32), 'hex'), 'sha256'), 'hex') AS candidate_signature
\gset

-- NULL signature, malformed signature, altered payload, and expired payload all
-- fail before any request, alert or event can commit.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT test_harness.expect_rpc_error('v1', :'candidate_payload', NULL, 'Signature is required');
SELECT test_harness.expect_rpc_error('v1', :'candidate_payload', 'xyz', 'lowercase hexadecimal');
SELECT test_harness.expect_rpc_error('v1', replace(:'candidate_payload', 'risk_level=Overdue', 'risk_level=Watch'),
                                    :'candidate_signature', 'signature verification failed');

SELECT replace(:'candidate_payload', 'calculated_at=' || :'candidate_calculated_at',
               'calculated_at=2000-01-01T00:00:00.000Z') AS expired_payload
\gset
SELECT encode(extensions.hmac(convert_to(:'expired_payload', 'UTF8'),
                              decode(repeat('a5', 32), 'hex'), 'sha256'), 'hex') AS expired_signature
\gset
SELECT test_harness.expect_rpc_error('v1', :'expired_payload', :'expired_signature', 'older than five minutes');

-- A correctly signed but internally inconsistent candidate is rejected, not
-- converted into Review Needed, and its request ID is not consumed.
SELECT replace(:'candidate_payload', 'remaining_quantity=100', 'remaining_quantity=99') AS inconsistent_payload
\gset
SELECT encode(extensions.hmac(convert_to(:'inconsistent_payload', 'UTF8'),
                              decode(repeat('a5', 32), 'hex'), 'sha256'), 'hex') AS inconsistent_signature
\gset
SELECT test_harness.expect_rpc_error('v1', :'inconsistent_payload', :'inconsistent_signature', 'Candidate snapshot');
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM private.delay_alert_requests) <> 0 OR
     (SELECT count(*) FROM public.delay_alerts) <> 0 OR
     (SELECT count(*) FROM public.delay_alert_events) <> 0 THEN
    RAISE EXCEPTION 'Rejected requests must not leave request, alert, or event rows';
  END IF;
END;
$$;

-- Buyer and supervisor sessions cannot record even correctly signed candidates.
SELECT replace(:'candidate_payload', 'actor_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
               'actor_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') AS buyer_payload
\gset
SELECT encode(extensions.hmac(convert_to(:'buyer_payload', 'UTF8'),
                              decode(repeat('a5', 32), 'hex'), 'sha256'), 'hex') AS buyer_signature
\gset
SET ROLE authenticated;
SET request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT test_harness.expect_rpc_error('v1', :'buyer_payload', :'buyer_signature', 'Only a merchandiser');
RESET ROLE;

SELECT replace(:'candidate_payload', 'actor_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
               'actor_id=dddddddd-dddd-4ddd-8ddd-dddddddddddd') AS supervisor_payload
\gset
SELECT encode(extensions.hmac(convert_to(:'supervisor_payload', 'UTF8'),
                              decode(repeat('a5', 32), 'hex'), 'sha256'), 'hex') AS supervisor_signature
\gset
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
SELECT test_harness.expect_rpc_error('v1', :'supervisor_payload', :'supervisor_signature', 'Only a merchandiser');
RESET ROLE;

-- Valid Overdue candidate is recorded exactly once; replay of its request ID is rejected.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT public.record_delay_candidate('v1', :'candidate_payload', :'candidate_signature') AS alert_id
\gset

-- Test-harness tables are owned by the migration connection, not exposed to
-- authenticated. Keep fixture writes under that owner role.
RESET ROLE;
DO $$
BEGIN
  IF current_user <> 'postgres' OR
     NOT has_table_privilege(current_user, 'test_harness.concurrent_alert', 'INSERT') OR
     NOT has_table_privilege(current_user, 'test_harness.stale_snapshot', 'INSERT') THEN
    RAISE EXCEPTION 'Harness fixture inserts must run as postgres with INSERT privileges.';
  END IF;
END;
$$;
INSERT INTO test_harness.concurrent_alert(id) VALUES (:'alert_id');
INSERT INTO test_harness.stale_snapshot(snapshot)
SELECT to_jsonb(a) FROM public.delay_alerts a WHERE a.id=:'alert_id';

-- Replay remains an authenticated RPC call using the same merchandiser claim.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT test_harness.expect_rpc_error('v1', :'candidate_payload', :'candidate_signature', 'already been used');
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM private.delay_alert_requests) <> 1 OR
     (SELECT count(*) FROM public.delay_alerts WHERE approval_status='pending') <> 1 OR
     (SELECT count(*) FROM public.delay_alert_events WHERE event_type='created') <> 1 THEN
    RAISE EXCEPTION 'A valid candidate must create one request, one pending alert and one audit event';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    DELETE FROM public.orders WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    RAISE EXCEPTION 'Expected ON DELETE RESTRICT to retain an order with request history';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') THEN
    RAISE EXCEPTION 'An order with replay-protection history must remain present';
  END IF;
END;
$$;

-- Review Needed with nullable-stage/rate sentinels is logged but never becomes
-- buyer-visible. Here the actual order has a NULL final stage to match context.
SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS calculated_at,
       (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS local_today,
       ((now() AT TIME ZONE 'Asia/Kolkata')::date - 13)::text AS window_start,
       (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS window_end,
       o.ex_factory_date::text AS due_date
FROM public.orders o
WHERE o.id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
\gset review_
SELECT concat_ws(E'\n',
  'knittrack-delay-v1', 'key_id=v1',
  'request_id=20222222-2222-4222-8222-222222222222',
  'actor_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'order_id=ffffffff-ffff-4fff-8fff-ffffffffffff',
  'buyer_id=22222222-2222-4222-8222-222222222222',
  'risk_level=Review Needed',
  'calculated_at=' || :'review_calculated_at',
  'calculation_version=phase1-v1',
  'total_quantity=100', 'completed_quantity=0', 'remaining_quantity=100',
  'final_production_stage_b64url=~',
  'ex_factory_date=' || :'review_due_date',
  'observation_window_start=' || :'review_window_start',
  'observation_window_end=' || :'review_window_end',
  'history_date_count=0', 'observed_daily_output=~',
  'required_daily_output=~', 'pace_ratio=~', 'days_remaining=11'
) AS review_payload
\gset
SELECT encode(extensions.hmac(convert_to(:'review_payload', 'UTF8'),
                              decode(repeat('a5', 32), 'hex'), 'sha256'), 'hex') AS review_signature
\gset
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT public.record_delay_candidate('v1', :'review_payload', :'review_signature');
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.delay_alert_requests
    WHERE request_id='20222222-2222-4222-8222-222222222222'
      AND calculation_status='Review Needed'
      AND final_production_stage IS NULL
      AND observed_daily_output IS NULL
      AND required_daily_output IS NULL
      AND pace_ratio IS NULL
  ) THEN
    RAISE EXCEPTION 'Review Needed sentinels must persist as SQL NULLs';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.delay_alerts
    WHERE order_id='ffffffff-ffff-4fff-8fff-ffffffffffff'
  ) THEN
    RAISE EXCEPTION 'Review Needed must not create a buyer-visible alert';
  END IF;
END;
$$;

-- Exercise every NULL sentinel branch with source order fields that are actually
-- NULL. This is a Review Needed calculation only and creates no buyer alert.
SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS calculated_at
\gset nulls_
SELECT concat_ws(E'\n',
  'knittrack-delay-v1', 'key_id=v1',
  'request_id=40444444-4444-4444-8444-444444444444',
  'actor_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'order_id=99999999-9999-4999-8999-999999999999',
  'buyer_id=22222222-2222-4222-8222-222222222222',
  'risk_level=Review Needed',
  'calculated_at=' || :'nulls_calculated_at',
  'calculation_version=phase1-v1',
  'total_quantity=~', 'completed_quantity=~', 'remaining_quantity=~',
  'final_production_stage_b64url=~', 'ex_factory_date=~',
  'observation_window_start=~', 'observation_window_end=~',
  'history_date_count=0', 'observed_daily_output=~',
  'required_daily_output=~', 'pace_ratio=~', 'days_remaining=~'
) AS nulls_payload
\gset
SELECT encode(extensions.hmac(convert_to(:'nulls_payload', 'UTF8'),
                              decode(repeat('a5', 32), 'hex'), 'sha256'), 'hex') AS nulls_signature
\gset
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT public.record_delay_candidate('v1', :'nulls_payload', :'nulls_signature');
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.delay_alert_requests
    WHERE request_id='40444444-4444-4444-8444-444444444444'
      AND calculation_status='Review Needed'
      AND total_quantity IS NULL AND completed_quantity IS NULL
      AND remaining_quantity IS NULL AND final_production_stage IS NULL
      AND ex_factory_date IS NULL AND observation_window_start IS NULL
      AND observation_window_end IS NULL AND observed_daily_output IS NULL
      AND required_daily_output IS NULL AND pace_ratio IS NULL
      AND days_remaining IS NULL
  ) THEN
    RAISE EXCEPTION 'All nullable sentinels must parse to database NULL without invented values';
  END IF;
  IF EXISTS (SELECT 1 FROM public.delay_alerts
             WHERE order_id='99999999-9999-4999-8999-999999999999') THEN
    RAISE EXCEPTION 'NULL-sentinel Review Needed must not create an alert';
  END IF;
END;
$$;

-- Change a material order input and record a second signed calculation. The
-- pending row is refreshed in place and its calculation_changed event is logged.
UPDATE public.orders
SET total_quantity=101
WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS calculated_at,
       (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS local_today,
       ((now() AT TIME ZONE 'Asia/Kolkata')::date - 13)::text AS window_start,
       (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS window_end,
       o.ex_factory_date::text AS due_date,
       o.total_quantity::text AS total_quantity,
       o.completed_quantity::text AS completed_quantity
FROM public.orders o
WHERE o.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
\gset changed_
SELECT concat_ws(E'\n',
  'knittrack-delay-v1', 'key_id=v1',
  'request_id=50555555-5555-4555-8555-555555555555',
  'actor_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'order_id=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'buyer_id=11111111-1111-4111-8111-111111111111',
  'risk_level=Overdue',
  'calculated_at=' || :'changed_calculated_at',
  'calculation_version=phase1-v1',
  'total_quantity=' || :'changed_total_quantity',
  'completed_quantity=' || :'changed_completed_quantity',
  'remaining_quantity=101',
  'final_production_stage_b64url=RmluaXNoaW5n',
  'ex_factory_date=' || :'changed_due_date',
  'observation_window_start=' || :'changed_window_start',
  'observation_window_end=' || :'changed_window_end',
  'history_date_count=0', 'observed_daily_output=~',
  'required_daily_output=~', 'pace_ratio=~', 'days_remaining=0'
) AS changed_payload
\gset
SELECT encode(extensions.hmac(convert_to(:'changed_payload', 'UTF8'),
                              decode(repeat('a5', 32), 'hex'), 'sha256'), 'hex') AS changed_signature
\gset
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT public.record_delay_candidate('v1', :'changed_payload', :'changed_signature');
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.delay_alerts
      WHERE order_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
        AND approval_status='pending' AND total_quantity=101) <> 1 OR
     (SELECT count(*) FROM public.delay_alert_events
      WHERE alert_id=(SELECT id FROM test_harness.concurrent_alert LIMIT 1)
        AND event_type='calculation_changed') <> 1 THEN
    RAISE EXCEPTION 'A materially changed pending snapshot must refresh and append history';
  END IF;
END;
$$;

-- concurrent-approval.mjs first submits stale predicates from the stored 100-unit
-- snapshot (expecting zero rows), then races two sessions using the current one.
