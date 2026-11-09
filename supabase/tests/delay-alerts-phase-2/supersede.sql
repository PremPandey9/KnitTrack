\set ON_ERROR_STOP on

SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS calculated_at,
       (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS local_today,
       ((now() AT TIME ZONE 'Asia/Kolkata')::date - 13)::text AS window_start,
       (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS window_end,
       o.ex_factory_date::text AS due_date,
       o.total_quantity::text AS total_quantity,
       o.completed_quantity::text AS completed_quantity,
       greatest(0, o.total_quantity - o.completed_quantity)::text AS remaining_quantity,
       greatest(0, o.ex_factory_date - (now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::text AS days_remaining
FROM public.orders o
WHERE o.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
\gset refresh_

SELECT concat_ws(E'\n',
  'knittrack-delay-v1', 'key_id=v1',
  'request_id=30333333-3333-4333-8333-333333333333',
  'actor_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'order_id=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'buyer_id=11111111-1111-4111-8111-111111111111',
  'risk_level=Review Needed',
  'calculated_at=' || :'refresh_calculated_at',
  'calculation_version=phase1-v1',
  'total_quantity=' || :'refresh_total_quantity',
  'completed_quantity=' || :'refresh_completed_quantity',
  'remaining_quantity=' || :'refresh_remaining_quantity',
  'final_production_stage_b64url=RmluaXNoaW5n',
  'ex_factory_date=' || :'refresh_due_date',
  'observation_window_start=' || :'refresh_window_start',
  'observation_window_end=' || :'refresh_window_end',
  'history_date_count=0', 'observed_daily_output=~',
  'required_daily_output=~', 'pace_ratio=~',
  'days_remaining=' || :'refresh_days_remaining'
) AS refresh_payload
\gset
SELECT encode(extensions.hmac(convert_to(:'refresh_payload', 'UTF8'),
                              decode(repeat('a5', 32), 'hex'), 'sha256'), 'hex') AS refresh_signature
\gset

SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT public.record_delay_candidate('v1', :'refresh_payload', :'refresh_signature');
RESET ROLE;

DO $$
BEGIN
  IF (SELECT approval_status FROM public.delay_alerts
      WHERE order_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') <> 'superseded' THEN
    RAISE EXCEPTION 'Non-candidate Review Needed must supersede the stale alert';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.delay_alert_events
    WHERE alert_id=(SELECT id FROM public.delay_alerts
                    WHERE order_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
      AND event_type='superseded'
  ) THEN
    RAISE EXCEPTION 'Superseding must append an audit event';
  END IF;
END;
$$;

SET ROLE authenticated;
SET request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.delay_alerts) <> 0 OR
     (SELECT count(*) FROM public.delay_alert_events) <> 0 THEN
    RAISE EXCEPTION 'Buyer must not see superseded alerts or their events';
  END IF;
END;
$$;
RESET ROLE;
