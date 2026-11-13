-- =============================================================================
-- VentureTrack — database schema (DESIGN REFERENCE)
--
-- This file is the reviewed target design. It is NOT applied directly: each
-- implementation phase carves its part into supabase/migrations/ together with
-- the triggers/RPCs and pgTAP tests for that phase. Once all phases have landed,
-- supabase/migrations/ is the source of truth and this file is removed.
--
-- Target: Supabase (PostgreSQL 15+). Validated to apply cleanly on the local
-- Supabase stack (Postgres 17).
--
-- Conventions
--   * Every table in `public` has Row Level Security enabled.
--   * Privileges are granted explicitly (table- and column-level); nothing is
--     left to Supabase's default grants. `anon` gets nothing at all.
--   * `private` schema = helpers that are never exposed through the Data API.
--   * "API writes: none" means rows are written only by triggers or by
--     SECURITY DEFINER functions that perform their own checks.
--   * [P1]..[P5] marks the phase in which a section is migrated and tested.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Extensions, schemas, enums                                            [P1]
-- -----------------------------------------------------------------------------
create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.user_role           as enum ('admin', 'participant');
create type public.participant_status  as enum ('invited', 'active', 'completed');
create type public.invitation_status   as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.task_status         as enum ('not_started', 'in_progress', 'submitted', 'needs_revision', 'completed');
create type public.task_priority       as enum ('low', 'medium', 'high', 'urgent');
create type public.review_decision     as enum ('pending', 'approved', 'revision_requested');
create type public.reminder_recurrence as enum ('none', 'daily', 'weekly', 'biweekly', 'monthly');
create type public.notification_type   as enum (
  'message', 'task_assigned', 'task_submitted', 'task_reviewed', 'task_comment', 'task_due',
  'milestone_achieved', 'stage_changed', 'progress_update', 'feedback',
  'announcement', 'reminder_due', 'assistance_requested'
);

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;


-- -----------------------------------------------------------------------------
-- 1. Stages (admin-customisable development stages)                        [P1]
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

insert into public.stages (position, name, description) values
  (1, 'Business idea',            'Define the problem, the customer and the core idea.'),
  (2, 'Market research',          'Understand the market, competitors and demand.'),
  (3, 'Business planning',        'Business model, finances and a written plan.'),
  (4, 'Product development',      'Build the first version of the product or service.'),
  (5, 'Marketing and validation', 'Test with real customers and refine the offer.'),
  (6, 'Launch preparation',       'Legal, operational and go-to-market readiness.');


-- -----------------------------------------------------------------------------
-- 2. Profiles (one row per person: the single admin + every participant)   [P1]
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  -- `role` is NOT writable through the API (no column privilege, see section 20)
  -- and is only ever set by private.provision_admin(), run by the database owner.
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

create policy "profiles: update self, or anyone as admin"
  on public.profiles for update to authenticated
  using      (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));
-- API writes: no INSERT / DELETE. Rows are created by the auth.users trigger.

alter table public.stages enable row level security;
create policy "stages: readable by signed-in users"
  on public.stages for select to authenticated using (true);
create policy "stages: admin manages"
  on public.stages for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create trigger stages_set_updated_at before update on public.stages
  for each row execute function private.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. Participant invitations                                               [P1]
