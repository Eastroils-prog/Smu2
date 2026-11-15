-- Database-level tests for reminders.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- Start from an empty programme. Everything in this file is rolled back at the end.
delete from public.reminders; delete from public.help_requests; delete from public.milestones;
delete from public.polls; delete from public.shared_files; delete from public.finance_entries;
delete from public.messages; delete from public.tasks; delete from public.participant_invitations;
delete from auth.users; delete from private.sign_in_attempts;

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

insert into auth.users (id, email, email_confirmed_at) values (:boss, 'boss@example.com', now());
select private.provision_admin('boss@example.com', 'boss');
select pg_temp.act_as(:boss);
select public.create_invitation('ann@example.com', 'Ann Lee');
select public.create_invitation('bob@example.com', 'Bob Ray');
select pg_temp.act_as_owner_of_db();
insert into auth.users (id, email) values (:ann, 'ann@example.com'), (:bob, 'bob@example.com');
select pg_temp.act_as(:ann); select public.accept_invitation('ann');

select pg_temp.act_as(:boss);
select lives_ok($$insert into public.reminders (participant_id, title, due_on) values ('00000000-0000-0000-0000-000000000002', 'Call Ann', current_date)$$,
  'the admin can add a reminder about a participant');
select lives_ok($$insert into public.reminders (title, due_on, repeats) values ('Weekly check-in', current_date - 10, 'weekly')$$,
  'the admin can add a weekly reminder');
select lives_ok($$insert into public.reminders (title, due_on) values ('Book the room', current_date + 5)$$, 'the admin can add a plain reminder');
select lives_ok($$insert into public.reminders (title, due_on, repeats) values ('Monthly report', date '2026-01-31', 'monthly')$$,
  'the admin can add a monthly reminder');
select throws_ok($$insert into public.reminders (participant_id, title, due_on) values ('00000000-0000-0000-0000-000000000001', 'Me', current_date)$$,
  'P0001', 'person_not_found', 'a reminder can only be about a participant');
select throws_ok($$insert into public.reminders (title, due_on, done_at) values ('Cheat', current_date, now())$$,
  '42501', null, 'done cannot be set directly');

select lives_ok($$select public.complete_reminder((select id from public.reminders where title = 'Call Ann'))$$, 'the admin can mark a reminder done');
select ok((select done_at is not null from public.reminders where title = 'Call Ann'), 'a one-off reminder is closed');
select public.complete_reminder((select id from public.reminders where title = 'Weekly check-in'));
select ok((select due_on > current_date and due_on <= current_date + 7 and (due_on - (current_date - 10)) % 7 = 0
           from public.reminders where title = 'Weekly check-in'),
  'a weekly reminder moves to the next same weekday after today');
select ok((select done_at is null from public.reminders where title = 'Weekly check-in'), 'and stays open');
select public.complete_reminder((select id from public.reminders where title = 'Monthly report'));
select ok((select due_on > current_date and due_on <= (current_date + interval '1 month')::date
           and extract(day from due_on) in (28, 29, 30, 31) from public.reminders where title = 'Monthly report'),
  'a monthly reminder on the 31st moves to the end of the next month after today');
select throws_ok($$select public.complete_reminder((select id from public.reminders where title = 'Call Ann'))$$,
  'P0001', 'reminder_not_found', 'a done reminder cannot be done again');

select pg_temp.act_as(:ann);
select is((select count(*)::int from public.reminders), 0, 'a participant sees none of the admin''s reminders, not even ones about themselves');
select throws_ok($$select public.complete_reminder((select id from public.reminders where title = 'Book the room'))$$,
  'P0001', 'reminder_not_found', 'a participant cannot tick off the admin''s reminders');
select lives_ok($$insert into public.reminders (title, due_on, repeats) values ('Buy flour', current_date, 'weekly')$$, 'a participant can add their own reminder');
select throws_ok($$insert into public.reminders (participant_id, title, due_on) values ('00000000-0000-0000-0000-000000000002', 'About me', current_date)$$,
  '42501', null, 'only the admin can link a reminder to a person');
select lives_ok($$select public.complete_reminder((select id from public.reminders where title = 'Buy flour'))$$, 'a participant can tick off their own reminder');
select is((select due_on - current_date from public.reminders where title = 'Buy flour'), 7, 'and a weekly one moves on a week');

select pg_temp.act_as(:bob);
select is((select count(*)::int from public.reminders), 0, 'another participant cannot see it');
delete from public.reminders;
update public.reminders set title = 'Hacked';
select pg_temp.act_as(:boss);
select is((select count(*)::int from public.reminders where title = 'Buy flour'), 0, 'the admin cannot see a participant''s reminders either');
select pg_temp.act_as_owner_of_db();
select is((select count(*)::int from public.reminders where title in ('Buy flour', 'Book the room')), 2, 'nothing was deleted or changed by others');

select * from finish();
rollback;
