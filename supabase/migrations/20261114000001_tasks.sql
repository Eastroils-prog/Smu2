-- =============================================================================
-- Tasks, handed-in work, attachments and review
--
-- Rules enforced here:
--   * Only the administrator creates, edits and deletes tasks.
--   * A participant sees only their own tasks, submissions and files.
--   * A participant can start a task and hand in work, nothing else.
--   * 'completed' always means "approved by the administrator". Nobody can
--     set a task's status directly; it only changes through the three
--     functions below, each of which checks who is calling.
--   * Files live in a private bucket, in a folder named after the participant.
-- =============================================================================

create type public.task_status     as enum ('not_started', 'in_progress', 'submitted', 'needs_revision', 'completed');
create type public.task_priority   as enum ('low', 'medium', 'high');
create type public.review_decision as enum ('pending', 'approved', 'revision_requested');


-- -----------------------------------------------------------------------------
-- Tasks
-- -----------------------------------------------------------------------------
create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.profiles (id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  description    text check (char_length(description) <= 5000),
  status         public.task_status not null default 'not_started',
  priority       public.task_priority not null default 'medium',
  due_on         date,
  -- The stage the participant was in when the task was given. Progress counts
  -- approved tasks per stage.
  stage_id       uuid references public.stages (id) on delete set null,
  created_by     uuid not null default auth.uid() references public.profiles (id),
  submitted_at   timestamptz,
  completed_at   timestamptz,
  approved_by    uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint tasks_completed_consistent check ((status = 'completed') = (completed_at is not null)),
  constraint tasks_approved_consistent  check ((completed_at is null) = (approved_by is null)),
  constraint tasks_id_participant_key   unique (id, participant_id)
);
create index tasks_participant_status_idx on public.tasks (participant_id, status);
create index tasks_open_due_idx           on public.tasks (due_on) where status <> 'completed';
create index tasks_stage_idx              on public.tasks (stage_id);
create index tasks_created_by_idx         on public.tasks (created_by);
create index tasks_approved_by_idx        on public.tasks (approved_by);

create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

-- A new task always starts clean, in the participant's current stage, and can
-- only be given to someone who has joined and is not archived.
create function private.tasks_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = new.participant_id;
  if p.id is null or p.role <> 'participant' or p.status <> 'active' or p.archived_at is not null then
    raise exception 'tasks can only be given to an active participant' using errcode = 'P0001';
  end if;
  new.stage_id     := p.current_stage_id;
  new.status       := 'not_started';
  new.created_by   := coalesce((select auth.uid()), new.created_by);
  new.submitted_at := null;
  new.completed_at := null;
  new.approved_by  := null;
  return new;
end $$;
revoke all on function private.tasks_before_insert() from public;

create trigger tasks_before_insert before insert on public.tasks
  for each row execute function private.tasks_before_insert();

alter table public.tasks enable row level security;
create policy "tasks: read own, or all as admin"
  on public.tasks for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
create policy "tasks: admin creates"
  on public.tasks for insert to authenticated
  with check ((select private.is_admin()));
create policy "tasks: admin edits"
  on public.tasks for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "tasks: admin deletes"
  on public.tasks for delete to authenticated
  using ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- Handed-in work
-- -----------------------------------------------------------------------------
create table public.task_submissions (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null,
  participant_id uuid not null,
  body           text check (char_length(body) <= 10000),
  decision       public.review_decision not null default 'pending',
  feedback       text check (char_length(feedback) <= 5000),
  submitted_at   timestamptz not null default now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid references public.profiles (id),
  -- Only the person the task belongs to can be the author of its submission.
  constraint task_submissions_task_fkey foreign key (task_id, participant_id)
    references public.tasks (id, participant_id) on delete cascade,
  constraint task_submissions_reviewed_consistent check ((decision = 'pending') = (reviewed_at is null))
);
create index task_submissions_task_idx        on public.task_submissions (task_id, submitted_at desc);
create index task_submissions_participant_idx on public.task_submissions (participant_id);
create index task_submissions_reviewed_by_idx on public.task_submissions (reviewed_by);
-- At most one submission per task can be waiting for review.
create unique index task_submissions_one_pending_idx on public.task_submissions (task_id) where decision = 'pending';

alter table public.task_submissions enable row level security;
create policy "submissions: read own, or all as admin"
  on public.task_submissions for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
-- No writes through the API. See submit_task / review_task.


-- -----------------------------------------------------------------------------
-- Attachments (the bytes live in the private `submissions` bucket)
-- -----------------------------------------------------------------------------
create table public.task_attachments (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.task_submissions (id) on delete cascade,
  participant_id uuid not null references public.profiles (id) on delete cascade,
  storage_path   text not null unique,
  file_name      text not null check (char_length(file_name) between 1 and 255),
  size_bytes     bigint not null check (size_bytes between 0 and 10485760),
  mime_type      text,
  created_at     timestamptz not null default now()
);
create index task_attachments_submission_idx  on public.task_attachments (submission_id);
create index task_attachments_participant_idx on public.task_attachments (participant_id);

