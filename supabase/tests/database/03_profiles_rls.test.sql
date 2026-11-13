-- Who can read and change which profile, and which columns.
begin;
\ir _helpers.sql.inc
select plan(38);

select tests.seed_people();

-- ---------------------------------------------------------------------------
-- Anonymous
-- ---------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok($$ update public.profiles set full_name = 'x' $$, '42501', null, 'anon cannot update profiles');

-- ---------------------------------------------------------------------------
-- A participant reading
-- ---------------------------------------------------------------------------
select tests.login_as('alice@t.test');
select results_eq(
  $$ select email::text from public.profiles order by email $$,
  $$ values ('admin@t.test'), ('alice@t.test') $$,
  'a participant sees only their own profile and the admin''s');
select is_empty($$ select 1 from public.profiles where email = 'bob@t.test' $$,
  'a participant cannot see another participant');

-- ---------------------------------------------------------------------------
-- A participant editing their own profile
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.profiles
     set full_name = 'Alice Updated', business_idea = 'A bakery', current_goals = 'First ten customers',
         avatar_path = 'x/y.png'
     where id = auth.uid() $$,
  'a participant can edit name, avatar, business idea and goals');
select tests.logout();
select is((select full_name from public.profiles where email = 'alice@t.test'), 'Alice Updated', 'the name was saved');
select is((select business_idea from public.profiles where email = 'alice@t.test'), 'A bakery', 'the business idea was saved');
select ok((select updated_at = now() from public.profiles where email = 'alice@t.test'), 'updated_at is maintained');

select tests.login_as('alice@t.test');
select throws_ok($$ update public.profiles set role = 'admin' where id = auth.uid() $$,
  '42501', null, 'a participant cannot make themselves admin');
select throws_ok($$ update public.profiles set email = 'evil@t.test' where id = auth.uid() $$,
  '42501', null, 'a participant cannot change the profile e-mail');
select throws_ok($$ update public.profiles set joined_at = now() where id = auth.uid() $$,
  '42501', null, 'a participant cannot change the joined date');
select throws_ok($$ update public.profiles set last_active_at = now() where id = auth.uid() $$,
  '42501', null, 'a participant cannot forge last activity');
select throws_ok(
  $$ update public.profiles set current_stage_id = (select id from public.stages where position = 6) where id = auth.uid() $$,
  '42501', 'participants may only edit their name, avatar, business idea and goals',
  'a participant cannot change their own stage');
select throws_ok($$ update public.profiles set status = 'completed' where id = auth.uid() $$,
  '42501', 'participants may only edit their name, avatar, business idea and goals',
  'a participant cannot change their own status');
select throws_ok($$ update public.profiles set archived_at = now() where id = auth.uid() $$,
  '42501', 'participants may only edit their name, avatar, business idea and goals',
  'a participant cannot archive themselves');
select throws_ok($$ update public.profiles set full_name = '   ' where id = auth.uid() $$,
  '23514', null, 'a blank name is rejected');
select throws_ok(
  $$ insert into public.profiles (id, email, full_name) values (gen_random_uuid(), 'new@t.test', 'New') $$,
  '42501', null, 'a participant cannot insert profiles');
select throws_ok($$ delete from public.profiles where id = auth.uid() $$,
  '42501', null, 'a participant cannot delete profiles');

-- ---------------------------------------------------------------------------
-- A participant attacking someone else's profile
-- ---------------------------------------------------------------------------
update public.profiles set full_name = 'Hacked' where email = 'bob@t.test';
update public.profiles set full_name = 'Hacked' where email = 'admin@t.test';
select tests.logout();
select is((select full_name from public.profiles where email = 'bob@t.test'), 'Bob Example',
  'a participant cannot edit another participant');
select is((select full_name from public.profiles where email = 'admin@t.test'), 'Admin Person',
  'a participant cannot edit the admin');

-- ---------------------------------------------------------------------------
-- Read-only states
-- ---------------------------------------------------------------------------
select tests.login_as('carol@t.test');
select is((select count(*) from public.profiles where id = auth.uid()), 1::bigint,
  'an archived participant can still read their own profile');
update public.profiles set full_name = 'Carol Changed' where id = auth.uid();
select tests.logout();
select is((select full_name from public.profiles where email = 'carol@t.test'), 'Carol Example',
  'an archived participant cannot edit their profile');

select tests.login_as('dana@t.test');
update public.profiles set full_name = 'Dana Changed' where id = auth.uid();
select tests.logout();
select is((select full_name from public.profiles where email = 'dana@t.test'), 'Dana Example',
  'a participant who has not accepted the invitation cannot edit their profile');

-- ---------------------------------------------------------------------------
-- The administrator
-- ---------------------------------------------------------------------------
select tests.login_as('admin@t.test');
select is((select count(*) from public.profiles), 5::bigint, 'the admin sees every profile');
select lives_ok(
  $$ update public.profiles
     set current_stage_id = (select id from public.stages where position = 4), full_name = 'Bob Renamed'
     where email = 'bob@t.test' $$,
  'the admin can change a participant''s stage and details');
select lives_ok($$ update public.profiles set archived_at = now() where email = 'bob@t.test' $$,
  'the admin can archive a participant');
select lives_ok($$ update public.profiles set status = 'completed' where email = 'alice@t.test' $$,
  'the admin can mark a participant as completed');
select lives_ok($$ update public.profiles set full_name = 'The Admin' where id = auth.uid() $$,
  'the admin can edit their own name');
select throws_ok($$ update public.profiles set role = 'admin' where email = 'bob@t.test' $$,
  '42501', null, 'the admin cannot grant the admin role');
select throws_ok($$ update public.profiles set role = 'participant' where id = auth.uid() $$,
  '42501', null, 'the admin cannot change their own role');
select throws_ok(
  $$ update public.profiles set current_stage_id = (select id from public.stages where position = 1) where id = auth.uid() $$,
  '23514', null, 'the admin profile cannot be given a participant stage');
select throws_ok($$ delete from public.profiles where email = 'bob@t.test' $$,
  '42501', null, 'the admin cannot delete profiles through the API');
select tests.logout();
select is((select s.position from public.profiles p join public.stages s on s.id = p.current_stage_id where p.email = 'bob@t.test'),
  4, 'the stage change was saved');
select ok((select archived_at is not null from public.profiles where email = 'bob@t.test'), 'the archive flag was saved');

-- Archiving takes effect immediately for the participant.
select tests.login_as('bob@t.test');
update public.profiles set full_name = 'Bob Again' where id = auth.uid();
select tests.logout();
select is((select full_name from public.profiles where email = 'bob@t.test'), 'Bob Renamed',
  'a participant archived by the admin becomes read-only');

-- ---------------------------------------------------------------------------
-- Server-side roles
-- ---------------------------------------------------------------------------
select tests.login_service_role();
select throws_ok($$ update public.profiles set role = 'admin' where email = 'alice@t.test' $$,
  '42501', 'role cannot be changed', 'the service role cannot assign the admin role');
select throws_ok($$ update public.profiles set role = 'participant' where email = 'admin@t.test' $$,
  '42501', 'role cannot be changed', 'the service role cannot demote the admin');
select tests.logout();

select throws_ok($$ update public.profiles set id = gen_random_uuid() where email = 'alice@t.test' $$,
  '42501', 'profile id is immutable', 'a profile id can never change');

select * from finish();
rollback;
