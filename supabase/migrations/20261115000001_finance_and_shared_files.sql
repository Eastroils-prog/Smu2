-- =============================================================================
-- Money tracking and shared spreadsheets
--
-- Rules enforced here:
--   * Money numbers are private: a participant sees and edits only their own
--     months; the administrator can read everyone's but cannot change them.
--   * Anyone who has joined can upload a spreadsheet. It is visible only to
--     the uploader and the administrator until the administrator approves it.
--     Approved files are readable by everyone who has joined.
--   * Only spreadsheet files (.xlsx, .xls, .csv) are accepted.
-- =============================================================================

-- Someone who has joined and is not archived (the admin, or a participant).
create function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status <> 'invited' and archived_at is null
  );
$$;
revoke all on function private.is_member() from public;
grant execute on function private.is_member() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- Money: one row per participant per month
-- -----------------------------------------------------------------------------
create table public.finance_entries (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  month          date not null check (month = date_trunc('month', month)::date and month >= date '2000-01-01'),
  money_in       numeric(12, 2) not null default 0 check (money_in  between 0 and 9999999999.99),
  money_out      numeric(12, 2) not null default 0 check (money_out between 0 and 9999999999.99),
  note           text check (char_length(note) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint finance_entries_one_per_month unique (participant_id, month)
);

create trigger finance_entries_set_updated_at before update on public.finance_entries
  for each row execute function private.set_updated_at();

-- A month that has not started yet cannot be filled in.
create function private.finance_entries_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.month > date_trunc('month', now())::date then
    raise exception 'month_in_future' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger finance_entries_guard before insert or update on public.finance_entries
  for each row execute function private.finance_entries_guard();

alter table public.finance_entries enable row level security;
create policy "finance: read own, or all as admin"
  on public.finance_entries for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
create policy "finance: participants add their own months"
  on public.finance_entries for insert to authenticated
  with check (participant_id = (select auth.uid()) and (select private.is_active_participant()));
create policy "finance: participants change their own months"
  on public.finance_entries for update to authenticated
  using      (participant_id = (select auth.uid()) and (select private.is_active_participant()))
  with check (participant_id = (select auth.uid()) and (select private.is_active_participant()));
create policy "finance: participants remove their own months"
  on public.finance_entries for delete to authenticated
  using (participant_id = (select auth.uid()) and (select private.is_active_participant()));


-- -----------------------------------------------------------------------------
-- Shared spreadsheets
-- -----------------------------------------------------------------------------
create type public.shared_file_status as enum ('pending', 'approved', 'rejected');

create table public.shared_files (
  id           uuid primary key default gen_random_uuid(),
  uploader_id  uuid not null references public.profiles (id) on delete cascade,
  title        text not null check (char_length(btrim(title)) between 1 and 120),
  file_name    text not null check (char_length(file_name) between 1 and 255),
  storage_path text not null unique,
  size_bytes   bigint not null check (size_bytes between 0 and 10485760),
  status       public.shared_file_status not null default 'pending',
  review_note  text check (char_length(review_note) <= 1000),
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index shared_files_status_idx      on public.shared_files (status, created_at desc);
create index shared_files_uploader_idx    on public.shared_files (uploader_id);
create index shared_files_reviewed_by_idx on public.shared_files (reviewed_by);

alter table public.shared_files enable row level security;
create policy "shared files: own, approved for members, or all as admin"
  on public.shared_files for select to authenticated
  using (
    uploader_id = (select auth.uid())
    or (select private.is_admin())
    or (status = 'approved' and (select private.is_member()))
  );
-- No writes through the API. See share_file / review_shared_file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shared', 'shared', false, 10485760, array[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv'
])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Whether the signed-in person may read one object in the `shared` bucket.
create function private.can_read_shared_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shared_files f
    where f.storage_path = p_name
      and (f.uploader_id = (select auth.uid())
           or private.is_admin()
           or (f.status = 'approved' and private.is_member()))
  );
$$;
revoke all on function private.can_read_shared_object(text) from public;
grant execute on function private.can_read_shared_object(text) to authenticated, service_role;

-- Path convention: <uploader id>/<random id>-<file name>.<xlsx|xls|csv>
create policy "shared bucket: members upload into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shared'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) in ('xlsx', 'xls', 'csv')
    and (select private.is_member())
  );
create policy "shared bucket: read own uploads, approved files, or all as admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'shared'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or private.can_read_shared_object(name))
  );
-- No update or delete policies: an approved file cannot be swapped afterwards.

-- Register an uploaded file. The administrator's own files are approved at once.
create function public.share_file(p_path text, p_title text, p_file_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_meta jsonb;
  v_id uuid;
  v_admin boolean := private.is_admin();
begin
  if v_uid is null or not private.is_member() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_path is null or left(p_path, 37) <> v_uid::text || '/' or p_path !~* '\.(xlsx|xls|csv)$' then
    raise exception 'file_not_allowed' using errcode = 'P0001';
  end if;
  select metadata into v_meta from storage.objects where bucket_id = 'shared' and name = p_path;
  if not found then
    raise exception 'file_missing' using errcode = 'P0001';
  end if;

  insert into public.shared_files (uploader_id, title, file_name, storage_path, size_bytes, status, reviewed_at, reviewed_by)
  values (v_uid, btrim(p_title),
          left(coalesce(nullif(btrim(p_file_name), ''), 'spreadsheet'), 255),
          p_path, coalesce((v_meta ->> 'size')::bigint, 0),
          case when v_admin then 'approved'::public.shared_file_status else 'pending'::public.shared_file_status end,
          case when v_admin then now() end,
          case when v_admin then v_uid end)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'file_already_shared' using errcode = 'P0001';
end $$;

-- Approve, refuse, or later take down a shared file. Administrator only.
create function public.review_shared_file(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only the administrator can review shared files' using errcode = '42501';
  end if;
  update public.shared_files
  set status = case when p_approve then 'approved'::public.shared_file_status else 'rejected'::public.shared_file_status end,
      review_note = nullif(btrim(coalesce(p_note, '')), ''),
      reviewed_at = now(),
      reviewed_by = (select auth.uid())
  where id = p_id;
  if not found then
    raise exception 'file_not_found' using errcode = 'P0001';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on public.finance_entries, public.shared_files from anon, authenticated;
revoke execute on function public.share_file(text, text, text), public.review_shared_file(uuid, boolean, text)
  from public, anon, authenticated;

grant select, delete on public.finance_entries to authenticated;
grant insert (participant_id, month, money_in, money_out, note) on public.finance_entries to authenticated;
grant update (money_in, money_out, note)                        on public.finance_entries to authenticated;

grant select on public.shared_files to authenticated;
grant execute on function public.share_file(text, text, text)               to authenticated;
grant execute on function public.review_shared_file(uuid, boolean, text)    to authenticated;

grant all on public.finance_entries, public.shared_files to service_role;
