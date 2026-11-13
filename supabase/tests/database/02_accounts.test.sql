-- Account lifecycle: invitation-only sign-up, admin provisioning, onboarding.
begin;
\ir _helpers.sql.inc
select plan(41);

select tests.clean_slate();

-- ---------------------------------------------------------------------------
-- The very first account of an empty installation
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into auth.users (id, instance_id, aud, role) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated') $$,
  'P0001', 'VentureTrack accounts require an e-mail address',
  'an account without an e-mail address is rejected');

select lives_ok($$ select tests.create_user('owner@t.test', false) $$,
  'the first account of an empty installation can be created without an invitation');
select is((select role::text   from public.profiles where email = 'owner@t.test'), 'participant', 'it starts as an ordinary participant, not as admin');
select is((select status::text from public.profiles where email = 'owner@t.test'), 'invited',     'and is not active yet');
select is((select full_name    from public.profiles where email = 'owner@t.test'), 'owner',       'its name defaults to the mailbox name');

select throws_ok($$ select tests.create_user('mallory@t.test') $$,
  'P0001', 'Registration is by invitation only',
  'a second account without an invitation is rejected');
select is((select count(*) from auth.users), 1::bigint, 'the rejected account was not created');

-- ---------------------------------------------------------------------------
-- Admin provisioning
-- ---------------------------------------------------------------------------
select throws_like($$ select private.provision_admin('nobody@t.test') $$,
  'No account exists for nobody@t.test%', 'provisioning an unknown e-mail fails');
select throws_like($$ select private.provision_admin('owner@t.test') $$,
  '%has not been confirmed yet%', 'provisioning an unconfirmed account fails');

update auth.users set email_confirmed_at = now() where email = 'owner@t.test';

-- another account sneaks in before the admin is provisioned
insert into public.participant_invitations (id, email, full_name, invited_by)
values ('11111111-1111-1111-1111-111111111111', 'early@t.test', 'Early Bird', tests.uid('owner@t.test'));
select tests.create_user('early@t.test');
select throws_like($$ select private.provision_admin('owner@t.test') $$,
  'Other accounts already exist%', 'provisioning fails while other accounts exist');
delete from public.participant_invitations where email = 'early@t.test';
delete from auth.users where email = 'early@t.test';
select is((select count(*) from public.profiles where email = 'early@t.test'), 0::bigint,
  'deleting an auth user removes the profile');

select lives_ok($$ select private.provision_admin('  OWNER@T.TEST ') $$,
  'the owner can be provisioned (e-mail matched case-insensitively)');
select is((select role::text   from public.profiles where email = 'owner@t.test'), 'admin',  'the owner is now the admin');
select is((select status::text from public.profiles where email = 'owner@t.test'), 'active', 'and active');
select ok((select joined_at is not null from public.profiles where email = 'owner@t.test'), 'with a joined date');

select throws_like($$ select private.provision_admin('owner@t.test') $$,
  'An administrator already exists%', 'provisioning twice fails');

-- ---------------------------------------------------------------------------
-- Invitations create participants
-- ---------------------------------------------------------------------------
insert into public.participant_invitations (email, full_name, invited_by, initial_stage_id)
values ('alice@t.test', 'Alice Example', tests.uid('owner@t.test'),
        (select id from public.stages where position = 3));
select lives_ok($$ select tests.create_user('alice@t.test') $$, 'an invited e-mail address can get an account');
select is((select role::text   from public.profiles where email = 'alice@t.test'), 'participant',   'invited accounts are participants');
select is((select status::text from public.profiles where email = 'alice@t.test'), 'invited',       'they start in the invited state');
select is((select full_name    from public.profiles where email = 'alice@t.test'), 'Alice Example', 'the name comes from the invitation');
select is((select s.position from public.profiles p join public.stages s on s.id = p.current_stage_id where p.email = 'alice@t.test'),
  3, 'the starting stage comes from the invitation');
