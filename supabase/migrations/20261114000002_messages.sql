-- =============================================================================
-- Private messages between two people
--
-- Rules enforced here:
--   * A message is readable only by its sender and its recipient. The
--     administrator cannot read messages between two participants.
--   * Messages can only be sent to the administrator or to a participant who
--     has joined and is not archived; archived or not-yet-joined people
--     cannot send.
--   * Messages cannot be edited or deleted through the API.
--   * Participants can see each other's NAMES (to choose who to write to),
--     and nothing else about each other.
-- =============================================================================

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body         text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  constraint messages_not_to_self check (sender_id <> recipient_id)
);
create index messages_sender_idx    on public.messages (sender_id, recipient_id, created_at);
create index messages_recipient_idx on public.messages (recipient_id, sender_id, created_at);
create index messages_unread_idx    on public.messages (recipient_id) where read_at is null;

alter table public.messages enable row level security;
create policy "messages: read only as sender or recipient"
  on public.messages for select to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));
-- No writes through the API. See send_message / mark_conversation_read.

-- Someone who may take part in conversations: the admin, or a joined,
-- non-archived participant.
create function private.can_message(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = p_id and status <> 'invited' and archived_at is null
  );
$$;
revoke all on function private.can_message(uuid) from public;

-- The names people may write to. No e-mail, no username, no programme details.
create function public.directory()
returns table (id uuid, full_name text, is_owner boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.role = 'admin'
  from public.profiles p
  where p.status <> 'invited' and p.archived_at is null
    and p.id <> (select auth.uid())
    -- only for people who have joined themselves
    and exists (select 1 from public.profiles me where me.id = (select auth.uid()) and me.status <> 'invited')
  order by (p.role = 'admin') desc, p.full_name;
$$;

create function public.send_message(p_to uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null or not private.can_message(v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_to is null or p_to = v_uid or not private.can_message(p_to) then
    raise exception 'recipient_not_available' using errcode = 'P0001';
  end if;
  insert into public.messages (sender_id, recipient_id, body)
  values (v_uid, p_to, btrim(p_body))
  returning id into v_id;
  update public.profiles set last_active_at = now() where id = v_uid;
  return v_id;
end $$;

create function public.mark_conversation_read(p_other uuid) returns void
language sql security definer set search_path = '' as $$
  update public.messages set read_at = now()
  where recipient_id = (select auth.uid()) and sender_id = p_other and read_at is null;
$$;

revoke all on public.messages from anon, authenticated;
revoke execute on function public.directory(), public.send_message(uuid, text), public.mark_conversation_read(uuid)
  from public, anon, authenticated;

grant select on public.messages to authenticated;
grant execute on function public.directory()                    to authenticated;
grant execute on function public.send_message(uuid, text)       to authenticated;
grant execute on function public.mark_conversation_read(uuid)   to authenticated;
grant all on public.messages to service_role;
