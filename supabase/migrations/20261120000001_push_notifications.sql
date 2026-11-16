-- =============================================================================
-- Phone notifications (Web Push)
--
-- How it works:
--   1. A phone or computer that allows notifications saves a "subscription"
--      (an address at the browser maker's push service, plus encryption keys).
--   2. When something happens (a message, a task, feedback, a help request, a
--      poll, a shared file) a trigger puts a short note in an outbox.
--   3. The outbox wakes the `send-push` Edge Function, which encrypts each
--      note for each of the person's devices and hands it to the push service.
--   4. Once an hour, people whose local time is 8 in the morning get a short
--      summary of today's reminders and close task deadlines.
--
-- Rules enforced here:
--   * A person can see and remove only their own devices.
--   * Only the server (service role) can read the outbox and the keys of
--     other people's devices.
--   * Blocked and archived people get no notifications.
--
-- Two values are stored outside this file, in Vault, per installation:
--   push_function_url  the address of the send-push function
--   push_secret        a shared secret the function checks
-- Without them the outbox simply waits.
-- =============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- Devices
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https?://' and char_length(endpoint) <= 2000),
  p256dh      text not null check (char_length(p256dh) between 80 and 100),
  auth        text not null check (char_length(auth) between 16 and 32),
  time_zone   text not null default 'UTC',
  device      text check (char_length(device) <= 200),
  created_at  timestamptz not null default now()
);
create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;
create policy "push: see your own devices"
  on public.push_subscriptions for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "push: remove your own devices"
  on public.push_subscriptions for delete to authenticated
  using (profile_id = (select auth.uid()));

-- Save (or move) this device's subscription to the signed-in person.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_time_zone text, p_device text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_zone text := coalesce(nullif(btrim(p_time_zone), ''), 'UTC');
begin
  if v_uid is null or not private.is_member() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_zone) then
    v_zone := 'UTC';
  end if;
  -- A device belongs to whoever signed in on it last.
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, time_zone, device)
  values (v_uid, p_endpoint, p_p256dh, p_auth, v_zone, left(p_device, 200));
end $$;


-- -----------------------------------------------------------------------------
-- The outbox
-- -----------------------------------------------------------------------------
create table private.push_outbox (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  body        text not null default '',
  url         text not null default '/',
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz
);
create index push_outbox_waiting_idx on private.push_outbox (id) where claimed_at is null;
create index push_outbox_profile_idx on private.push_outbox (profile_id);

create table private.push_digests (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  sent_on    date not null
);

-- Wake the send-push function (does nothing until Vault holds its address).
create function private.kick_push() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
end $$;

create function private.kick_push_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.kick_push();
  return null;
end $$;
create trigger push_outbox_kick after insert on private.push_outbox
  for each statement execute function private.kick_push_after_insert();

-- Queue one note for one person, if they have a device and are not blocked or archived.
create function private.notify(p_profile_id uuid, p_title text, p_body text, p_url text) returns void
language sql security definer set search_path = '' as $$
  insert into private.push_outbox (profile_id, title, body, url)
  select p.id, left(p_title, 120), left(coalesce(p_body, ''), 240), coalesce(p_url, '/')
  from public.profiles p
  where p.id = p_profile_id
    and p.blocked_at is null
    and p.archived_at is null
    and exists (select 1 from public.push_subscriptions s where s.profile_id = p.id);
$$;

create function private.home_of(p_profile_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when role = 'admin' then '/admin' else '/app' end from public.profiles where id = p_profile_id;
$$;

create function private.admin_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where role = 'admin';
$$;

create function private.name_of(p_profile_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select full_name from public.profiles where id = p_profile_id;
$$;


-- -----------------------------------------------------------------------------
-- What sends a notification
-- -----------------------------------------------------------------------------
create function private.push_on_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.recipient_id,
    'Message from ' || private.name_of(new.sender_id),
    new.body,
    private.home_of(new.recipient_id) || '/messages/' || new.sender_id);
  return null;
end $$;
create trigger push_on_message after insert on public.messages
  for each row execute function private.push_on_message();

create function private.push_on_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.participant_id, 'New task', new.title, '/app/tasks');
  return null;
end $$;
create trigger push_on_task after insert on public.tasks
  for each row execute function private.push_on_task();

create function private.push_on_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_title text := (select title from public.tasks where id = new.task_id);
begin
  if tg_op = 'INSERT' then
    perform private.notify(private.admin_id(), private.name_of(new.participant_id) || ' handed in work', v_title, '/admin/tasks');
  elsif old.decision = 'pending' and new.decision = 'approved' then
    perform private.notify(new.participant_id, 'Your work was approved', v_title, '/app/tasks');
  elsif old.decision = 'pending' and new.decision = 'revision_requested' then
    perform private.notify(new.participant_id, 'Your work needs changes', v_title, '/app/tasks');
  end if;
  return null;
end $$;
create trigger push_on_submission after insert or update of decision on public.task_submissions
  for each row execute function private.push_on_submission();

create function private.push_on_help() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(private.admin_id(), private.name_of(new.participant_id) || ' asked for help', new.body,
    '/admin/people/' || new.participant_id);
  return null;
end $$;
create trigger push_on_help after insert on public.help_requests
  for each row execute function private.push_on_help();

create function private.push_on_poll() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p record;
begin
  for p in select id from public.profiles where status <> 'invited' and id <> new.created_by loop
    perform private.notify(p.id, 'New poll', new.question, private.home_of(p.id) || '/polls');
  end loop;
  return null;
end $$;
create trigger push_on_poll after insert on public.polls
  for each row execute function private.push_on_poll();

