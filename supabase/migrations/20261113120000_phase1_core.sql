-- =============================================================================
-- Phase 1 — core tables: stages, profiles, participant invitations, settings
--
-- Conventions (apply to every migration in this project)
--   * Row Level Security is enabled on every table in `public`.
--   * Privileges are granted explicitly; nothing relies on default grants.
--     The anonymous role gets no access to any table.
--   * `private` holds helpers that are never exposed through the Data API.
-- =============================================================================

create extension if not exists citext with schema extensions;

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
-- Stages (admin-customisable development stages)
-- -----------------------------------------------------------------------------
create table public.stages (
  id          uuid primary key default gen_random_uuid(),
  position    integer not null,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- deferrable so stages can be re-ordered inside one transaction
  constraint stages_position_key unique (position) deferrable initially deferred
);

create trigger stages_set_updated_at before update on public.stages
  for each row execute function private.set_updated_at();

insert into public.stages (position, name, description) values
  (1, 'Business idea',            'Define the problem, the customer and the core idea.'),
  (2, 'Market research',          'Understand the market, competitors and demand.'),
  (3, 'Business planning',        'Business model, finances and a written plan.'),
  (4, 'Product development',      'Build the first version of the product or service.'),
  (5, 'Marketing and validation', 'Test with real customers and refine the offer.'),
  (6, 'Launch preparation',       'Legal, operational and go-to-market readiness.');


-- -----------------------------------------------------------------------------
-- Profiles (one row per person: the single admin + every participant)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  -- `role` is NOT writable through the API (no column privilege, see the end of
  -- this file) and is only ever set by private.provision_admin(), run by the
  -- database owner.
  role             public.user_role not null default 'participant',
  email            extensions.citext not null unique,          -- mirrored from auth.users by trigger
  full_name        text not null check (char_length(btrim(full_name)) between 1 and 120),
  avatar_path      text,                                        -- object path in the `avatars` bucket
  business_idea    text check (char_length(business_idea) <= 5000),
  current_goals    text check (char_length(current_goals) <= 5000),
  current_stage_id uuid references public.stages (id) on delete restrict,
  status           public.participant_status not null default 'invited',
  joined_at        timestamptz,                                 -- set when the invitation is accepted
  archived_at      timestamptz,                                 -- archived = hidden by default + read-only
  last_active_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint profiles_admin_has_no_program_fields
    check (role = 'participant' or (current_stage_id is null and archived_at is null))
);

-- At most ONE administrator can ever exist.
create unique index profiles_single_admin_idx on public.profiles (role) where role = 'admin';
create index profiles_stage_idx       on public.profiles (current_stage_id);
create index profiles_last_active_idx on public.profiles (last_active_at);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- Authorization helpers used by every policy. SECURITY DEFINER so they can read
-- `profiles` without recursing into its own RLS; search_path is pinned.
create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- A participant who may write: accepted their invitation and is not archived.
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

create function private.admin_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where role = 'admin';
$$;

revoke all on function private.is_admin(), private.is_active_participant(), private.admin_id() from public;
grant execute on function private.is_admin(), private.is_active_participant(), private.admin_id()
  to authenticated, service_role;

-- Column-level rules that RLS cannot express (RLS is row-level only).
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

  -- Whitelist: anything not listed above is admin-only, including future columns.
  if not (current_user = any (trusted)) and not private.is_admin() then
    if (to_jsonb(new) - participant_editable) is distinct from (to_jsonb(old) - participant_editable) then
      raise exception 'participants may only edit their name, avatar, business idea and goals'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function private.profiles_guard();

alter table public.profiles enable row level security;

-- Participants see themselves and the admin (name/avatar for the chat header).
create policy "profiles: read self, the admin, or everything as admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or role = 'admin' or (select private.is_admin()));

-- Archived or not-yet-onboarded participants are read-only.
create policy "profiles: update self when active, or anyone as admin"
  on public.profiles for update to authenticated
  using (
    (select private.is_admin())
    or (id = (select auth.uid()) and (select private.is_active_participant()))
  )
  with check (
    (select private.is_admin())
    or (id = (select auth.uid()) and (select private.is_active_participant()))
  );
-- API writes: no INSERT / DELETE. Rows are created by the auth.users trigger.

alter table public.stages enable row level security;
create policy "stages: readable by signed-in users"
  on public.stages for select to authenticated using (true);
create policy "stages: admin manages"
  on public.stages for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- Participant invitations
-- -----------------------------------------------------------------------------
create table public.participant_invitations (
  id               uuid primary key default gen_random_uuid(),
  email            extensions.citext not null,
  full_name        text not null check (char_length(btrim(full_name)) between 1 and 120),
  status           public.invitation_status not null default 'pending',
  initial_stage_id uuid references public.stages (id) on delete set null,
  invited_by       uuid not null references public.profiles (id),
  profile_id       uuid references public.profiles (id) on delete set null,
  -- Mirrors the lifetime of the one-time link in the invitation e-mail.
  expires_at       timestamptz not null default (now() + interval '24 hours'),
  accepted_at      timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint invitations_accepted_consistent check ((status = 'accepted') = (accepted_at is not null)),
  constraint invitations_revoked_consistent  check ((status = 'revoked')  = (revoked_at is not null))
);
-- Only one open invitation per e-mail address.
create unique index invitations_pending_email_idx
  on public.participant_invitations (email) where status = 'pending';
create index invitations_profile_idx on public.participant_invitations (profile_id);

alter table public.participant_invitations enable row level security;
create policy "invitations: admin reads"
  on public.participant_invitations for select to authenticated
  using ((select private.is_admin()));
-- API writes: none. Created, re-sent and revoked only by the `invite-participant`
-- Edge Function, which runs with the service role after checking the caller.


-- -----------------------------------------------------------------------------
-- Application settings (singleton row)
-- -----------------------------------------------------------------------------
create table public.app_settings (
  id                     boolean primary key default true check (id),   -- exactly one row
  program_name           text not null default 'VentureTrack' check (char_length(btrim(program_name)) between 1 and 80),
  inactivity_days        integer not null default 7 check (inactivity_days between 1 and 365),
  -- NULL = keep messages forever. Otherwise a scheduled job purges older messages.
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
-- Privileges — RLS decides WHICH ROWS; these grants decide WHICH OPERATIONS and
-- COLUMNS. Both the admin and participants connect as `authenticated`.
-- -----------------------------------------------------------------------------
revoke all on public.stages, public.profiles, public.participant_invitations, public.app_settings
  from anon, authenticated;

-- profiles: `role`, `email`, `joined_at`, `last_active_at` are never API-writable.
grant select on public.profiles to authenticated;
grant update (full_name, avatar_path, business_idea, current_goals,       -- participant + admin
              current_stage_id, status, archived_at)                       -- admin only (profiles_guard)
  on public.profiles to authenticated;

grant select, insert, update, delete on public.stages to authenticated;

grant select on public.participant_invitations to authenticated;

grant select on public.app_settings to authenticated;
grant update (program_name, inactivity_days, message_retention_days, timezone)
  on public.app_settings to authenticated;

-- Edge Functions use the service role. It bypasses RLS but is still bound by
-- profiles_guard: it cannot assign the admin role.
grant all on public.stages, public.profiles, public.participant_invitations, public.app_settings
  to service_role;
