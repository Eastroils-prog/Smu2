-- =============================================================================
-- Phase 1 — accounts, usernames, invitations, stages, settings
--
-- Rules enforced here (the database is the security boundary):
--   * Exactly one administrator can exist, and only the database owner can
--     create it (private.provision_admin). No API call can grant the role.
--   * Nobody can create an account without a pending invitation.
--   * A participant can read only their own profile and edit only their own
--     name, avatar, business idea and goals.
--   * People sign in with a username. The username -> e-mail lookup is only
--     available to server-side code, and failed attempts are rate-limited.
-- =============================================================================

create extension if not exists citext with schema extensions;

-- Supabase grants new public tables and functions to the API roles by default.
-- Turn that off: everything below is granted explicitly.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.user_role          as enum ('admin', 'participant');
create type public.participant_status as enum ('invited', 'active', 'completed');
create type public.invitation_status  as enum ('pending', 'accepted', 'revoked', 'expired');

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;


-- -----------------------------------------------------------------------------
-- Stages
-- -----------------------------------------------------------------------------
create table public.stages (
  id          uuid primary key default gen_random_uuid(),
  position    integer not null,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint stages_position_key unique (position) deferrable initially deferred
);

insert into public.stages (position, name, description) values
  (1, 'Business idea',            'Define the problem, the customer and the core idea.'),
  (2, 'Market research',          'Understand the market, competitors and demand.'),
  (3, 'Business planning',        'Business model, finances and a written plan.'),
  (4, 'Product development',      'Build the first version of the product or service.'),
  (5, 'Marketing and validation', 'Test with real customers and refine the offer.'),
  (6, 'Launch preparation',       'Legal, operational and go-to-market readiness.');

create trigger stages_set_updated_at before update on public.stages
  for each row execute function private.set_updated_at();


-- -----------------------------------------------------------------------------
-- Profiles (one row per person: the single admin + every participant)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  -- `role` is not writable through the API and is only ever set by
  -- private.provision_admin(), run by the database owner.
  role             public.user_role not null default 'participant',
  -- The sign-in name. Chosen when the invitation is accepted; NULL until then.
  username         extensions.citext unique
                   check (username is null or username::text ~ '^[a-z0-9][a-z0-9._]{2,29}$'),
  email            extensions.citext not null unique,          -- mirrored from auth.users
  full_name        text not null check (char_length(btrim(full_name)) between 1 and 120),
  avatar_path      text,
  business_idea    text check (char_length(business_idea) <= 5000),
  current_goals    text check (char_length(current_goals) <= 5000),
  current_stage_id uuid references public.stages (id) on delete restrict,
  status           public.participant_status not null default 'invited',
  joined_at        timestamptz,
  archived_at      timestamptz,
  last_active_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint profiles_admin_has_no_program_fields
    check (role = 'participant' or (current_stage_id is null and archived_at is null)),
  constraint profiles_active_has_username
    check (status = 'invited' or username is not null)
);

create unique index profiles_single_admin_idx on public.profiles (role) where role = 'admin';
create index profiles_stage_idx       on public.profiles (current_stage_id);
create index profiles_last_active_idx on public.profiles (last_active_at);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create function private.is_active_participant() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'participant'
      and status <> 'invited'
      and archived_at is null
  );
$$;

revoke all on function private.is_admin(), private.is_active_participant() from public;
grant execute on function private.is_admin(), private.is_active_participant() to authenticated, service_role;

-- Column-level rules that row level security cannot express.
create function private.profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  participant_editable constant text[] :=
    array['full_name', 'avatar_path', 'business_idea', 'current_goals', 'updated_at'];
  trusted constant text[] :=
    array['postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role'];
begin
  if new.id is distinct from old.id then
    raise exception 'profile id is immutable' using errcode = '42501';
  end if;

  -- Not even the service role (Edge Functions) may hand out the admin role.
  if new.role is distinct from old.role and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'role cannot be changed' using errcode = '42501';
  end if;

  if not (current_user = any (trusted)) then
    if private.is_admin() then
      -- The admin manages participants but cannot rewrite identity columns.
      if (new.username::text, new.email::text, new.joined_at) is distinct from (old.username::text, old.email::text, old.joined_at) then
        raise exception 'username, e-mail and join date cannot be edited here' using errcode = '42501';
      end if;
    else
      -- An archived or not-yet-joined participant is read-only.
      if old.archived_at is not null or old.status = 'invited' then
        raise exception 'this account is read-only' using errcode = '42501';
      end if;
      -- Whitelist: anything not listed is admin-only, including future columns.
      if (to_jsonb(new) - participant_editable) is distinct from (to_jsonb(old) - participant_editable) then
        raise exception 'participants may only edit their name, avatar, business idea and goals'
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function private.profiles_guard();

