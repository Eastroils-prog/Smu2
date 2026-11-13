-- Structural guarantees: RLS everywhere, nothing for anonymous users, and the
-- column-level privileges that keep `role` and friends out of reach of the API.
begin;
\ir _helpers.sql.inc
select plan(24);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint,
  'every table in public has row level security enabled');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
     and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate')
          or has_any_column_privilege('anon', c.oid, 'select, insert, update'))),
  0::bigint,
  'the anonymous role has no privilege on any table or column in public');

select ok(not has_function_privilege('anon', 'public.accept_invitation()', 'execute'),
  'anon cannot execute accept_invitation()');
select ok(not has_function_privilege('anon', 'public.touch_last_active()', 'execute'),
  'anon cannot execute touch_last_active()');
select ok(has_function_privilege('authenticated', 'public.accept_invitation()', 'execute'),
  'signed-in users can execute accept_invitation()');

select ok(not has_function_privilege('authenticated', 'private.provision_admin(text)', 'execute'),
  'signed-in users cannot execute provision_admin()');
select ok(not has_function_privilege('service_role', 'private.provision_admin(text)', 'execute'),
  'the service role cannot execute provision_admin()');
select ok(not has_function_privilege('anon', 'private.provision_admin(text)', 'execute'),
  'anon cannot execute provision_admin()');
select ok(not has_schema_privilege('anon', 'private', 'usage'),
  'anon has no access to the private schema');

-- profiles: what the API may touch at all
select ok(not has_table_privilege('authenticated', 'public.profiles', 'insert'),  'profiles: no INSERT through the API');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'delete'),  'profiles: no DELETE through the API');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'role', 'update'),           'profiles.role is not API-writable');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'id', 'update'),             'profiles.id is not API-writable');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'email', 'update'),          'profiles.email is not API-writable');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'joined_at', 'update'),      'profiles.joined_at is not API-writable');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'last_active_at', 'update'), 'profiles.last_active_at is not API-writable');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'update'),     'profiles.created_at is not API-writable');
select ok(has_column_privilege('authenticated', 'public.profiles', 'full_name', 'update'),          'profiles.full_name is API-writable');

-- invitations: read-only through the API (writes go through the Edge Function)
select ok(not has_table_privilege('authenticated', 'public.participant_invitations', 'insert'), 'invitations: no INSERT through the API');
select ok(not has_table_privilege('authenticated', 'public.participant_invitations', 'update'), 'invitations: no UPDATE through the API');
select ok(not has_table_privilege('authenticated', 'public.participant_invitations', 'delete'), 'invitations: no DELETE through the API');

-- settings: singleton that cannot be inserted into, deleted or re-keyed
select ok(not has_table_privilege('authenticated', 'public.app_settings', 'insert'), 'settings: no INSERT through the API');
select ok(not has_table_privilege('authenticated', 'public.app_settings', 'delete'), 'settings: no DELETE through the API');
select ok(not has_column_privilege('authenticated', 'public.app_settings', 'id', 'update'), 'settings.id is not API-writable');

select * from finish();
rollback;