-- -----------------------------------------------------------------------------
create table public.participant_invitations (
  id               uuid primary key default gen_random_uuid(),
  email            extensions.citext not null,
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
-- Only one open invitation per e-mail address.
create unique index invitations_pending_email_idx
  on public.participant_invitations (email) where status = 'pending';
create index invitations_profile_idx on public.participant_invitations (profile_id);

alter table public.participant_invitations enable row level security;
create policy "invitations: admin reads"
  on public.participant_invitations for select to authenticated
  using ((select private.is_admin()));
-- API writes: none. Created/revoked only by the `invite-participant` Edge Function.


-- -----------------------------------------------------------------------------
-- 4. Application settings (singleton row)                                  [P1]
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
-- 5. Private administrator notes                                           [P2]
-- -----------------------------------------------------------------------------
create table public.private_notes (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.profiles (id) on delete cascade,
  author_id      uuid not null default auth.uid() references public.profiles (id),
  body           text not null check (char_length(btrim(body)) between 1 and 20000),
  is_pinned      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index private_notes_participant_idx on public.private_notes (participant_id, created_at desc);
create trigger private_notes_set_updated_at before update on public.private_notes
  for each row execute function private.set_updated_at();

alter table public.private_notes enable row level security;
-- The ONLY policy: participants have no path to this table at all.
create policy "notes: admin only"
  on public.private_notes for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 6. Activity timeline (append-only, written by triggers)                  [P2]
-- -----------------------------------------------------------------------------
create table public.activity_events (
  id             bigint generated always as identity primary key,
  participant_id uuid not null references public.profiles (id) on delete cascade,
  actor_id       uuid references public.profiles (id) on delete set null,
  event_type     text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),   -- e.g. task.submitted
  entity_type    text,
  entity_id      uuid,
  summary        text not null,
  metadata       jsonb not null default '{}'::jsonb,
  is_admin_only  boolean not null default false,       -- e.g. note.created never reaches participants
  created_at     timestamptz not null default now()
);
create index activity_participant_idx on public.activity_events (participant_id, created_at desc);
create index activity_recent_idx      on public.activity_events (created_at desc);

alter table public.activity_events enable row level security;
create policy "activity: own visible events, or everything as admin"
  on public.activity_events for select to authenticated
  using (
    (select private.is_admin())
    or (participant_id = (select auth.uid()) and not is_admin_only)
  );
-- API writes: none.


-- -----------------------------------------------------------------------------
-- 7. Conversations (exactly one per participant, with the admin)           [P3]
-- -----------------------------------------------------------------------------
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid not null unique references public.profiles (id) on delete cascade,
  last_message_at timestamptz,
  created_at      timestamptz not null default now()
);
create index conversations_last_message_idx on public.conversations (last_message_at desc nulls last);

alter table public.conversations enable row level security;
create policy "conversations: own, or all as admin"
  on public.conversations for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
-- API writes: none. Created by trigger with the participant's profile.


-- -----------------------------------------------------------------------------
-- 8. Messages                                                              [P3]
-- -----------------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),   -- client may supply it (optimistic UI)
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null default auth.uid() references public.profiles (id),
  body            text not null default '' check (char_length(body) <= 10000),
  created_at      timestamptz not null default now(),           -- never client-supplied (no column privilege)
  deleted_at      timestamptz,                                  -- tombstone; set only by retention/moderation
  search          tsvector generated always as (to_tsvector('simple'::regconfig, body)) stored
);
-- Keyset pagination: newest-first within a conversation.
create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id desc);
create index messages_search_idx       on public.messages using gin (search);
create index messages_sender_idx       on public.messages (sender_id);

alter table public.messages enable row level security;

-- "Visible if the parent conversation is visible": the sub-select runs under the
-- caller's own RLS on `conversations`, so the rule is defined in exactly one place.
create policy "messages: read within visible conversations"
  on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id));

create policy "messages: send as yourself into a visible conversation"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (select 1 from public.conversations c where c.id = conversation_id)
    and ((select private.is_admin()) or (select private.is_active_participant()))
  );
-- No UPDATE / DELETE policies: messages are immutable from the API. They are kept
-- permanently unless removed by the retention job or an admin moderation RPC.


