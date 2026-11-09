-- Disposable PostgreSQL-only Supabase-shaped fixture. Never use with production.
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS;

-- The container image's POSTGRES_USER (knittrack_bootstrap) remains the
-- bootstrap superuser. The proposal is applied as this separate, non-superuser
-- migration role, which intentionally uses the Supabase role name `postgres`.
CREATE ROLE postgres LOGIN PASSWORD 'knittrack-disposable-test-only'
  NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT NOBYPASSRLS;
GRANT authenticated TO postgres;
GRANT CREATE ON DATABASE postgres TO postgres;

CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA auth, extensions TO anon, authenticated, service_role;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  role text NOT NULL,
  buyer_id uuid
);
CREATE TABLE public.buyers (id uuid PRIMARY KEY);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  buyer_id uuid NOT NULL,
  total_quantity integer,
  completed_quantity integer DEFAULT 0,
  final_production_stage text,
  ex_factory_date date
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.current_user_buyer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT p.buyer_id FROM public.profiles p WHERE p.id = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION public.current_user_buyer_id() TO authenticated;

CREATE POLICY fixture_profiles_read_self ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY fixture_orders_read_by_buyer_or_merch ON public.orders
  FOR SELECT TO authenticated USING (
    buyer_id = public.current_user_buyer_id()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND lower(btrim(p.role)) = 'merchandiser'
    )
  );

GRANT SELECT ON public.profiles, public.orders TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;

-- Provision only the ownership and grant-option privileges required for the
-- proposal's existing non-superuser preflight and temporary writer grants.
ALTER SCHEMA public OWNER TO postgres;
GRANT USAGE ON SCHEMA auth, extensions TO postgres WITH GRANT OPTION;
GRANT EXECUTE ON FUNCTION auth.uid() TO postgres WITH GRANT OPTION;
GRANT EXECUTE ON FUNCTION extensions.hmac(bytea,bytea,text)
  TO postgres WITH GRANT OPTION;

INSERT INTO public.profiles(id, role, buyer_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'merchandiser', NULL),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'buyer', '11111111-1111-4111-8111-111111111111'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'buyer', '22222222-2222-4222-8222-222222222222'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'supervisor', NULL);

INSERT INTO public.orders(id, buyer_id, total_quantity, completed_quantity,
                          final_production_stage, ex_factory_date) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '11111111-1111-4111-8111-111111111111', 100, 0, 'Finishing',
   (now() AT TIME ZONE 'Asia/Kolkata')::date - 1),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff',
   '22222222-2222-4222-8222-222222222222', 100, 0, NULL,
   (now() AT TIME ZONE 'Asia/Kolkata')::date + 10),
  ('99999999-9999-4999-8999-999999999999',
   '22222222-2222-4222-8222-222222222222', NULL, NULL, NULL, NULL);

-- Match the verified production ownership assumptions without demoting the
-- bootstrap superuser. These fixture source objects are owned by the migration
-- role; the role is still NOSUPERUSER and does not have BYPASSRLS.
ALTER TABLE public.profiles OWNER TO postgres;
ALTER TABLE public.orders OWNER TO postgres;
ALTER FUNCTION public.current_user_buyer_id() OWNER TO postgres;