alter table public.profiles enable row level security;

create policy "profiles: read own row, or every row as admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy "profiles: update own row, or any participant as admin"
  on public.profiles for update to authenticated
  using      (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));
-- No INSERT / DELETE through the API. Rows are created by the auth.users trigger.

alter table public.stages enable row level security;
create policy "stages: readable by signed-in users"
  on public.stages for select to authenticated using (true);
create policy "stages: admin manages"
  on public.stages for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- Invitations
-- -----------------------------------------------------------------------------
create table public.participant_invitations (
  id               uuid primary key default gen_random_uuid(),
  email            extensions.citext not null
                   check (email::text ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and email::text = lower(email::text) and char_length(email::text) <= 254),
  full_name        text not null check (char_length(btrim(full_name)) between 1 and 120),
  status           public.invitation_status not null default 'pending',
  initial_stage_id uuid references public.stages (id) on delete set null,
  invited_by       uuid not null references public.profiles (id),
  profile_id       uuid references public.profiles (id) on delete set null,
  expires_at       timestamptz not null default (now() + interval '14 days'),
  accepted_at      timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint invitations_accepted_consistent check ((status = 'accepted') = (accepted_at is not null)),
  constraint invitations_revoked_consistent  check ((status = 'revoked')  = (revoked_at is not null))
);
create unique index invitations_pending_email_idx
  on public.participant_invitations (email) where status = 'pending';
create index invitations_profile_idx    on public.participant_invitations (profile_id);
create index invitations_invited_by_idx on public.participant_invitations (invited_by);
create index invitations_stage_idx      on public.participant_invitations (initial_stage_id);

alter table public.participant_invitations enable row level security;
create policy "invitations: admin reads"
  on public.participant_invitations for select to authenticated
  using ((select private.is_admin()));
-- No writes through the API. See create_invitation / revoke_invitation below.


-- -----------------------------------------------------------------------------
-- Settings (single row)
-- -----------------------------------------------------------------------------
create table public.app_settings (
  id                     boolean primary key default true check (id),
  program_name           text not null default 'VentureTrack' check (char_length(btrim(program_name)) between 1 and 80),
  inactivity_days        integer not null default 7 check (inactivity_days between 1 and 365),
  message_retention_days integer check (message_retention_days is null or message_retention_days >= 30),
  timezone               text not null default 'UTC',
  updated_at             timestamptz not null default now()
);
insert into public.app_settings default values;

create trigger app_settings_set_updated_at before update on public.app_settings
  for each row execute function private.set_updated_at();

alter table public.app_settings enable row level security;
create policy "settings: readable by signed-in users"
  on public.app_settings for select to authenticated using (true);
create policy "settings: admin updates"
  on public.app_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- New accounts: only with a pending invitation
-- -----------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  inv public.participant_invitations;
begin
  -- Bootstrap: the very first account (created by the owner in the Supabase
  -- dashboard) is allowed without an invitation. It is an ordinary
  -- unprivileged account until private.provision_admin() is run.
  if not exists (select 1 from public.profiles) then
    insert into public.profiles (id, email, full_name)
    values (new.id, new.email, coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 'Administrator'));
    return new;
  end if;

  select * into inv
  from public.participant_invitations
  where email::text = lower(new.email) and status = 'pending' and expires_at > now()
  for update;

  if not found then
    raise exception 'VentureTrack is invitation-only: no pending invitation for this e-mail address'
      using errcode = '42501';
  end if;

  insert into public.profiles (id, email, full_name, current_stage_id)
  values (new.id, new.email, inv.full_name, inv.initial_stage_id);

  update public.participant_invitations set profile_id = new.id where id = inv.id;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keep profiles.email in step with the auth record.
create function private.sync_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function private.sync_user_email();

revoke all on function private.handle_new_user(), private.sync_user_email() from public;


-- -----------------------------------------------------------------------------
-- The single administrator. Run once, by hand, as the database owner:
--   select private.provision_admin('you@example.com', 'yourusername');
-- -----------------------------------------------------------------------------
create function private.provision_admin(p_email text, p_username text) returns void
language plpgsql set search_path = '' as $$
declare
  uid uuid;
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'only the database owner can provision the administrator' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'an administrator already exists';
  end if;

  select id into uid from auth.users
  where email = lower(btrim(p_email)) and email_confirmed_at is not null;
  if uid is null then
    raise exception 'no confirmed account with that e-mail address';
  end if;
  if exists (select 1 from auth.users where id <> uid) then
    raise exception 'other accounts already exist; the administrator must be the first account';
  end if;

  update public.profiles
  set role = 'admin', username = lower(btrim(p_username)), status = 'active',
      current_stage_id = null, joined_at = now()
  where id = uid;
  if not found then
    raise exception 'that account has no profile';
  end if;