-- -----------------------------------------------------------------------------
-- 9. Message read states (one read cursor per user per conversation)       [P3]
--    unread count  = messages from the other party newer than my cursor
--    read receipt  = my message is older than the other party's cursor
-- -----------------------------------------------------------------------------
create table public.message_read_states (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  last_read_at    timestamptz not null,
  updated_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index message_read_states_user_idx on public.message_read_states (user_id);

alter table public.message_read_states enable row level security;
create policy "read states: visible to both parties of the conversation"
  on public.message_read_states for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
-- API writes: none. public.mark_conversation_read() stamps the server time.


-- -----------------------------------------------------------------------------
-- 10. Milestones (templates per stage + per-participant milestones)        [P4]
-- -----------------------------------------------------------------------------
create table public.milestone_templates (
  id          uuid primary key default gen_random_uuid(),
  stage_id    uuid not null references public.stages (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  description text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index milestone_templates_stage_idx on public.milestone_templates (stage_id, position);
create trigger milestone_templates_set_updated_at before update on public.milestone_templates
  for each row execute function private.set_updated_at();

alter table public.milestone_templates enable row level security;
create policy "milestone templates: admin only"
  on public.milestone_templates for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create table public.milestones (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.profiles (id) on delete cascade,
  stage_id       uuid references public.stages (id) on delete set null,
  template_id    uuid references public.milestone_templates (id) on delete set null,
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  description    text,
  due_at         timestamptz,
  position       integer not null default 0,
  -- A milestone counts only once the admin has verified it.
  achieved_at    timestamptz,
  verified_by    uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint milestones_verified_consistent check ((achieved_at is null) = (verified_by is null)),
  constraint milestones_id_participant_key unique (id, participant_id)   -- target for composite FKs
);
create index milestones_participant_idx on public.milestones (participant_id, position);
create index milestones_stage_idx       on public.milestones (stage_id);
create index milestones_due_idx         on public.milestones (due_at) where achieved_at is null;
create trigger milestones_set_updated_at before update on public.milestones
  for each row execute function private.set_updated_at();

alter table public.milestones enable row level security;
create policy "milestones: read own, or all as admin"
  on public.milestones for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
create policy "milestones: admin manages"
  on public.milestones for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Stage changes over time ("progress history"); written by a trigger on profiles.
create table public.stage_history (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.profiles (id) on delete cascade,
  from_stage_id  uuid references public.stages (id) on delete set null,
  to_stage_id    uuid references public.stages (id) on delete set null,
  changed_by     uuid references public.profiles (id) on delete set null,
  note           text,
  created_at     timestamptz not null default now()
);
create index stage_history_participant_idx on public.stage_history (participant_id, created_at desc);

alter table public.stage_history enable row level security;
create policy "stage history: read own, or all as admin"
  on public.stage_history for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
-- API writes: none.


-- -----------------------------------------------------------------------------
-- 11. Tasks                                                                [P4]
-- -----------------------------------------------------------------------------
create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  participant_id    uuid not null references public.profiles (id) on delete cascade,
  title             text not null check (char_length(btrim(title)) between 1 and 200),
  description       text,
  status            public.task_status not null default 'not_started',
  priority          public.task_priority not null default 'medium',
  due_at            timestamptz,
  stage_id          uuid references public.stages (id) on delete set null,
  milestone_id      uuid,
  source_message_id uuid references public.messages (id) on delete set null,   -- "create task from message"
  created_by        uuid not null default auth.uid() references public.profiles (id),
  submitted_at      timestamptz,
  -- 'completed' always means "approved by the admin", never self-reported.
  completed_at      timestamptz,
  approved_by       uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint tasks_completed_consistent check ((status = 'completed') = (completed_at is not null)),
  constraint tasks_approved_consistent  check ((completed_at is null) = (approved_by is null)),
  constraint tasks_id_participant_key   unique (id, participant_id),
  -- a task can only be linked to a milestone of the SAME participant
  constraint tasks_milestone_fkey foreign key (milestone_id, participant_id)
    references public.milestones (id, participant_id) on delete set null (milestone_id)
);
create index tasks_participant_status_idx on public.tasks (participant_id, status);
create index tasks_open_due_idx           on public.tasks (due_at) where status <> 'completed';
create index tasks_milestone_idx          on public.tasks (milestone_id);
create index tasks_stage_idx              on public.tasks (stage_id);
create index tasks_source_message_idx     on public.tasks (source_message_id);
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

alter table public.tasks enable row level security;
create policy "tasks: read own, or all as admin"
  on public.tasks for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
create policy "tasks: admin manages"
  on public.tasks for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
-- Participants never UPDATE tasks directly. They call public.set_my_task_status()
-- (not_started <-> in_progress only) and submit work via task_submissions.


-- -----------------------------------------------------------------------------
-- 12. Task submissions and comments                                        [P4]
-- -----------------------------------------------------------------------------
create table public.task_submissions (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null,
  submitted_by uuid not null default auth.uid(),
  body         text check (char_length(body) <= 20000),
  decision     public.review_decision not null default 'pending',
  feedback     text check (char_length(feedback) <= 20000),
  reviewed_by  uuid references public.profiles (id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  -- the submitter must be the participant the task is assigned to
  constraint task_submissions_task_fkey foreign key (task_id, submitted_by)
    references public.tasks (id, participant_id) on delete cascade,
  constraint task_submissions_review_consistent
    check ((decision = 'pending') = (reviewed_at is null) and (reviewed_at is null) = (reviewed_by is null))
);
create index task_submissions_task_idx    on public.task_submissions (task_id, created_at desc);
create index task_submissions_pending_idx on public.task_submissions (created_at) where decision = 'pending';

alter table public.task_submissions enable row level security;
create policy "submissions: read for visible tasks"
  on public.task_submissions for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy "submissions: participant submits own open task"
  on public.task_submissions for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and (select private.is_active_participant())
    and exists (
      select 1 from public.tasks t
      where t.id = task_id
        and t.participant_id = (select auth.uid())
        and t.status in ('not_started', 'in_progress', 'needs_revision')
    )
  );
create policy "submissions: admin reviews"
  on public.task_submissions for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "submissions: admin deletes"
  on public.task_submissions for delete to authenticated
  using ((select private.is_admin()));

create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id),
  body       text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

alter table public.task_comments enable row level security;
create policy "task comments: read for visible tasks"
  on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy "task comments: add to visible tasks as yourself"
  on public.task_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id)
    and ((select private.is_admin()) or (select private.is_active_participant()))
  );
