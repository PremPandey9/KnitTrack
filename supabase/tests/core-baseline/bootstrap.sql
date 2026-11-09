-- Disposable PostgreSQL 17 Supabase-shaped base fixture only.
-- The container bootstrap user remains superuser; baseline migrations run as
-- the separate non-superuser role named postgres.

CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS;

CREATE ROLE postgres LOGIN PASSWORD 'knittrack-core-disposable-only'
  NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT NOBYPASSRLS;
GRANT authenticated TO postgres;
GRANT CREATE ON DATABASE postgres TO postgres;

CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, REFERENCES ON TABLE auth.users TO postgres;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO postgres WITH GRANT OPTION;

GRANT USAGE ON SCHEMA auth, extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth, extensions TO postgres WITH GRANT OPTION;
GRANT EXECUTE ON FUNCTION extensions.hmac(bytea, bytea, text)
  TO postgres WITH GRANT OPTION;

ALTER SCHEMA public OWNER TO postgres;
