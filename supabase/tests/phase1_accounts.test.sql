-- Database-level tests for Phase 1. Run with: npm run test:db
-- Every rule here is checked against the database itself, with no app in front.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- Start from an empty programme. Everything in this file is rolled back at the end.
delete from public.participant_invitations;
delete from auth.users;
delete from private.sign_in_attempts;

-- Pretend to be a signed-in user (or a visitor when uid is null).
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  end if;
end $$;
create function pg_temp.act_as_owner_of_db() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

\set boss  '''00000000-0000-0000-0000-000000000001'''
\set ann   '''00000000-0000-0000-0000-000000000002'''
\set bob   '''00000000-0000-0000-0000-000000000003'''

-- ---------- Structure ----------
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity), 0,
  'every public table has row level security switched on');
select ok(not has_function_privilege('anon', 'public.sign_in_begin(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.sign_in_begin(text)', 'execute'),
  'the username -> e-mail lookup cannot be called from a browser');
select ok(not has_function_privilege('authenticated', 'private.provision_admin(text, text)', 'execute'),
  'signed-in users cannot run provision_admin');
select ok(not has_table_privilege('anon', 'public.profiles', 'select'),
  'visitors have no access to profiles');

-- ---------- The first account and the single administrator ----------
insert into auth.users (id, email, email_confirmed_at) values (:boss, 'boss@example.com', now());
select is((select role::text from public.profiles where id = :boss), 'participant',
  'the first account starts as an ordinary account');

select throws_ok(
  $$insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'stranger@example.com')$$,
  '42501', null, 'an account without an invitation is rejected');

select lives_ok($$select private.provision_admin('boss@example.com', 'boss')$$,
  'the database owner can provision the administrator');
select is((select role::text || '/' || username::text || '/' || status::text from public.profiles where id = :boss),
  'admin/boss/active', 'the administrator has the role, a username and is active');
select throws_ok($$select private.provision_admin('boss@example.com', 'boss')$$,
  'P0001', 'an administrator already exists', 'provisioning cannot be run twice');

-- ---------- Invitations ----------
select pg_temp.act_as(:boss);
select lives_ok($$select public.create_invitation('Ann@Example.com', 'Ann Lee')$$, 'the admin can invite');
select lives_ok($$select public.create_invitation('bob@example.com', 'Bob Ray')$$, 'the admin can invite a second person');
select throws_ok($$select public.create_invitation('ann@example.com', 'Ann Again')$$,
  'P0001', 'already_invited', 'one open invitation per e-mail address');
select throws_ok($$select public.create_invitation('boss@example.com', 'Me')$$,
  'P0001', 'email_in_use', 'an e-mail already in the programme cannot be invited');

select pg_temp.act_as_owner_of_db();
insert into auth.users (id, email) values (:ann, 'ann@example.com'), (:bob, 'bob@example.com');
select is((select status::text || '/' || full_name from public.profiles where id = :ann), 'invited/Ann Lee',
  'an invited account gets a profile from its invitation');
select is((select position from public.stages s join public.profiles p on p.current_stage_id = s.id where p.id = :ann), 1,
  'an invited person starts in the first stage by default');

-- ---------- Accepting ----------
select pg_temp.act_as(:bob);
select throws_ok($$update public.profiles set full_name = 'Bobby' where id = '00000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'someone who has not accepted yet cannot edit their profile');
select throws_ok($$select public.accept_invitation('admin')$$, 'P0001', 'username_taken', 'reserved usernames are refused');
select throws_ok($$select public.accept_invitation('B')$$, 'P0001', 'username_invalid', 'a malformed username is refused');

select pg_temp.act_as(:ann);
select lives_ok($$select public.accept_invitation('Ann.Lee')$$, 'an invited person can accept');
select is((select username::text || '/' || status::text from public.profiles where id = :ann), 'ann.lee/active',
  'accepting stores a lower-case username and activates the profile');
select throws_ok($$select public.accept_invitation('ann2')$$, 'P0001', 'invitation_not_valid', 'an invitation can be accepted only once');

select pg_temp.act_as(:bob);
select throws_ok($$select public.accept_invitation('ann.lee')$$, 'P0001', 'username_taken', 'usernames are unique');

-- ---------- What a participant can see and change ----------
select pg_temp.act_as(:ann);
select is((select count(*)::int from public.profiles), 1, 'a participant can read exactly one profile: their own');
select is((select count(*)::int from public.participant_invitations), 0, 'a participant can read no invitations');
select lives_ok($$update public.profiles set full_name = 'Ann L.', business_idea = 'Bakery', current_goals = 'Open by May'
                  where id = '00000000-0000-0000-0000-000000000002'$$,
  'a participant can edit their name, idea and goals');
select throws_ok($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'a participant cannot change their role');
select throws_ok($$update public.profiles set status = 'completed' where id = '00000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'a participant cannot change their status');
select throws_ok($$select public.create_invitation('pal@example.com', 'Pal')$$,
  '42501', null, 'a participant cannot invite');
select throws_ok($$select public.revoke_invitation('00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'a participant cannot revoke invitations');

select throws_ok($$select public.reset_link_target('00000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a participant cannot ask for a password link');

select pg_temp.act_as(:boss);
select is(public.reset_link_target(:ann), 'ann@example.com', 'the admin can get a password link target for a joined participant');
select throws_ok($$select public.reset_link_target('00000000-0000-0000-0000-000000000003')$$,
  'P0001', 'person_not_found', 'no password link for someone who has not joined yet');
select throws_ok($$select public.reset_link_target('00000000-0000-0000-0000-000000000001')$$,
  'P0001', 'person_not_found', 'no password link for the administrator account');

select pg_temp.act_as(null);
select throws_ok($$select count(*) from public.profiles$$, '42501', null, 'a visitor cannot read profiles');

-- ---------- The admin role cannot be handed out ----------
select pg_temp.act_as(:boss);
select throws_ok($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'the admin cannot grant the admin role through the API');
select pg_temp.act_as_owner_of_db();
select throws_ok($$update public.profiles set role = 'admin', current_stage_id = null where id = '00000000-0000-0000-0000-000000000002'$$,
  '23505', null, 'a second administrator is impossible even for the database owner');

-- ---------- Sign-in throttling ----------
select is(public.sign_in_begin('bob'), null, 'someone who has not accepted cannot be looked up for sign-in');
select public.sign_in_finish('ann.lee', false) from generate_series(1, 5);
select throws_ok($$select public.sign_in_begin('ann.lee')$$, 'P0001', 'too_many_attempts',
  'five failed attempts lock the username');

select * from finish();
rollback;