alter table public.task_attachments enable row level security;
create policy "attachments: read own, or all as admin"
  on public.task_attachments for select to authenticated
  using (participant_id = (select auth.uid()) or (select private.is_admin()));
-- No writes through the API. Rows are created by submit_task.

insert into storage.buckets (id, name, public, file_size_limit)
values ('submissions', 'submissions', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

-- Path convention: <participant id>/<task id>/<random id>-<file name>
create policy "submissions bucket: participants upload into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_active_participant())
  );
create policy "submissions bucket: read own folder, or everything as admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'submissions'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin()))
  );
-- No update or delete policies: handed-in files cannot be swapped or removed.


-- -----------------------------------------------------------------------------
-- The only three ways a task's status can change
-- -----------------------------------------------------------------------------
create function public.start_task(p_task_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active_participant() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.tasks set status = 'in_progress'
  where id = p_task_id and participant_id = (select auth.uid()) and status = 'not_started';
  if not found then
    raise exception 'task_not_startable' using errcode = 'P0001';
  end if;
end $$;

-- p_files: [{"path": "<uid>/<task id>/<id>-name.png", "name": "name.png"}, ...]
create function public.submit_task(p_task_id uuid, p_body text, p_files jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_submission uuid;
  v_file jsonb;
  v_path text;
  v_meta jsonb;
begin
  if not private.is_active_participant() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 5 then
    raise exception 'too_many_files' using errcode = 'P0001';
  end if;
  if v_body is null and jsonb_array_length(p_files) = 0 then
    raise exception 'nothing_to_hand_in' using errcode = 'P0001';
  end if;

  perform 1 from public.tasks
  where id = p_task_id and participant_id = v_uid
    and status in ('not_started', 'in_progress', 'needs_revision')
  for update;
  if not found then
    raise exception 'task_not_open' using errcode = 'P0001';
  end if;

  insert into public.task_submissions (task_id, participant_id, body)
  values (p_task_id, v_uid, v_body)
  returning id into v_submission;

  for v_file in select * from jsonb_array_elements(p_files) loop
    v_path := v_file ->> 'path';
    -- The file must be in this participant's folder for this task, and must really exist.
    if v_path is null or left(v_path, 74) <> v_uid::text || '/' || p_task_id::text || '/' then
      raise exception 'file_not_allowed' using errcode = 'P0001';
    end if;
    select metadata into v_meta from storage.objects where bucket_id = 'submissions' and name = v_path;
    if not found then
      raise exception 'file_missing' using errcode = 'P0001';
    end if;
    insert into public.task_attachments (submission_id, participant_id, storage_path, file_name, size_bytes, mime_type)
    values (v_submission, v_uid, v_path,
            left(coalesce(nullif(btrim(v_file ->> 'name'), ''), 'file'), 255),
            coalesce((v_meta ->> 'size')::bigint, 0),
            v_meta ->> 'mimetype');
  end loop;

  update public.tasks set status = 'submitted', submitted_at = now() where id = p_task_id;
  update public.profiles set last_active_at = now() where id = v_uid;
  return v_submission;
end $$;

create function public.review_task(p_task_id uuid, p_approve boolean, p_feedback text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not private.is_admin() then
    raise exception 'only the administrator can review work' using errcode = '42501';
  end if;

  perform 1 from public.tasks where id = p_task_id and status = 'submitted' for update;
  if not found then
    raise exception 'task_not_submitted' using errcode = 'P0001';
  end if;

  update public.task_submissions
  set decision = case when p_approve then 'approved'::public.review_decision else 'revision_requested'::public.review_decision end,
      feedback = nullif(btrim(coalesce(p_feedback, '')), ''),
      reviewed_at = now(),
      reviewed_by = v_uid
  where task_id = p_task_id and decision = 'pending';

  if p_approve then
    update public.tasks set status = 'completed', completed_at = now(), approved_by = v_uid where id = p_task_id;
  else
    update public.tasks set status = 'needs_revision' where id = p_task_id;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on public.tasks, public.task_submissions, public.task_attachments from anon, authenticated;
revoke execute on function public.start_task(uuid), public.submit_task(uuid, text, jsonb), public.review_task(uuid, boolean, text)
  from public, anon, authenticated;

grant select, delete on public.tasks to authenticated;
-- `status`, `stage_id` and the review columns are never writable through the API.
grant insert (id, participant_id, title, description, priority, due_on) on public.tasks to authenticated;
grant update (title, description, priority, due_on)                 on public.tasks to authenticated;
grant select on public.task_submissions, public.task_attachments to authenticated;

grant execute on function public.start_task(uuid)                 to authenticated;
grant execute on function public.submit_task(uuid, text, jsonb)   to authenticated;
grant execute on function public.review_task(uuid, boolean, text) to authenticated;

grant all on public.tasks, public.task_submissions, public.task_attachments to service_role;
