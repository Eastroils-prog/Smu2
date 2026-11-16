-- Database-level tests for milestones, help requests and blocking.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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
select pg_temp.act_as(:bob); select public.accept_invitation('bob');

-- ---------- Milestones ----------
select pg_temp.act_as(:boss);
select lives_ok($$select public.add_milestone('00000000-0000-0000-0000-000000000002', 'First paying customer')$$, 'the admin can add a milestone');
select is((select stage_id from public.milestones), (select current_stage_id from public.profiles where id = :ann), 'it belongs to the person''s current stage');
select lives_ok($$select public.set_milestone_reached((select id from public.milestones limit 1), true)$$, 'the admin can mark it reached');
select ok((select achieved_at is not null and achieved_by = :boss::uuid from public.milestones), 'and who did it is recorded');
select throws_ok($$select public.add_milestone('00000000-0000-0000-0000-000000000001', 'Me')$$, 'P0001', 'person_not_found', 'the admin has no milestones');

select pg_temp.act_as(:ann);
select is((select count(*)::int from public.milestones), 1, 'a participant sees their own milestones');
select throws_ok($$select public.set_milestone_reached((select id from public.milestones limit 1), false)$$, '42501', null, 'a participant cannot mark milestones');
select throws_ok($$select public.add_milestone('00000000-0000-0000-0000-000000000002', 'Mine')$$, '42501', null, 'a participant cannot add milestones');
select throws_ok($$update public.milestones set achieved_at = null$$, '42501', null, 'milestones cannot be edited directly');
delete from public.milestones;
select is((select count(*)::int from public.milestones), 1, 'a participant cannot delete milestones');

select pg_temp.act_as(:bob);
select is((select count(*)::int from public.milestones), 0, 'another participant sees none of them');

-- ---------- Help ----------
select pg_temp.act_as(:ann);
select lives_ok($$insert into public.help_requests (body) values ('I am stuck on pricing')$$, 'a participant can ask for help');
select throws_ok($$insert into public.help_requests (body) values ('Again')$$, '23505', null, 'one open request at a time');
select throws_ok($$insert into public.help_requests (participant_id, body) values ('00000000-0000-0000-0000-000000000003', 'Fake')$$,
  '42501', null, 'nobody can ask for help in someone else''s name');
select throws_ok($$select public.resolve_help_request((select id from public.help_requests limit 1))$$, '42501', null, 'a participant cannot mark it handled');
select pg_temp.act_as(:bob);
select is((select count(*)::int from public.help_requests), 0, 'another participant cannot see the request');
select pg_temp.act_as(:boss);
select lives_ok($$select public.resolve_help_request((select id from public.help_requests limit 1))$$, 'the admin can mark it handled');
select pg_temp.act_as(:ann);
select lives_ok($$insert into public.help_requests (body) values ('New question')$$, 'after that, a new request can be made');

-- ---------- Blocking ----------
select pg_temp.act_as(:ann);
select throws_ok($$select public.set_blocked('00000000-0000-0000-0000-000000000003', true)$$, '42501', null, 'a participant cannot block anyone');
select throws_ok($$select public.account_action_target('00000000-0000-0000-0000-000000000003')$$, '42501', null, 'a participant cannot delete anyone');
select throws_ok($$select * from public.account_files('00000000-0000-0000-0000-000000000003')$$, '42501', null, 'a participant cannot list anyone''s files');
select pg_temp.act_as(:boss);
select throws_ok($$select public.set_blocked('00000000-0000-0000-0000-000000000001', true)$$, 'P0001', 'person_not_found', 'the admin cannot be blocked');
select lives_ok($$select public.set_blocked('00000000-0000-0000-0000-000000000003', true)$$, 'the admin can block a participant');
select pg_temp.act_as_owner_of_db();
select is(public.sign_in_begin('bob'), null, 'a blocked username is never looked up for sign-in');
select pg_temp.act_as(:bob);
select throws_ok($$select public.send_message('00000000-0000-0000-0000-000000000001', 'hello?')$$, '42501', null, 'a blocked person cannot send messages');
select is((select count(*)::int from public.directory()), 0, 'a blocked person sees nobody in the directory');
select pg_temp.act_as(:ann);
select throws_ok($$select public.send_message('00000000-0000-0000-0000-000000000003', 'hi Bob')$$, 'P0001', 'recipient_not_available', 'nobody can message a blocked person');
select is((select string_agg(full_name, ',') from public.directory()), 'Administrator', 'a blocked person disappears from the directory');

select * from finish();
rollback;