create policy "task comments: admin deletes"
  on public.task_comments for delete to authenticated
  using ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 13. Progress updates (participant-reported, with admin feedback)         [P4]
-- -----------------------------------------------------------------------------
create table public.progress_updates (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title          text check (char_length(title) <= 200),
  body           text not null check (char_length(btrim(body)) between 1 and 20000),
  milestone_id   uuid,
  feedback       text check (char_length(feedback) <= 20000),
  feedback_by    uuid references public.profiles (id),
  feedback_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint progress_updates_milestone_fkey foreign key (milestone_id, participant_id)
    references public.milestones (id, participant_id) on delete set null (milestone_id)
);
create index progress_updates_participant_idx on public.progress_updates (participant_id, created_at desc);
create index progress_updates_milestone_idx   on public.progress_updates (milestone_id);

alter table public.progress_updates enable row level security;
create policy "progress updates: read own, or all as admin"
  on public.progress_updates for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
create policy "progress updates: participant posts own"
  on public.progress_updates for insert to authenticated
  with check (participant_id = (select auth.uid()) and (select private.is_active_participant()));
create policy "progress updates: admin gives feedback"
  on public.progress_updates for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "progress updates: admin deletes"
  on public.progress_updates for delete to authenticated
  using ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 14. Attachments (metadata; the bytes live in the private `attachments` bucket)
--     Exactly one parent: a message, a task submission or a progress update.
--     message part [P3], submission / progress-update part [P4]
-- -----------------------------------------------------------------------------
create table public.attachments (
  id                 uuid primary key default gen_random_uuid(),
  message_id         uuid references public.messages (id) on delete cascade,
  submission_id      uuid references public.task_submissions (id) on delete cascade,
  progress_update_id uuid references public.progress_updates (id) on delete cascade,
  uploaded_by        uuid not null default auth.uid() references public.profiles (id),
  storage_path       text not null unique,    -- '<participant_id>/<context>/<uuid>/<file name>'
  file_name          text not null check (char_length(file_name) between 1 and 255),
  mime_type          text,
  size_bytes         bigint not null check (size_bytes > 0 and size_bytes <= 26214400),   -- 25 MB
  created_at         timestamptz not null default now(),
  constraint attachments_exactly_one_parent
    check (num_nonnulls(message_id, submission_id, progress_update_id) = 1)
);
create index attachments_message_idx         on public.attachments (message_id) where message_id is not null;
create index attachments_submission_idx      on public.attachments (submission_id) where submission_id is not null;
create index attachments_progress_update_idx on public.attachments (progress_update_id) where progress_update_id is not null;

alter table public.attachments enable row level security;
create policy "attachments: read when the parent is visible"
  on public.attachments for select to authenticated
  using (
    (message_id is not null and exists (select 1 from public.messages m where m.id = message_id))
    or (submission_id is not null and exists (select 1 from public.task_submissions s where s.id = submission_id))
    or (progress_update_id is not null and exists (select 1 from public.progress_updates p where p.id = progress_update_id))
  );
