-- Database-level tests for tasks, handed-in work and messages.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

delete from public.participant_invitations;
delete from auth.users;

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

\set boss '''00000000-0000-0000-0000-000000000001'''
\set ann  '''00000000-0000-0000-0000-000000000002'''
\set bob  '''00000000-0000-0000-0000-000000000003'''
\set cara '''00000000-0000-0000-0000-000000000004'''
\set t1   '''10000000-0000-0000-0000-000000000001'''
\set t2   '''10000000-0000-0000-0000-000000000002'''

-- ---------- People: an owner, two joined participants, one still invited ----------
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

-- ---------- Giving tasks ----------
select pg_temp.act_as(:boss);
select lives_ok($$insert into public.tasks (id, participant_id, title) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Write a plan')$$,
  'the admin can give a task');
select is((select status::text from public.tasks where id = :t1), 'not_started', 'a new task starts as not started');
select is((select stage_id from public.tasks where id = :t1), (select current_stage_id from public.profiles where id = :ann),
  'a new task is filed under the participant''s current stage');
select throws_ok($$insert into public.tasks (participant_id, title, status) values ('00000000-0000-0000-0000-000000000002', 'Cheat', 'completed')$$,
  '42501', null, 'not even the admin can create a task that is already completed');
select throws_ok($$insert into public.tasks (participant_id, title) values ('00000000-0000-0000-0000-000000000004', 'Too early')$$,
  'P0001', null, 'a task cannot be given to someone who has not joined');
select throws_ok($$update public.tasks set status = 'completed' where id = '10000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'the admin cannot set a status directly');

select pg_temp.act_as(:ann);
select throws_ok($$insert into public.tasks (participant_id, title) values ('00000000-0000-0000-0000-000000000002', 'My own task')$$,
  '42501', null, 'a participant cannot create tasks');
select is((select count(*)::int from public.tasks), 1, 'a participant sees their own task');
update public.tasks set title = 'Hacked' where id = :t1;
select is((select title from public.tasks where id = :t1), 'Write a plan', 'a participant cannot edit a task');
delete from public.tasks where id = :t1;
select is((select count(*)::int from public.tasks), 1, 'a participant cannot delete a task');
select throws_ok($$select public.review_task('10000000-0000-0000-0000-000000000001', true)$$,
  '42501', null, 'a participant cannot approve');

select pg_temp.act_as(:bob);
select is((select count(*)::int from public.tasks), 0, 'another participant sees none of it');
select throws_ok($$select public.start_task('10000000-0000-0000-0000-000000000001')$$,
  'P0001', 'task_not_startable', 'another participant cannot start it');
select throws_ok($$select public.submit_task('10000000-0000-0000-0000-000000000001', 'mine now')$$,
  'P0001', 'task_not_open', 'another participant cannot hand in for it');

-- ---------- Doing the work ----------
select pg_temp.act_as(:ann);
select lives_ok($$select public.start_task('10000000-0000-0000-0000-000000000001')$$, 'the participant can start their task');
select throws_ok($$select public.submit_task('10000000-0000-0000-0000-000000000001', '   ')$$,
  'P0001', 'nothing_to_hand_in', 'an empty hand-in is refused');
select throws_ok($$select public.submit_task('10000000-0000-0000-0000-000000000001', 'x',
    '[{"path":"00000000-0000-0000-0000-000000000003/10000000-0000-0000-0000-000000000001/a.png","name":"a.png"}]')$$,
  'P0001', 'file_not_allowed', 'a file from someone else''s folder cannot be attached');
select throws_ok($$select public.submit_task('10000000-0000-0000-0000-000000000001', 'x',
    '[{"path":"00000000-0000-0000-0000-000000000002/10000000-0000-0000-0000-000000000001/ghost.png","name":"ghost.png"}]')$$,
  'P0001', 'file_missing', 'a file that was never uploaded cannot be attached');
select lives_ok($$select public.submit_task('10000000-0000-0000-0000-000000000001', 'Here is my plan')$$, 'the participant can hand in work');
select is((select status::text from public.tasks where id = :t1), 'submitted', 'handing in marks the task as submitted');
select throws_ok($$select public.submit_task('10000000-0000-0000-0000-000000000001', 'again')$$,
  'P0001', 'task_not_open', 'work cannot be handed in twice while waiting for review');

select pg_temp.act_as(:bob);
select is((select count(*)::int from public.task_submissions), 0, 'another participant cannot read the handed-in work');

-- ---------- Review ----------
select pg_temp.act_as(:boss);
select lives_ok($$select public.review_task('10000000-0000-0000-0000-000000000001', false, 'Add your costs')$$, 'the admin can ask for changes');
select is((select status::text from public.tasks where id = :t1), 'needs_revision', 'the task then needs changes');
select pg_temp.act_as(:ann);
select is((select feedback from public.task_submissions where task_id = :t1), 'Add your costs', 'the participant can read the feedback');
select lives_ok($$select public.submit_task('10000000-0000-0000-0000-000000000001', 'Now with costs')$$, 'the participant can hand in again');
select pg_temp.act_as(:boss);
select lives_ok($$select public.review_task('10000000-0000-0000-0000-000000000001', true, 'Good')$$, 'the admin can approve');
select is((select status::text || '/' || (completed_at is not null)::text || '/' || approved_by::text from public.tasks where id = :t1),
  'completed/true/00000000-0000-0000-0000-000000000001', 'approval completes the task and records who approved');
select throws_ok($$select public.review_task('10000000-0000-0000-0000-000000000001', true)$$,
  'P0001', 'task_not_submitted', 'a task cannot be reviewed twice');

-- ---------- Messages ----------
select pg_temp.act_as(:ann);
select lives_ok($$select public.send_message('00000000-0000-0000-0000-000000000003', 'Hi Bob')$$, 'a participant can message another participant');
select lives_ok($$select public.send_message('00000000-0000-0000-0000-000000000001', 'Hi boss')$$, 'a participant can message the admin');
select throws_ok($$select public.send_message('00000000-0000-0000-0000-000000000004', 'Hi Cara')$$,
  'P0001', 'recipient_not_available', 'nobody can message someone who has not joined');
select throws_ok($$insert into public.messages (sender_id, recipient_id, body) values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'forged')$$,
  '42501', null, 'messages cannot be inserted directly (no forging a sender)');
select throws_ok($$update public.messages set body = 'edited'$$, '42501', null, 'messages cannot be edited');
select is((select string_agg(full_name, ',' order by full_name) from public.directory()), 'Administrator,Bob Ray',
  'the directory lists the admin and joined participants only, by name');

select pg_temp.act_as(:boss);
select is((select count(*)::int from public.messages), 1, 'the admin can read only messages they are part of, not participant-to-participant ones');

select pg_temp.act_as(:bob);
select is((select count(*)::int from public.messages), 1, 'the recipient can read the message');
select public.mark_conversation_read(:ann);
select ok((select read_at is not null from public.messages where recipient_id = :bob), 'the recipient can mark it read');

select pg_temp.act_as(:cara);
select throws_ok($$select public.send_message('00000000-0000-0000-0000-000000000001', 'Let me in')$$,
  '42501', null, 'someone who has not joined cannot send messages');
select is((select count(*)::int from public.directory()), 0, 'someone who has not joined cannot see the directory');

select pg_temp.act_as(:boss);
update public.profiles set archived_at = now() where id = :bob;
select pg_temp.act_as(:bob);
select throws_ok($$select public.send_message('00000000-0000-0000-0000-000000000002', 'still here')$$,
  '42501', null, 'an archived person cannot send messages');

select * from finish();
rollback;
