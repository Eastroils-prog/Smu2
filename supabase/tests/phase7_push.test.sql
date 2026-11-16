-- Database-level tests for phone notifications.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Start from an empty programme. Everything in this file is rolled back at the end.
delete from public.reminders; delete from public.help_requests; delete from public.milestones;
delete from public.polls; delete from public.shared_files; delete from public.finance_entries;
delete from public.messages; delete from public.tasks; delete from public.participant_invitations;
delete from auth.users; delete from private.sign_in_attempts; delete from private.push_outbox;

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
create function pg_temp.outbox(p uuid) returns text language sql as $$
  select string_agg(title, ' | ' order by id) from private.push_outbox where profile_id = p;
$$;

\set boss '''00000000-0000-0000-0000-000000000001'''
\set ann  '''00000000-0000-0000-0000-000000000002'''
\set bob  '''00000000-0000-0000-0000-000000000003'''
\set key  '''BB84EyfQ7jg-t4SSpfuQ60mhCCAah5a7KGxEt9x_c1X7l-sOySPh0Tg0PN2M4crUuCUlRB1GWw9y9SV7ZJsVOPk'''

insert into auth.users (id, email, email_confirmed_at) values (:boss, 'boss@example.com', now());
select private.provision_admin('boss@example.com', 'boss');
select pg_temp.act_as(:boss);
select public.create_invitation('ann@example.com', 'Ann Lee');
select public.create_invitation('bob@example.com', 'Bob Ray');
select pg_temp.act_as_owner_of_db();
insert into auth.users (id, email) values (:ann, 'ann@example.com'), (:bob, 'bob@example.com');
select pg_temp.act_as(:ann); select public.accept_invitation('ann');
select pg_temp.act_as(:bob); select public.accept_invitation('bob');

-- ---------- Devices ----------
select pg_temp.act_as(:ann);
select lives_ok(format($$select public.save_push_subscription('https://push.example/ann', %L, 'abcdefghijklmnopqrstuv', 'Europe/Riga', 'Test')$$, :key),
  'a member can save a device');
select is((select time_zone from public.push_subscriptions), 'Europe/Riga', 'the device''s time zone is kept');
select pg_temp.act_as(:boss);
select lives_ok(format($$select public.save_push_subscription('https://push.example/boss', %L, 'abcdefghijklmnopqrstuv', 'Nowhere/Fake', null)$$, :key),
  'the admin can save a device');
select is((select time_zone from public.push_subscriptions where profile_id = :boss), 'UTC', 'an unknown time zone falls back to UTC');
select is((select count(*)::int from public.push_subscriptions), 1, 'everyone sees only their own devices, the admin included');

select pg_temp.act_as(:bob);
delete from public.push_subscriptions;
select pg_temp.act_as_owner_of_db();
select is((select count(*)::int from public.push_subscriptions), 2, 'nobody can remove someone else''s devices');
select pg_temp.act_as(:bob);
select throws_ok($$select * from public.push_claim_batch(10)$$, '42501', null, 'members cannot read the outbox');
select throws_ok($$insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth) values ('00000000-0000-0000-0000-000000000002', 'https://x.example', 'x', 'y')$$,
  '42501', null, 'devices cannot be inserted directly (no adding a device to someone else)');

-- ---------- What sends a notification ----------
select pg_temp.act_as(:boss);
select public.send_message(:ann, 'Hello Ann');
insert into public.tasks (participant_id, title) values (:ann, 'Write a plan');
select pg_temp.act_as(:bob);
select public.send_message(:ann, 'Hi from Bob');
select pg_temp.act_as_owner_of_db();
select is(pg_temp.outbox(:ann), 'Message from Administrator | New task | Message from Bob Ray', 'Ann is told about both messages and the new task');
select is(pg_temp.outbox(:bob), null, 'Bob, with no device, gets nothing queued');

select pg_temp.act_as(:ann);
select public.start_task((select id from public.tasks limit 1));
select public.submit_task((select id from public.tasks limit 1), 'Done');
insert into public.help_requests (body) values ('Stuck');
select pg_temp.act_as_owner_of_db();
select is(pg_temp.outbox(:boss), 'Ann Lee handed in work | Ann Lee asked for help', 'the admin is told about handed-in work and the help request');

select pg_temp.act_as(:boss);
select public.review_task((select id from public.tasks limit 1), false, 'Add costs');
select pg_temp.act_as_owner_of_db();
select ok(pg_temp.outbox(:ann) like '%Your work needs changes', 'Ann is told her work needs changes');

-- Archived people hear nothing.
update public.profiles set archived_at = now() where id = :ann;
delete from private.push_outbox;
select pg_temp.act_as(:boss);
select public.create_poll('Lunch?', array['Pizza', 'Soup'], false);
select pg_temp.act_as_owner_of_db();
select is((select count(*)::int from private.push_outbox), 0, 'an archived person gets no notifications');
update public.profiles set archived_at = null where id = :ann;

-- ---------- Morning summary ----------
select pg_temp.act_as(:ann);
insert into public.reminders (title, due_on) values ('Call the printer', current_date - 1);
select pg_temp.act_as_owner_of_db();
select is(private.queue_digests(true), 1, 'the summary goes only to people with something due (Ann, not the admin)');
select ok((select body from private.push_outbox where profile_id = :ann and title = 'Your day in VentureTrack') like 'Today: 1 reminder%', 'and says what is due');

select * from finish();
rollback;
