-- Database-level tests for money tracking and shared spreadsheets.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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

-- ---------- Money ----------
select pg_temp.act_as(:ann);
select lives_ok($$insert into public.finance_entries (month, money_in, money_out, note) values ('2026-10-01', 500, 320.50, 'First sales')$$,
  'a participant can add a month');
select is((select participant_id from public.finance_entries), :ann::uuid, 'the month is filed under the person who added it');
select throws_ok($$insert into public.finance_entries (month, money_in) values ('2026-10-01', 1)$$, '23505', null, 'one row per month');
select throws_ok($$insert into public.finance_entries (month, money_in) values ('2026-10-15', 1)$$, '23514', null, 'a month must be the first day of a month');
select throws_ok($$insert into public.finance_entries (month, money_in) values ('2999-01-01', 1)$$, 'P0001', 'month_in_future', 'a future month is refused');
select throws_ok($$insert into public.finance_entries (month, money_in) values ('2026-09-01', -5)$$, '23514', null, 'negative amounts are refused');
select throws_ok($$insert into public.finance_entries (participant_id, month, money_in) values ('00000000-0000-0000-0000-000000000003', '2026-09-01', 5)$$,
  '42501', null, 'a participant cannot add numbers for someone else');
select lives_ok($$update public.finance_entries set money_in = 650 where month = '2026-10-01'$$, 'a participant can correct their month');

select pg_temp.act_as(:bob);
select is((select count(*)::int from public.finance_entries), 0, 'another participant cannot read the numbers');
update public.finance_entries set money_in = 1;
delete from public.finance_entries;

select pg_temp.act_as(:boss);
select is((select money_in from public.finance_entries), 650::numeric, 'the admin can read everyone''s numbers, and nobody else changed them');
update public.finance_entries set money_in = 99999;
select is((select money_in from public.finance_entries), 650::numeric, 'the admin cannot change a participant''s numbers');
select throws_ok($$insert into public.finance_entries (participant_id, month, money_in) values ('00000000-0000-0000-0000-000000000001', '2026-09-01', 5)$$,
  '42501', null, 'the admin has no money months of their own');

select pg_temp.act_as(:cara);
select throws_ok($$insert into public.finance_entries (month, money_in) values ('2026-09-01', 5)$$,
  '42501', null, 'someone who has not joined cannot add numbers');

-- ---------- Shared spreadsheets ----------
-- Pretend three files were uploaded to storage.
select pg_temp.act_as_owner_of_db();
insert into storage.objects (bucket_id, name, metadata) values
  ('shared', '00000000-0000-0000-0000-000000000002/a-budget.xlsx', '{"size": 1200}'),
  ('shared', '00000000-0000-0000-0000-000000000002/b-notes.pdf',   '{"size": 100}'),
  ('shared', '00000000-0000-0000-0000-000000000001/c-template.csv', '{"size": 50}');

select pg_temp.act_as(:ann);
select lives_ok($$select public.share_file('00000000-0000-0000-0000-000000000002/a-budget.xlsx', 'My budget', 'budget.xlsx')$$,
  'a participant can share a spreadsheet');
select is((select status::text from public.shared_files where title = 'My budget'), 'pending', 'it waits for approval');
select throws_ok($$select public.share_file('00000000-0000-0000-0000-000000000002/b-notes.pdf', 'Notes', 'notes.pdf')$$,
  'P0001', 'file_not_allowed', 'a file that is not a spreadsheet is refused');
select throws_ok($$select public.share_file('00000000-0000-0000-0000-000000000001/c-template.csv', 'Stolen', 'c.csv')$$,
  'P0001', 'file_not_allowed', 'a file from someone else''s folder cannot be shared');
select throws_ok($$select public.share_file('00000000-0000-0000-0000-000000000002/ghost.xlsx', 'Ghost', 'ghost.xlsx')$$,
  'P0001', 'file_missing', 'a file that was never uploaded cannot be shared');
select throws_ok($$select public.review_shared_file((select id from public.shared_files limit 1), true)$$,
  '42501', null, 'a participant cannot approve their own file');
select throws_ok($$update public.shared_files set status = 'approved'$$, '42501', null, 'the status cannot be set directly');

select pg_temp.act_as(:bob);
select is((select count(*)::int from public.shared_files), 0, 'others cannot see a file that is waiting for approval');
select ok(not private.can_read_shared_object('00000000-0000-0000-0000-000000000002/a-budget.xlsx'), 'and cannot download it');

select pg_temp.act_as(:boss);
select lives_ok($$select public.review_shared_file((select id from public.shared_files where title = 'My budget'), true)$$, 'the admin can approve');
select public.share_file('00000000-0000-0000-0000-000000000001/c-template.csv', 'Template', 'template.csv');
select is((select status::text from public.shared_files where title = 'Template'), 'approved', 'the admin''s own files are approved at once');

select pg_temp.act_as(:bob);
select is((select count(*)::int from public.shared_files), 2, 'after approval everyone who has joined can see the files');
select ok(private.can_read_shared_object('00000000-0000-0000-0000-000000000002/a-budget.xlsx'), 'and can download them');

select pg_temp.act_as(:cara);
select is((select count(*)::int from public.shared_files), 0, 'someone who has not joined sees no shared files');

select * from finish();
rollback;
