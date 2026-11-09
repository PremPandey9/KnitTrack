-- KnitTrack core schema baseline for a NEW Supabase project.
-- Apply only after review, using the staging project's migration role.
-- This file intentionally does not create the Supabase Auth schema or users.

BEGIN;

-- Phase 2 expects pgcrypto's HMAC function in the extensions schema. If the
-- extension already exists in a different schema, this migration stops rather
-- than moving or altering an existing extension installation implicitly.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $preflight$
BEGIN
  IF to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'Install pgcrypto so extensions.hmac(bytea,bytea,text) is available before proceeding.';
  END IF;
  IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'This migration requires the Supabase-managed auth.users table and auth.uid() function.';
  END IF;
END;
$preflight$;

CREATE TABLE public.buyers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL CHECK (btrim(company_name) <> ''),
  country text,
  contact_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  role text NOT NULL CHECK (role IN ('merchandiser', 'supervisor', 'buyer')),
  buyer_id uuid REFERENCES public.buyers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_buyer_role_link_ck CHECK (
    (role = 'buyer' AND buyer_id IS NOT NULL) OR
    (role IN ('merchandiser', 'supervisor') AND buyer_id IS NULL)
  )
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL CHECK (btrim(po_number) <> ''),
  buyer_id uuid NOT NULL REFERENCES public.buyers(id) ON DELETE RESTRICT,
  style_name text NOT NULL CHECK (btrim(style_name) <> ''),
  colour text NOT NULL CHECK (btrim(colour) <> ''),
  total_quantity integer NOT NULL CHECK (total_quantity > 0),
  completed_quantity integer NOT NULL DEFAULT 0,
  current_stage text NOT NULL,
  ex_factory_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  assigned_supervisor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  final_production_stage text DEFAULT 'Finishing',
  CONSTRAINT orders_po_number_uq UNIQUE (po_number),
  CONSTRAINT orders_completed_quantity_ck CHECK (
    completed_quantity >= 0 AND completed_quantity <= total_quantity
  ),
  CONSTRAINT orders_current_stage_ck CHECK (
    lower(btrim(current_stage)) IN (
      'cutting', 'knitting', 'dyeing', 'sewing', 'stitching', 'printing',
      'finishing', 'quality check', 'packing'
    )
  ),
  CONSTRAINT orders_final_stage_ck CHECK (
    final_production_stage IS NULL OR lower(btrim(final_production_stage)) IN (
      'cutting', 'knitting', 'dyeing', 'sewing', 'stitching', 'printing',
      'finishing', 'quality check', 'packing'
    )
  )
);

CREATE TABLE public.production_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (btrim(stage) <> ''),
  quantity_completed integer NOT NULL CHECK (quantity_completed > 0),
  issue_note text,
  photo_url text,
  update_date date NOT NULL,
  supervisor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_updates_issue_note_length_ck CHECK (
    issue_note IS NULL OR char_length(issue_note) <= 2000
  )
);

CREATE TABLE public.tna_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  milestone_name text NOT NULL CHECK (btrim(milestone_name) <> ''),
  planned_date date NOT NULL,
  actual_date date,
  status text NOT NULL DEFAULT 'Not started' CHECK (btrim(status) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The app frequently scopes orders and histories by these foreign keys/dates.
-- The primary key and unique PO index are created by their table constraints.
CREATE INDEX profiles_role_full_name_idx ON public.profiles(role, full_name);
CREATE INDEX profiles_buyer_id_idx ON public.profiles(buyer_id) WHERE buyer_id IS NOT NULL;
CREATE INDEX orders_buyer_created_idx ON public.orders(buyer_id, created_at DESC);
CREATE INDEX orders_supervisor_created_idx ON public.orders(assigned_supervisor_id, created_at DESC)
  WHERE assigned_supervisor_id IS NOT NULL;
CREATE INDEX orders_ex_factory_date_idx ON public.orders(ex_factory_date);
CREATE INDEX production_updates_order_date_idx
  ON public.production_updates(order_id, update_date DESC, created_at DESC);
CREATE INDEX production_updates_supervisor_idx
  ON public.production_updates(supervisor_id, update_date DESC)
  WHERE supervisor_id IS NOT NULL;
CREATE INDEX tna_milestones_order_planned_idx
  ON public.tna_milestones(order_id, planned_date);

-- Keep RLS enabled on the source tables. The Phase 2 proposal explicitly
-- requires orders/profiles not to use FORCE ROW LEVEL SECURITY because its
-- narrowly scoped postgres-owned helper reads them. Do not add FORCE here.
ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tna_milestones ENABLE ROW LEVEL SECURITY;

COMMIT;