select is((select profile_id from public.participant_invitations where email = 'alice@t.test'),
  tests.uid('alice@t.test'), 'the invitation is linked to the new profile');

insert into public.participant_invitations (email, full_name, invited_by)
values ('Bob@T.Test', 'Bob Example', tests.uid('owner@t.test'));
select lives_ok($$ select tests.create_user('bob@t.test') $$, 'invitation e-mail matching is case-insensitive');
select is((select s.position from public.profiles p join public.stages s on s.id = p.current_stage_id where p.email = 'bob@t.test'),
  1, 'without a chosen stage the participant starts at the first stage');

insert into public.participant_invitations (email, full_name, invited_by, expires_at)
values ('late@t.test', 'Late Comer', tests.uid('owner@t.test'), now() - interval '1 minute');
select throws_ok($$ select tests.create_user('late@t.test') $$,
  'P0001', 'Registration is by invitation only', 'an expired invitation does not allow sign-up');

insert into public.participant_invitations (email, full_name, invited_by, status, revoked_at)
values ('gone@t.test', 'Gone Away', tests.uid('owner@t.test'), 'revoked', now());
select throws_ok($$ select tests.create_user('gone@t.test') $$,
  'P0001', 'Registration is by invitation only', 'a revoked invitation does not allow sign-up');

-- An invitation can never produce a second admin.
select throws_ok($$ update public.profiles set role = 'admin', current_stage_id = null where email = 'alice@t.test' $$,
  '23505', null, 'the database refuses a second administrator even for the owner role');

-- ---------------------------------------------------------------------------
-- Accepting an invitation
-- ---------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select public.accept_invitation() $$, '42501', null, 'anonymous users cannot call accept_invitation()');

select tests.login_as('alice@t.test');
select lives_ok($$ select public.accept_invitation() $$, 'an invited participant can accept');
select tests.logout();
select is((select status::text from public.profiles where email = 'alice@t.test'), 'active', 'accepting makes the participant active');
select ok((select joined_at is not null from public.profiles where email = 'alice@t.test'), 'and records the joined date');
select is((select status::text from public.participant_invitations where email = 'alice@t.test'), 'accepted', 'the invitation is marked accepted');
select is((select status::text from public.profiles where email = 'bob@t.test'), 'invited', 'other invited participants are unaffected');

update public.profiles set joined_at = '2020-01-01' where email = 'alice@t.test';
select tests.login_as('alice@t.test');
select lives_ok($$ select public.accept_invitation() $$, 'accepting twice is harmless');
select tests.logout();
select is((select joined_at from public.profiles where email = 'alice@t.test'), '2020-01-01'::timestamptz,
  'and does not change the joined date');

select tests.login_as('owner@t.test');
select lives_ok($$ select public.accept_invitation() $$, 'the admin calling accept_invitation() is a no-op');
select tests.logout();
select is((select role::text from public.profiles where email = 'owner@t.test'), 'admin', 'the admin is still the admin');

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------
update auth.users set email = 'alice.new@t.test' where email = 'alice@t.test';
select is((select email::text from public.profiles where id = tests.uid('alice.new@t.test')), 'alice.new@t.test',
  'changing the sign-in e-mail updates the profile');

update public.profiles set last_active_at = now() - interval '10 minutes' where email = 'alice.new@t.test';
select tests.login_as('alice.new@t.test');
select public.touch_last_active();
select tests.logout();
select is((select last_active_at from public.profiles where email = 'alice.new@t.test'), now(),
  'touch_last_active() records activity');

update public.profiles set last_active_at = now() - interval '1 minute' where email = 'alice.new@t.test';
select tests.login_as('alice.new@t.test');
select public.touch_last_active();
select tests.logout();
select is((select last_active_at from public.profiles where email = 'alice.new@t.test'), now() - interval '1 minute',
  'touch_last_active() is throttled to once per five minutes');

select is((select last_active_at from public.profiles where email = 'bob@t.test'), null,
  'touch_last_active() only touches the caller');

select * from finish();
rollback;
