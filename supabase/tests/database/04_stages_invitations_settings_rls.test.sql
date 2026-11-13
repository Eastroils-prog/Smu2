-- Stages, participant invitations and application settings.
begin;
\ir _helpers.sql.inc
select plan(34);

select tests.seed_people();

-- ---------------------------------------------------------------------------
-- Stages
-- ---------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select * from public.stages $$, '42501', null, 'anon cannot read stages');

select tests.login_as('alice@t.test');
select is((select count(*) from public.stages), 6::bigint, 'a participant can read the six default stages');
select throws_ok($$ insert into public.stages (position, name) values (7, 'Mine') $$,
  '42501', null, 'a participant cannot add a stage');
update public.stages set name = 'Hacked';
delete from public.stages where position = 6;
select tests.logout();
select is((select count(*) from public.stages where name = 'Hacked'), 0::bigint, 'a participant cannot rename stages');
select is((select count(*) from public.stages), 6::bigint, 'a participant cannot delete stages');

select tests.login_as('admin@t.test');
select lives_ok($$ insert into public.stages (position, name) values (7, 'Growth') $$, 'the admin can add a stage');
select lives_ok($$ update public.stages set name = 'Idea' where position = 1 $$, 'the admin can rename a stage');
select lives_ok(
  $$ update public.stages set position = case position when 2 then 3 when 3 then 2 end where position in (2, 3) $$,
  'the admin can swap two stages in one statement');
select lives_ok($$ set constraints all immediate $$, 'and the unique position constraint still holds afterwards');
set constraints all deferred;
select lives_ok($$ delete from public.stages where position = 7 $$, 'the admin can delete an unused stage');
select throws_ok(
  $$ delete from public.stages where id = (select current_stage_id from public.profiles where email = 'alice@t.test') $$,
  '23503', null, 'a stage that participants are in cannot be deleted');
select throws_ok($$ insert into public.stages (position, name) values (9, '  ') $$,
  '23514', null, 'a stage needs a name');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Participant invitations
-- ---------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select * from public.participant_invitations $$, '42501', null, 'anon cannot read invitations');

select tests.login_as('alice@t.test');
select is_empty($$ select 1 from public.participant_invitations $$, 'a participant cannot see any invitation, not even their own');
select throws_ok(
  $$ insert into public.participant_invitations (email, full_name, invited_by) values ('friend@t.test', 'Friend', auth.uid()) $$,
  '42501', null, 'a participant cannot invite anyone');

select tests.login_as('admin@t.test');
select is((select count(*) from public.participant_invitations), 4::bigint, 'the admin sees every invitation');
select throws_ok(
  $$ insert into public.participant_invitations (email, full_name, invited_by) values ('direct@t.test', 'Direct', auth.uid()) $$,
  '42501', null, 'even the admin cannot create invitations directly (only through the invitation function)');
select throws_ok($$ update public.participant_invitations set status = 'revoked', revoked_at = now() $$,
  '42501', null, 'even the admin cannot change invitations directly');
select tests.logout();

select throws_ok(
  $$ insert into public.participant_invitations (email, full_name, invited_by) values ('DANA@t.test', 'Dana Again', tests.uid('admin@t.test')) $$,
  '23505', null, 'only one pending invitation per e-mail address (case-insensitive)');
select lives_ok(
  $$ insert into public.participant_invitations (email, full_name, invited_by) values ('alice@t.test', 'Alice Again', tests.uid('admin@t.test')) $$,
  'a new invitation is possible once the previous one is no longer pending');
select throws_ok(
  $$ insert into public.participant_invitations (email, full_name, invited_by, status) values ('x@t.test', 'X', tests.uid('admin@t.test'), 'accepted') $$,
  '23514', null, 'an accepted invitation must carry its acceptance time');
select throws_ok(
  $$ insert into public.participant_invitations (email, full_name, invited_by, status) values ('y@t.test', 'Y', tests.uid('admin@t.test'), 'revoked') $$,
  '23514', null, 'a revoked invitation must carry its revocation time');

-- ---------------------------------------------------------------------------
-- Application settings
-- ---------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select * from public.app_settings $$, '42501', null, 'anon cannot read settings');

select tests.login_as('alice@t.test');
select is((select program_name from public.app_settings), 'VentureTrack', 'a participant can read the programme name');
update public.app_settings set program_name = 'Hacked';
select tests.logout();
select is((select program_name from public.app_settings), 'VentureTrack', 'a participant cannot change settings');

select tests.login_as('admin@t.test');
select lives_ok($$ update public.app_settings set program_name = 'Founders 2027', inactivity_days = 10 $$,
  'the admin can change settings');
select throws_ok($$ update public.app_settings set inactivity_days = 0 $$,
  '23514', null, 'the inactivity threshold must be at least one day');
select throws_ok($$ update public.app_settings set message_retention_days = 7 $$,
  '23514', null, 'message retention cannot be set below 30 days');
select lives_ok($$ update public.app_settings set message_retention_days = null $$,
  'message retention can be "keep forever"');
select throws_ok($$ insert into public.app_settings default values $$,
  '42501', null, 'the admin cannot add a second settings row');
select throws_ok($$ delete from public.app_settings $$,
  '42501', null, 'the admin cannot delete the settings row');
select tests.logout();
select is((select program_name from public.app_settings), 'Founders 2027', 'the new programme name was saved');
select throws_ok($$ insert into public.app_settings (id) values (false) $$,
  '23514', null, 'the settings table can only ever hold its single row');
select is((select count(*) from public.app_settings), 1::bigint, 'there is exactly one settings row');

select * from finish();
rollback;