create policy "attachments: add to your own message, submission or update"
  on public.attachments for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and (
      (select private.is_admin())
      or (
        (select private.is_active_participant())
        and (
          (message_id is not null and exists (
            select 1 from public.messages m where m.id = message_id and m.sender_id = (select auth.uid())))
          or (submission_id is not null and exists (
            select 1 from public.task_submissions s where s.id = submission_id and s.submitted_by = (select auth.uid())))
          or (progress_update_id is not null and exists (
            select 1 from public.progress_updates p where p.id = progress_update_id and p.participant_id = (select auth.uid())))
        )
      )
    )
  );
create policy "attachments: admin deletes"
  on public.attachments for delete to authenticated
  using ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 15. Reminders (the admin's follow-up list)                               [P5]
-- -----------------------------------------------------------------------------
create table public.reminders (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid references public.profiles (id) on delete cascade,   -- NULL = general reminder
  task_id        uuid references public.tasks (id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  notes          text,
  due_at         timestamptz not null,
  recurrence     public.reminder_recurrence not null default 'none',
  resolved_at    timestamptz,
  resolved_by    uuid references public.profiles (id),
  created_by     uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint reminders_resolved_consistent check ((resolved_at is null) = (resolved_by is null))
);
create index reminders_open_due_idx    on public.reminders (due_at) where resolved_at is null;
create index reminders_participant_idx on public.reminders (participant_id);
create index reminders_task_idx        on public.reminders (task_id);
create trigger reminders_set_updated_at before update on public.reminders
  for each row execute function private.set_updated_at();

alter table public.reminders enable row level security;
create policy "reminders: admin only"
  on public.reminders for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 16. Assistance requests ("I need help" from a participant)               [P5]
-- -----------------------------------------------------------------------------
create table public.assistance_requests (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  topic           text not null check (char_length(btrim(topic)) between 1 and 200),
  details         text check (char_length(details) <= 5000),
  task_id         uuid,
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles (id),
  resolution_note text,
  created_at      timestamptz not null default now(),
  constraint assistance_task_fkey foreign key (task_id, participant_id)
    references public.tasks (id, participant_id) on delete set null (task_id),
  constraint assistance_resolved_consistent check ((resolved_at is null) = (resolved_by is null))
);
create index assistance_open_idx        on public.assistance_requests (created_at) where resolved_at is null;
create index assistance_participant_idx on public.assistance_requests (participant_id, created_at desc);
create index assistance_task_idx        on public.assistance_requests (task_id);

alter table public.assistance_requests enable row level security;
create policy "assistance: read own, or all as admin"
  on public.assistance_requests for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
create policy "assistance: participant asks for help"
  on public.assistance_requests for insert to authenticated
  with check (participant_id = (select auth.uid()) and (select private.is_active_participant()));
create policy "assistance: admin resolves"
  on public.assistance_requests for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "assistance: admin deletes"
  on public.assistance_requests for delete to authenticated
  using ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 17. Announcements                                                        [P5]
-- -----------------------------------------------------------------------------
create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  body         text not null check (char_length(btrim(body)) between 1 and 20000),
  is_pinned    boolean not null default false,
  published_at timestamptz,                      -- NULL = draft
  expires_at   timestamptz,
  created_by   uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint announcements_expiry_after_publish
    check (expires_at is null or published_at is null or expires_at > published_at)
);
create index announcements_published_idx on public.announcements (published_at desc) where published_at is not null;
create trigger announcements_set_updated_at before update on public.announcements
  for each row execute function private.set_updated_at();

alter table public.announcements enable row level security;
create policy "announcements: published ones are readable"
  on public.announcements for select to authenticated
  using (
    (select private.is_admin())
    or (published_at is not null and published_at <= now() and (expires_at is null or expires_at > now()))
  );
create policy "announcements: admin manages"
  on public.announcements for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 18. Notifications (in-app; written by triggers, delivered via Realtime)  [P3/P5]
-- -----------------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type         public.notification_type not null,
  title        text not null,
  body         text,
  link         text,            -- in-app route, e.g. /app/tasks/<id>
  entity_type  text,
  entity_id    uuid,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx    on public.notifications (recipient_id) where read_at is null;

alter table public.notifications enable row level security;
create policy "notifications: read own"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy "notifications: mark own as read"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy "notifications: dismiss own"
  on public.notifications for delete to authenticated
  using (recipient_id = (select auth.uid()));
-- API writes: no INSERT.


-- -----------------------------------------------------------------------------
-- 19. Storage: private buckets + access policies                           [P1/P3]
--     Object paths always start with the owning participant's id:
--       attachments/<participant_id>/messages/<uuid>/<file>
--       avatars/<user_id>/<file>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('attachments', 'attachments', false, 26214400, null),
  ('avatars',     'avatars',     false, 2097152,  array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "attachments: read own folder, or all as admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin()))
  );
create policy "attachments: upload into own folder, or any as admin"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (
      ((storage.foldername(name))[1] = (select auth.uid())::text and (select private.is_active_participant()))
      or (select private.is_admin())
    )
  );
