-- Synthetic KnitTrack staging demo data only. Never run against production.
-- This is a psql script because it resolves Auth user IDs by synthetic email.
-- First create these five users in the STAGING Supabase Auth admin UI. Do not
-- put their passwords in this file or commit credentials.
\set ON_ERROR_STOP on

BEGIN;

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM auth.users WHERE email IN (
        'qa-merchandiser@knittrack.example',
        'qa-supervisor@knittrack.example',
        'qa-supervisor-other@knittrack.example',
        'qa-buyer-b@knittrack.example',
        'qa-buyer-c@knittrack.example'
      )) <> 5 THEN
    RAISE EXCEPTION 'Create the five documented synthetic QA users in staging Auth before running this seed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.buyers
    WHERE id IN ('10000000-0000-4000-8000-000000000001',
                 '10000000-0000-4000-8000-000000000002')
  ) OR EXISTS (
    SELECT 1 FROM public.profiles AS p
    JOIN auth.users AS u ON u.id = p.id
    WHERE u.email IN (
      'qa-merchandiser@knittrack.example',
      'qa-supervisor@knittrack.example',
      'qa-supervisor-other@knittrack.example',
      'qa-buyer-b@knittrack.example',
      'qa-buyer-c@knittrack.example'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.orders
    WHERE id IN ('20000000-0000-4000-8000-000000000001',
                 '20000000-0000-4000-8000-000000000002')
       OR po_number IN ('STAGING-DEMO-B-001', 'STAGING-DEMO-C-001')
  ) OR EXISTS (
    SELECT 1 FROM public.tna_milestones
    WHERE id IN ('40000000-0000-4000-8000-000000000001',
                 '40000000-0000-4000-8000-000000000002')
  ) THEN
    RAISE EXCEPTION 'Synthetic staging seed IDs or PO numbers already exist; inspect before reseeding.';
  END IF;
  IF NOT pg_has_role(current_user, 'authenticated', 'MEMBER') THEN
    RAISE EXCEPTION 'The staging seed runner must be able to SET ROLE authenticated for RPC-created update history.';
  END IF;
END;
$preflight$;

SELECT id AS qa_merchandiser_id
FROM auth.users WHERE email = 'qa-merchandiser@knittrack.example' \gset
SELECT id AS qa_supervisor_id
FROM auth.users WHERE email = 'qa-supervisor@knittrack.example' \gset
SELECT id AS qa_supervisor_other_id
FROM auth.users WHERE email = 'qa-supervisor-other@knittrack.example' \gset
SELECT id AS qa_buyer_b_id
FROM auth.users WHERE email = 'qa-buyer-b@knittrack.example' \gset
SELECT id AS qa_buyer_c_id
FROM auth.users WHERE email = 'qa-buyer-c@knittrack.example' \gset

INSERT INTO public.buyers (id, company_name, country, contact_email) VALUES
  ('10000000-0000-4000-8000-000000000001', 'KnitTrack Staging Buyer B', 'TEST', 'buyer-b@knittrack.example'),
  ('10000000-0000-4000-8000-000000000002', 'KnitTrack Staging Buyer C', 'TEST', 'buyer-c@knittrack.example');

INSERT INTO public.profiles (id, full_name, role, buyer_id) VALUES
  (:'qa_merchandiser_id'::uuid, 'QA Merchandiser', 'merchandiser', NULL),
  (:'qa_supervisor_id'::uuid, 'QA Supervisor', 'supervisor', NULL),
  (:'qa_supervisor_other_id'::uuid, 'QA Supervisor Other', 'supervisor', NULL),
  (:'qa_buyer_b_id'::uuid, 'QA Buyer B', 'buyer', '10000000-0000-4000-8000-000000000001'),
  (:'qa_buyer_c_id'::uuid, 'QA Buyer C', 'buyer', '10000000-0000-4000-8000-000000000002');

INSERT INTO public.orders (
  id, po_number, buyer_id, style_name, colour, total_quantity,
  completed_quantity, current_stage, ex_factory_date,
  assigned_supervisor_id, final_production_stage
) VALUES
  ('20000000-0000-4000-8000-000000000001', 'STAGING-DEMO-B-001',
   '10000000-0000-4000-8000-000000000001', 'Demo Crew Neck', 'Navy',
   100, 0, 'Cutting', (now() AT TIME ZONE 'Asia/Kolkata')::date + 30,
   :'qa_supervisor_id'::uuid, 'Finishing'),
  ('20000000-0000-4000-8000-000000000002', 'STAGING-DEMO-C-001',
   '10000000-0000-4000-8000-000000000002', 'Demo Cardigan', 'Forest',
   80, 0, 'Knitting', (now() AT TIME ZONE 'Asia/Kolkata')::date + 35,
   :'qa_supervisor_other_id'::uuid, 'Packing');

INSERT INTO public.tna_milestones (
  id, order_id, milestone_name, planned_date, actual_date, status
) VALUES
  ('40000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', 'Lab Dip Approval', (now() AT TIME ZONE 'Asia/Kolkata')::date + 2, NULL, 'Not started'),
  ('40000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'Pre-production Sample', (now() AT TIME ZONE 'Asia/Kolkata')::date + 4, NULL, 'In progress');

-- Submit all synthetic updates through the same authenticated RPC used by the
-- app. The INSERT trigger attributes supervisor updates and only final-stage
-- quantities increase finished-goods completed_quantity.
SELECT set_config('request.jwt.claim.sub', :'qa_merchandiser_id', true);
SET LOCAL ROLE authenticated;
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000001', 'Cutting', 30, 'Synthetic intermediate-stage history', (now() AT TIME ZONE 'Asia/Kolkata')::date - 14
);
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000001', 'Finishing', 4, 'Synthetic staging demo', (now() AT TIME ZONE 'Asia/Kolkata')::date - 13
);
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000001', 'Finishing', 4, NULL, (now() AT TIME ZONE 'Asia/Kolkata')::date - 11
);
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000001', 'Finishing', 4, NULL, (now() AT TIME ZONE 'Asia/Kolkata')::date - 9
);
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000001', 'Finishing', 4, NULL, (now() AT TIME ZONE 'Asia/Kolkata')::date - 7
);
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000001', 'Finishing', 4, NULL, (now() AT TIME ZONE 'Asia/Kolkata')::date - 6
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', :'qa_supervisor_id', true);
SET LOCAL ROLE authenticated;
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000001', 'Packing', 12, 'Synthetic supervisor update', (now() AT TIME ZONE 'Asia/Kolkata')::date
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', :'qa_supervisor_other_id', true);
SET LOCAL ROLE authenticated;
SELECT public.submit_production_update(
  '20000000-0000-4000-8000-000000000002', 'Knitting', 7, 'Synthetic second-buyer update', (now() AT TIME ZONE 'Asia/Kolkata')::date
);
RESET ROLE;

COMMIT;