end $$;

revoke all on function private.provision_admin(text, text) from public;


-- -----------------------------------------------------------------------------
-- Invitations: created and revoked by the admin (called by the Edge Function
-- with the admin's own token, so the check below is the authorization).
-- -----------------------------------------------------------------------------
create function public.create_invitation(p_email text, p_full_name text, p_stage_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'only the administrator can invite people' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where email::text = v_email) then
    raise exception 'email_in_use' using errcode = 'P0001';
  end if;

  -- An expired invitation no longer blocks a new one for the same address.
  update public.participant_invitations set status = 'expired'
  where email::text = v_email and status = 'pending' and expires_at <= now();

  insert into public.participant_invitations (email, full_name, initial_stage_id, invited_by)
  values (v_email, btrim(p_full_name),
          coalesce(p_stage_id, (select id from public.stages where not is_archived order by position limit 1)),
          (select auth.uid()))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'already_invited' using errcode = 'P0001';
end $$;

create function public.revoke_invitation(p_invitation_id uuid)
returns table (email text, full_name text, initial_stage_id uuid, profile_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only the administrator can revoke invitations' using errcode = '42501';
  end if;
  return query
    update public.participant_invitations i
    set status = 'revoked', revoked_at = now()
    where i.id = p_invitation_id and i.status = 'pending'
    returning i.email::text, i.full_name, i.initial_stage_id, i.profile_id;
end $$;

-- Called by the invited person, once, after they have chosen a password.
create function public.accept_invitation(p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_username text := lower(btrim(p_username));
  reserved constant text[] := array['admin', 'administrator', 'owner', 'root', 'support', 'system', 'venturetrack'];
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
    raise exception 'username_invalid' using errcode = 'P0001';
  end if;
  if v_username = any (reserved) then
    raise exception 'username_taken' using errcode = 'P0001';
  end if;

  update public.participant_invitations
  set status = 'accepted', accepted_at = now()
  where profile_id = v_uid and status = 'pending' and expires_at > now();
  if not found then
    raise exception 'invitation_not_valid' using errcode = 'P0001';
  end if;

  begin
    update public.profiles
    set username = v_username, status = 'active', joined_at = now(), last_active_at = now()
    where id = v_uid and status = 'invited';
  exception when unique_violation then
    raise exception 'username_taken' using errcode = 'P0001';
  end;
end $$;

create function public.touch_last_active() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_active_at = now()
  where id = (select auth.uid())
    and (last_active_at is null or last_active_at < now() - interval '5 minutes');
$$;


-- -----------------------------------------------------------------------------
-- Username sign-in. Only the server-side `sign-in` function may call these.
-- Five wrong passwords for one username within 15 minutes locks that username
-- for the rest of the window, whether or not the username exists.
-- -----------------------------------------------------------------------------
create table private.sign_in_attempts (
  id           bigint generated always as identity primary key,
  username     text not null,
  succeeded    boolean not null,
  attempted_at timestamptz not null default now()
);
create index sign_in_attempts_lookup_idx on private.sign_in_attempts (username, attempted_at desc);

create function public.sign_in_begin(p_username text) returns text
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

  return (select email::text from public.profiles where username::text = v_username and status <> 'invited');
end $$;

create function public.sign_in_finish(p_username text, p_succeeded boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(btrim(p_username));
begin
  if v_username !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
    return;
  end if;
  if p_succeeded then
    delete from private.sign_in_attempts where username = v_username;
  else
    insert into private.sign_in_attempts (username, succeeded) values (v_username, false);
  end if;
  delete from private.sign_in_attempts where attempted_at < now() - interval '1 day';
end $$;


-- -----------------------------------------------------------------------------
-- Privileges — the complete Data API surface for this phase
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_path, business_idea, current_goals,   -- participant + admin
              current_stage_id, status, archived_at)                   -- admin only (profiles_guard)
  on public.profiles to authenticated;

grant select on public.participant_invitations to authenticated;

grant select on public.app_settings to authenticated;
grant update (program_name, inactivity_days, message_retention_days, timezone)
  on public.app_settings to authenticated;

grant select, insert, update, delete on public.stages to authenticated;

grant execute on function public.create_invitation(text, text, uuid) to authenticated;
grant execute on function public.revoke_invitation(uuid)             to authenticated;
grant execute on function public.accept_invitation(text)             to authenticated;
grant execute on function public.touch_last_active()                 to authenticated;

grant execute on function public.sign_in_begin(text)           to service_role;
grant execute on function public.sign_in_finish(text, boolean) to service_role;

grant all on all tables in schema public to service_role;