-- No UPDATE policy: uploaded files are immutable. Only the admin can remove them.
create policy "attachments: admin deletes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (select private.is_admin()));

create policy "avatars: read own, the admin's, or all as admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select private.admin_id())::text
      or (select private.is_admin())
    )
  );
create policy "avatars: upload own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: replace own"
  on storage.objects for update to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);


-- -----------------------------------------------------------------------------
-- 20. Privileges — the complete Data API surface, in one place
--     RLS decides WHICH ROWS; these grants decide WHICH OPERATIONS and COLUMNS.
--     Both the admin and participants connect as the `authenticated` DB role.
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- profiles: `role`, `email`, `joined_at`, `last_active_at` are never API-writable.
grant select on public.profiles to authenticated;
grant update (full_name, avatar_path, business_idea, current_goals,       -- participant + admin
              current_stage_id, status, archived_at)                       -- admin only (profiles_guard)
  on public.profiles to authenticated;

grant select on public.participant_invitations to authenticated;

grant select on public.app_settings to authenticated;
grant update (program_name, inactivity_days, message_retention_days, timezone)
  on public.app_settings to authenticated;

grant select, insert, update, delete on public.stages              to authenticated;
grant select, insert, update, delete on public.milestone_templates to authenticated;
grant select, insert, update, delete on public.milestones          to authenticated;
grant select                         on public.stage_history       to authenticated;

grant select, insert, update, delete on public.private_notes   to authenticated;
grant select                         on public.activity_events to authenticated;

grant select on public.conversations to authenticated;
grant select on public.messages      to authenticated;
grant insert (id, conversation_id, body) on public.messages to authenticated;
grant select on public.message_read_states to authenticated;

grant select, insert, update, delete on public.tasks to authenticated;

grant select, delete on public.task_submissions to authenticated;
grant insert (id, task_id, body)  on public.task_submissions to authenticated;
grant update (decision, feedback) on public.task_submissions to authenticated;

grant select, delete on public.task_comments to authenticated;
grant insert (id, task_id, body) on public.task_comments to authenticated;

grant select, delete on public.progress_updates to authenticated;
grant insert (id, title, body, milestone_id) on public.progress_updates to authenticated;
grant update (feedback)                      on public.progress_updates to authenticated;

grant select, delete on public.attachments to authenticated;
grant insert (id, message_id, submission_id, progress_update_id, storage_path, file_name, mime_type, size_bytes)
  on public.attachments to authenticated;

grant select, insert, update, delete on public.reminders to authenticated;

grant select, delete on public.assistance_requests to authenticated;
grant insert (id, topic, details, task_id) on public.assistance_requests to authenticated;
grant update (resolved_at, resolved_by, resolution_note) on public.assistance_requests to authenticated;

grant select, insert, update, delete on public.announcements to authenticated;

grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Edge Functions use the service role (bypasses RLS; still bound by profiles_guard for `role`).
grant all on all tables in schema public to service_role;


-- -----------------------------------------------------------------------------
-- 21. Realtime                                                             [P3]
--     Postgres Changes are filtered through each subscriber's RLS, so a
--     participant can only ever receive rows they could SELECT.
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_read_states;
alter publication supabase_realtime add table public.notifications;
