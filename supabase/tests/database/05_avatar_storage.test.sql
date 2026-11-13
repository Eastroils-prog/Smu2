-- Access policies of the private `avatars` bucket.
begin;
\ir _helpers.sql.inc
select plan(17);

select tests.seed_people();

-- The Storage API sets this for its own transactions; without it Supabase blocks
-- every direct DELETE on storage tables before the policies are even consulted.
select set_config('storage.allow_delete_query', 'true', true);

select is((select public from storage.buckets where id = 'avatars'), false, 'the avatars bucket is private');
select is((select file_size_limit from storage.buckets where id = 'avatars'), 2097152::bigint, 'avatars are limited to 2 MB');

-- fixtures written by the owner role
insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars', tests.uid('admin@t.test') || '/admin.png', tests.uid('admin@t.test')::text),
  ('avatars', tests.uid('bob@t.test')   || '/bob.png',   tests.uid('bob@t.test')::text);

select tests.login_anon();
select is_empty($$ select 1 from storage.objects where bucket_id = 'avatars' $$, 'anon sees no avatars');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('avatars', 'anon/a.png') $$,
  '42501', null, 'anon cannot upload an avatar');

select tests.login_as('alice@t.test');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('avatars', auth.uid() || '/me.png', auth.uid()::text) $$,
  'a participant can upload into their own folder');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('avatars', %L) $$, tests.uid('bob@t.test') || '/evil.png'),
  '42501', null, 'a participant cannot upload into someone else''s folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('avatars', 'loose.png') $$,
  '42501', null, 'a participant cannot upload outside a user folder');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'avatars' order by name $$,
  format($$ select * from (values (%L), (%L)) v order by 1 $$,
         tests.uid('admin@t.test') || '/admin.png', tests.uid('alice@t.test') || '/me.png'),
  'a participant sees their own avatar and the admin''s, nothing else');
select lives_ok(
  $$ update storage.objects set metadata = '{"replaced": true}' where bucket_id = 'avatars' and name = auth.uid() || '/me.png' $$,
  'a participant can replace their own avatar');

update storage.objects set metadata = '{"hacked": true}' where bucket_id = 'avatars' and name like '%/bob.png';
delete from storage.objects where bucket_id = 'avatars' and name like '%/bob.png';
delete from storage.objects where bucket_id = 'avatars' and name like '%/admin.png';
select tests.logout();
select is((select metadata from storage.objects where name like '%/bob.png'), null, 'a participant cannot overwrite another avatar');
select is((select count(*) from storage.objects where bucket_id = 'avatars' and (name like '%/bob.png' or name like '%/admin.png')),
  2::bigint, 'a participant cannot delete other people''s avatars');

select tests.login_as('bob@t.test');
select is_empty(format($$ select 1 from storage.objects where name = %L $$, tests.uid('alice@t.test') || '/me.png'),
  'another participant cannot see that avatar');

select tests.login_as('admin@t.test');
select is((select count(*) from storage.objects where bucket_id = 'avatars'), 3::bigint, 'the admin sees every avatar');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('avatars', %L) $$, tests.uid('bob@t.test') || '/by-admin.png'),
  '42501', null, 'the admin cannot upload into a participant''s avatar folder');
delete from storage.objects where bucket_id = 'avatars' and name like '%/bob.png';
select tests.logout();
select is((select count(*) from storage.objects where name like '%/bob.png'), 1::bigint,
  'the admin cannot delete a participant''s avatar');

select tests.login_as('alice@t.test');
select lives_ok(
  $$ delete from storage.objects where bucket_id = 'avatars' and name = auth.uid() || '/me.png' $$,
  'a participant can delete their own avatar');
select tests.logout();
select is((select count(*) from storage.objects where name like '%/me.png'), 0::bigint, 'and it is gone');

select * from finish();
rollback;
