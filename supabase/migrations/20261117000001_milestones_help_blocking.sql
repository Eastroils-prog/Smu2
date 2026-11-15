-- =============================================================================
-- Milestones, "ask for help", and blocking or deleting a participant
--
-- Rules enforced here:
--   * Only the administrator sets milestones and marks them reached.
--     A participant reads their own.
--   * A participant can ask for help (one open request at a time); only the
--     administrator can see requests and mark them handled.
--   * A blocked participant is treated like someone who has left: they cannot
--     sign in, write anything, appear in the directory or be written to.
--   * Blocking and deleting go through the `manage-account` Edge Function,
--     which asks `account_action_target` (as the caller) for permission.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Blocking
-- -----------------------------------------------------------------------------
alter table public.profiles add column blocked_at timestamptz;
alter table public.profiles add constraint profiles_admin_never_blocked check (role = 'participant' or blocked_at is null);

-- A blocked person counts as neither an active participant nor a member.
create or replace function private.is_active_participant() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'participant'
      and status <> 'invited'
      and archived_at is null
      and blocked_at is null
  );
$$;

create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status <> 'invited' and archived_at is null and blocked_at is null
  );
$$;

create or replace function private.can_message(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = p_id and status <> 'invited' and archived_at is null and blocked_at is null
  );
$$;

create or replace function public.directory()
returns table (id uuid, full_name text, is_owner boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.role = 'admin'
  from public.profiles p
  where p.status <> 'invited' and p.archived_at is null and p.blocked_at is null
    and p.id <> (select auth.uid())
    and exists (select 1 from public.profiles me
                where me.id = (select auth.uid()) and me.status <> 'invited' and me.blocked_at is null)
  order by (p.role = 'admin') desc, p.full_name;
$$;

-- A blocked username is never looked up, so signing in fails like a wrong password.
create or replace function public.sign_in_begin(p_username text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(btrim(p_username));
  v_failures integer;
begin
  if v_username !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
    return null;
  end if;

  select count(*) into v_failures
  from private.sign_in_attempts
  where username = v_username and not succeeded and attempted_at > now() - interval '15 minutes';
  if v_failures >= 5 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;

  return (select email::text from public.profiles
          where username::text = v_username and status <> 'invited' and blocked_at is null);
end $$;

-- The owner may block or delete a participant who exists. Returns their e-mail.
create function public.account_action_target(p_profile_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  if not private.is_admin() then
    raise exception 'only the administrator can do this' using errcode = '42501';
  end if;
  select email::text into v_email from public.profiles where id = p_profile_id and role = 'participant';
  if v_email is null then
    raise exception 'person_not_found' using errcode = 'P0001';
  end if;
  return v_email;
end $$;

create function public.set_blocked(p_profile_id uuid, p_blocked boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only the administrator can do this' using errcode = '42501';
  end if;
  update public.profiles set blocked_at = case when p_blocked then now() end
  where id = p_profile_id and role = 'participant';
  if not found then
    raise exception 'person_not_found' using errcode = 'P0001';
  end if;
end $$;

-- Every stored file of one person, so they can be removed before the account is deleted.
create function public.account_files(p_profile_id uuid) returns table (bucket text, path text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only the administrator can do this' using errcode = '42501';
  end if;
  return query
    select o.bucket_id::text, o.name::text
    from storage.objects o
    where o.bucket_id in ('submissions', 'shared') and o.name like p_profile_id::text || '/%';
end $$;


-- -----------------------------------------------------------------------------
-- Milestones
-- -----------------------------------------------------------------------------
create table public.milestones (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.profiles (id) on delete cascade,
  stage_id       uuid references public.stages (id) on delete set null,
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  achieved_at    timestamptz,
  achieved_by    uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  constraint milestones_achieved_consistent check ((achieved_at is null) = (achieved_by is null))
);
create index milestones_participant_idx on public.milestones (participant_id, stage_id);
create index milestones_stage_idx       on public.milestones (stage_id);
create index milestones_achieved_by_idx on public.milestones (achieved_by);

alter table public.milestones enable row level security;
create policy "milestones: read own, or all as admin"
  on public.milestones for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
create policy "milestones: admin deletes"
  on public.milestones for delete to authenticated
  using ((select private.is_admin()));

-- A new milestone belongs to the person's current stage.
create function public.add_milestone(p_profile_id uuid, p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_stage uuid;
begin
  if not private.is_admin() then
    raise exception 'only the administrator can set milestones' using errcode = '42501';
  end if;
  select current_stage_id into v_stage from public.profiles where id = p_profile_id and role = 'participant' and status <> 'invited';
  if not found then
    raise exception 'person_not_found' using errcode = 'P0001';
  end if;
  insert into public.milestones (participant_id, stage_id, title)
  values (p_profile_id, v_stage, btrim(p_title))
  returning id into v_id;
  return v_id;
end $$;

create function public.set_milestone_reached(p_id uuid, p_reached boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only the administrator can mark milestones' using errcode = '42501';
  end if;
  update public.milestones
  set achieved_at = case when p_reached then now() end,
      achieved_by = case when p_reached then (select auth.uid()) end
  where id = p_id;
  if not found then
    raise exception 'milestone_not_found' using errcode = 'P0001';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- Asking for help
-- -----------------------------------------------------------------------------
create table public.help_requests (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body           text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid references public.profiles (id),
  constraint help_requests_resolved_consistent check ((resolved_at is null) = (resolved_by is null))
);
create index help_requests_participant_idx on public.help_requests (participant_id, created_at desc);
create index help_requests_open_idx        on public.help_requests (created_at) where resolved_at is null;
create index help_requests_resolved_by_idx on public.help_requests (resolved_by);
-- One open request per person at a time.
create unique index help_requests_one_open_idx on public.help_requests (participant_id) where resolved_at is null;

alter table public.help_requests enable row level security;
create policy "help: read own, or all as admin"
  on public.help_requests for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
create policy "help: participants ask for themselves"
  on public.help_requests for insert to authenticated
  with check (participant_id = (select auth.uid()) and (select private.is_active_participant()));

create function public.resolve_help_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only the administrator can do this' using errcode = '42501';
  end if;
  update public.help_requests set resolved_at = now(), resolved_by = (select auth.uid())
  where id = p_id and resolved_at is null;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on public.milestones, public.help_requests from anon, authenticated;
revoke execute on function
  public.account_action_target(uuid), public.set_blocked(uuid, boolean), public.account_files(uuid),
  public.add_milestone(uuid, text), public.set_milestone_reached(uuid, boolean), public.resolve_help_request(uuid)
  from public, anon, authenticated;
revoke execute on function public.directory(), public.sign_in_begin(text) from public, anon, authenticated;

grant select, delete on public.milestones to authenticated;
grant select on public.help_requests to authenticated;
grant insert (participant_id, body) on public.help_requests to authenticated;

grant execute on function public.directory()                              to authenticated;
grant execute on function public.sign_in_begin(text)                      to service_role;
grant execute on function public.account_action_target(uuid)              to authenticated;
grant execute on function public.set_blocked(uuid, boolean)               to authenticated;
grant execute on function public.account_files(uuid)                      to authenticated;
grant execute on function public.add_milestone(uuid, text)                to authenticated;
grant execute on function public.set_milestone_reached(uuid, boolean)     to authenticated;
grant execute on function public.resolve_help_request(uuid)               to authenticated;

grant all on public.milestones, public.help_requests to service_role;
