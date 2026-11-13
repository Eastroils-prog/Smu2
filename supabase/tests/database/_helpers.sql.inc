-- Shared test helpers. Each test file inlines this block (pg_prove runs every
-- file in its own session and everything is rolled back at the end).
create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Creates an auth user the way the auth server does (fires the profile trigger).
create or replace function tests.create_user(_email text, _confirmed boolean default true) returns uuid
language plpgsql as $$
declare
  _id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', _email,
          case when _confirmed then now() end, '{}', '{}', now(), now());
  return _id;
end $$;

create or replace function tests.uid(_email text) returns uuid
language sql security definer set search_path = '' as $$
  select id from auth.users where email = _email;
$$;

-- Act as a signed-in user, exactly as a request through the Data API would.
create or replace function tests.login_as(_email text) returns void
language plpgsql as $$
declare
  _id uuid;
begin
  execute 'reset role';
  _id := tests.uid(_email);
  if _id is null then
    raise exception 'tests.login_as: no such user %', _email;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', _id, 'role', 'authenticated', 'email', _email)::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function tests.login_anon() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;

create or replace function tests.login_service_role() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;

create or replace function tests.logout() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Empty installation: no accounts, no invitations.
create or replace function tests.clean_slate() returns void
language plpgsql as $$
begin
  delete from public.participant_invitations;
  delete from auth.users;
end $$;

-- The admin plus four participants in different states.
--   admin@t.test  admin
--   alice@t.test  active        bob@t.test    active
--   carol@t.test  archived      dana@t.test   invited (has not accepted yet)
create or replace function tests.seed_people() returns void
language plpgsql as $$
declare
  _admin uuid;
  _who   text;
begin
  perform tests.clean_slate();
  _admin := tests.create_user('admin@t.test');
  perform private.provision_admin('admin@t.test');
  update public.profiles set full_name = 'Admin Person' where id = _admin;

  foreach _who in array array['alice', 'bob', 'carol', 'dana'] loop
    insert into public.participant_invitations (email, full_name, invited_by)
    values (_who || '@t.test', initcap(_who) || ' Example', _admin);
    perform tests.create_user(_who || '@t.test');
  end loop;

  update public.profiles set status = 'active', joined_at = now()
  where email in ('alice@t.test', 'bob@t.test', 'carol@t.test');
  update public.participant_invitations set status = 'accepted', accepted_at = now()
  where email in ('alice@t.test', 'bob@t.test', 'carol@t.test');
  update public.profiles set archived_at = now() where email = 'carol@t.test';
end $$;