create function private.push_on_shared_file() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  v_was_shared boolean := tg_op = 'UPDATE' and old.status = 'approved';
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform private.notify(private.admin_id(), 'A file waits for your approval', new.title, '/admin/files');
  end if;
  if new.status = 'approved' and not v_was_shared then
    if new.uploader_id <> private.admin_id() then
      perform private.notify(new.uploader_id, 'Your file is now shared', new.title, '/app/files');
    end if;
    for p in select id from public.profiles where status <> 'invited' and id <> new.uploader_id and role = 'participant' loop
      perform private.notify(p.id, 'New shared file', new.title, '/app/files');
    end loop;
  end if;
  return null;
end $$;
create trigger push_on_shared_file after insert or update of status on public.shared_files
  for each row execute function private.push_on_shared_file();


-- -----------------------------------------------------------------------------
-- The morning summary
-- -----------------------------------------------------------------------------
-- p_force: send to everyone with a device now, whatever their local time (for testing).
create function private.queue_digests(p_force boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_today date;
  v_reminders integer;
  v_deadlines integer;
  v_sent integer := 0;
  v_parts text[];
begin
  for r in
    select distinct on (s.profile_id) s.profile_id, s.time_zone, p.role
    from public.push_subscriptions s
    join public.profiles p on p.id = s.profile_id
    where p.blocked_at is null and p.archived_at is null and p.status <> 'invited'
    order by s.profile_id, s.created_at desc
  loop
    v_today := (now() at time zone r.time_zone)::date;
    continue when not p_force and extract(hour from (now() at time zone r.time_zone)) <> 8;
    continue when not p_force and exists (select 1 from private.push_digests d where d.profile_id = r.profile_id and d.sent_on = v_today);

    select count(*) into v_reminders from public.reminders
    where owner_id = r.profile_id and done_at is null and due_on <= v_today;

    select count(*) into v_deadlines
    from public.tasks t join public.profiles who on who.id = t.participant_id
    where t.status in ('not_started', 'in_progress', 'needs_revision')
      and t.due_on is not null and t.due_on <= v_today + 1
      and who.blocked_at is null and who.archived_at is null
      and (r.role = 'admin' or t.participant_id = r.profile_id);

    insert into private.push_digests (profile_id, sent_on) values (r.profile_id, v_today)
    on conflict (profile_id) do update set sent_on = excluded.sent_on;

    continue when v_reminders = 0 and v_deadlines = 0;
    v_parts := '{}';
    if v_reminders > 0 then
      v_parts := v_parts || (v_reminders || case when v_reminders = 1 then ' reminder' else ' reminders' end);
    end if;
    if v_deadlines > 0 then
      v_parts := v_parts || (v_deadlines || case when v_deadlines = 1 then ' task due soon or late' else ' tasks due soon or late' end);
    end if;
    perform private.notify(r.profile_id, 'Your day in VentureTrack', 'Today: ' || array_to_string(v_parts, ', ') || '.',
      private.home_of(r.profile_id) || '/reminders');
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;

-- Every minute: wake the sender if something is waiting (a safety net if a wake-up was missed).
-- Every hour: morning summaries for whoever's clock just reached 8.
create function private.push_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.push_outbox where claimed_at is null) then
    perform private.kick_push();
  end if;
  delete from private.push_outbox where created_at < now() - interval '7 days';
end $$;

select cron.schedule('push-tick', '* * * * *', 'select private.push_tick()');
select cron.schedule('push-digests', '2 * * * *', 'select private.queue_digests()');


-- -----------------------------------------------------------------------------
-- For the send-push function and the "Send me a test" button
-- -----------------------------------------------------------------------------
-- Take up to p_limit waiting notes, with every device they should go to.
create function public.push_claim_batch(p_limit integer default 200)
returns table (outbox_id bigint, title text, body text, url text, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
    with claimed as (
      update private.push_outbox o set claimed_at = now()
      where o.id in (select id from private.push_outbox where claimed_at is null order by id limit p_limit for update skip locked)
      returning o.id, o.profile_id, o.title, o.body, o.url
    )
    select c.id, c.title, c.body, c.url, s.endpoint, s.p256dh, s.auth
    from claimed c join public.push_subscriptions s on s.profile_id = c.profile_id
    order by c.id;
end $$;

-- A device the push service no longer knows: forget it.
create function public.push_forget(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

create function public.push_test() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_member() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.push_subscriptions where profile_id = (select auth.uid())) then
    raise exception 'no_devices' using errcode = 'P0001';
  end if;
  perform private.notify((select auth.uid()), 'Notifications are on', 'This is how VentureTrack will let you know about new things.',
    private.home_of((select auth.uid())));
end $$;


-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on public.push_subscriptions from anon, authenticated;
revoke execute on function
  public.save_push_subscription(text, text, text, text, text), public.push_claim_batch(integer),
  public.push_forget(text), public.push_test()
  from public, anon, authenticated;
revoke all on function
  private.kick_push(), private.kick_push_after_insert(), private.notify(uuid, text, text, text), private.home_of(uuid),
  private.admin_id(), private.name_of(uuid), private.push_on_message(), private.push_on_task(), private.push_on_submission(),
  private.push_on_help(), private.push_on_poll(), private.push_on_shared_file(), private.queue_digests(boolean), private.push_tick()
  from public;

grant select, delete on public.push_subscriptions to authenticated;
grant execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.push_test()                                       to authenticated;
grant execute on function public.push_claim_batch(integer)                         to service_role;
grant execute on function public.push_forget(text)                                 to service_role;
grant all on public.push_subscriptions to service_role;
