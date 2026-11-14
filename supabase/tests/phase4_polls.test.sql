-- Database-level tests for polls.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

delete from public.shared_files; delete from public.finance_entries;
delete from public.messages; delete from public.tasks;
delete from public.participant_invitations; delete from auth.users;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.act_as_owner_of_db() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.opt(p_label text) returns uuid language sql as $$
  select id from public.poll_options where label = p_label limit 1;
$$;

\set boss '''00000000-0000-0000-0000-000000000001'''
\set ann  '''00000000-0000-0000-0000-000000000002'''
\set bob  '''00000000-0000-0000-0000-000000000003'''
\set cara '''00000000-0000-0000-0000-000000000004'''

insert into auth.users (id, email, email_confirmed_at) values (:boss, 'boss@example.com', now());
select private.provision_admin('boss@example.com', 'boss');
select pg_temp.act_as(:boss);
select public.create_invitation('ann@example.com', 'Ann Lee');
select public.create_invitation('bob@example.com', 'Bob Ray');
select public.create_invitation('cara@example.com', 'Cara Moss');
select pg_temp.act_as_owner_of_db();
insert into auth.users (id, email) values (:ann, 'ann@example.com'), (:bob, 'bob@example.com'), (:cara, 'cara@example.com');
select pg_temp.act_as(:ann); select public.accept_invitation('ann');
select pg_temp.act_as(:bob); select public.accept_invitation('bob');

-- ---------- Creating ----------
select pg_temp.act_as(:boss);
select throws_ok($$select public.create_poll('Lunch?', array['Pizza'], false)$$, 'P0001', 'too_few_choices', 'a poll needs at least two choices');
select throws_ok($$select public.create_poll('Lunch?', array['Pizza', ' pizza '], false)$$, 'P0001', 'duplicate_choices', 'choices must differ');
select throws_ok($$select public.create_poll('Lunch?', array['1','2','3','4','5','6','7','8','9','10','11'], false)$$,
  'P0001', 'too_many_choices', 'at most ten choices');
select lives_ok($$select public.create_poll('Which day for the workshop?', array['Monday', 'Tuesday', 'Wednesday', 'Thursday', '  '], false)$$,
  'the admin can create a single-choice poll with more than three choices');
select is((select count(*)::int from public.poll_options), 4, 'empty choices are dropped');
select lives_ok($$select public.create_poll('Which topics?', array['Pricing', 'Marketing', 'Taxes', 'Pitching', 'Legal'], true)$$,
  'the admin can create a multi-choice poll');

select pg_temp.act_as(:ann);
select throws_ok($$select public.create_poll('Mine', array['a', 'b'], false)$$, '42501', null, 'a participant cannot create polls');
select is((select count(*)::int from public.polls), 2, 'a participant can see the polls');

-- ---------- Voting ----------
select is((select count(*)::int from public.poll_results((select id from public.polls where question like 'Which day%'))), 0,
  'no totals before you have voted');
select throws_ok($$select public.cast_vote((select id from public.polls where question like 'Which day%'), array[pg_temp.opt('Monday'), pg_temp.opt('Tuesday')])$$,
  'P0001', 'one_choice_only', 'a single-choice poll takes one choice');
select throws_ok($$select public.cast_vote((select id from public.polls where question like 'Which day%'), array[pg_temp.opt('Pricing')])$$,
  'P0001', 'choice_not_in_poll', 'a choice from another poll is refused');
select throws_ok($$select public.cast_vote((select id from public.polls where question like 'Which day%'), '{}')$$,
  'P0001', 'no_choice', 'an empty vote is refused');
select lives_ok($$select public.cast_vote((select id from public.polls where question like 'Which day%'), array[pg_temp.opt('Tuesday')])$$,
  'a participant can vote');
select lives_ok($$select public.cast_vote((select id from public.polls where question like 'Which day%'), array[pg_temp.opt('Thursday')])$$,
  'a participant can change their vote');
select is((select count(*)::int from public.poll_votes), 1, 'changing a vote replaces it');
select lives_ok($$select public.cast_vote((select id from public.polls where question like 'Which topics%'), array[pg_temp.opt('Pricing'), pg_temp.opt('Taxes'), pg_temp.opt('Legal')])$$,
  'a participant can pick several choices in a multi-choice poll');
select throws_ok($$insert into public.poll_votes (poll_id, option_id, voter_id) values ((select id from public.polls limit 1), pg_temp.opt('Monday'), '00000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'votes cannot be inserted directly (no voting for someone else)');

select pg_temp.act_as(:bob);
select is((select count(*)::int from public.poll_votes), 0, 'nobody can read another person''s votes');
select public.cast_vote((select id from public.polls where question like 'Which day%'), array[pg_temp.opt('Thursday')]);
select is((select votes::int from public.poll_results((select id from public.polls where question like 'Which day%')) where option_id = pg_temp.opt('Thursday')), 2,
  'after voting you see the totals');
select is((select max(voters)::int from public.poll_results((select id from public.polls where question like 'Which day%'))), 2, 'and how many people voted');

select pg_temp.act_as(:boss);
select is((select count(*)::int from public.poll_votes), 0, 'not even the admin can read who voted for what');
select is((select votes::int from public.poll_results((select id from public.polls where question like 'Which topics%')) where option_id = pg_temp.opt('Taxes')), 1,
  'the admin sees totals without voting');
select lives_ok($$select public.close_poll((select id from public.polls where question like 'Which day%'))$$, 'the admin can close a poll');

select pg_temp.act_as(:bob);
select throws_ok($$select public.cast_vote((select id from public.polls where question like 'Which day%'), array[pg_temp.opt('Monday')])$$,
  'P0001', 'poll_closed', 'nobody can vote on a closed poll');
select throws_ok($$select public.close_poll((select id from public.polls where question like 'Which topics%'))$$, '42501', null, 'a participant cannot close a poll');

select pg_temp.act_as(:cara);
select is((select count(*)::int from public.polls), 0, 'someone who has not joined sees no polls');

select * from finish();
rollback;
