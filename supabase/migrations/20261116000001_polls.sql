-- =============================================================================
-- Polls
--
-- Rules enforced here:
--   * Only the administrator creates, closes and deletes polls.
--   * Everyone who has joined (and is not archived) can vote, and can change
--     their vote until the poll is closed.
--   * A single-choice poll takes exactly one choice; a multi-choice poll takes
--     one or more.
--   * Votes are anonymous: nobody, including the administrator, can read who
--     voted for what. People read their OWN votes, and the totals.
--   * Totals are shown to someone after they have voted, once the poll is
--     closed, and to the administrator at any time.
-- =============================================================================

create table public.polls (
  id             uuid primary key default gen_random_uuid(),
  question       text not null check (char_length(btrim(question)) between 1 and 300),
  allow_multiple boolean not null default false,
  created_by     uuid not null references public.profiles (id),
  created_at     timestamptz not null default now(),
  closed_at      timestamptz
);
create index polls_created_by_idx on public.polls (created_by);

create table public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls (id) on delete cascade,
  label    text not null check (char_length(btrim(label)) between 1 and 200),
  position integer not null,
  constraint poll_options_position_key unique (poll_id, position),
  constraint poll_options_id_poll_key  unique (id, poll_id)
);

create table public.poll_votes (
  poll_id    uuid not null,
  option_id  uuid not null,
  voter_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, voter_id),
  -- A vote can only point at a choice that belongs to the same poll.
  constraint poll_votes_option_fkey foreign key (option_id, poll_id)
    references public.poll_options (id, poll_id) on delete cascade
);
create index poll_votes_poll_voter_idx on public.poll_votes (poll_id, voter_id);
create index poll_votes_voter_idx      on public.poll_votes (voter_id);

alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

create policy "polls: members read"
  on public.polls for select to authenticated
  using ((select private.is_member()) or (select private.is_admin()));
create policy "polls: admin deletes"
  on public.polls for delete to authenticated
  using ((select private.is_admin()));
create policy "poll options: members read"
  on public.poll_options for select to authenticated
  using ((select private.is_member()) or (select private.is_admin()));
-- Only your own votes, never anyone else's (not even for the administrator).
create policy "poll votes: read your own"
  on public.poll_votes for select to authenticated
  using (voter_id = (select auth.uid()));


create function public.create_poll(p_question text, p_options text[], p_allow_multiple boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_labels text[];
  v_label text;
  v_position integer := 0;
begin
  if not private.is_admin() then
    raise exception 'only the administrator can create polls' using errcode = '42501';
  end if;
  select coalesce(array_agg(btrim(o) order by n), '{}') into v_labels
  from unnest(p_options) with ordinality as t(o, n)
  where nullif(btrim(o), '') is not null;
  if cardinality(v_labels) < 2 then
    raise exception 'too_few_choices' using errcode = 'P0001';
  end if;
  if cardinality(v_labels) > 10 then
    raise exception 'too_many_choices' using errcode = 'P0001';
  end if;
  if (select count(distinct lower(l)) from unnest(v_labels) l) <> cardinality(v_labels) then
    raise exception 'duplicate_choices' using errcode = 'P0001';
  end if;

  insert into public.polls (question, allow_multiple, created_by)
  values (btrim(p_question), coalesce(p_allow_multiple, false), (select auth.uid()))
  returning id into v_id;
  foreach v_label in array v_labels loop
    v_position := v_position + 1;
    insert into public.poll_options (poll_id, label, position) values (v_id, v_label, v_position);
  end loop;
  return v_id;
end $$;

-- Replaces the caller's earlier vote on this poll.
create function public.cast_vote(p_poll_id uuid, p_option_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll public.polls;
  v_chosen uuid[];
begin
  if v_uid is null or not private.is_member() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_poll from public.polls where id = p_poll_id;
  if not found then
    raise exception 'poll_not_found' using errcode = 'P0001';
  end if;
  if v_poll.closed_at is not null then
    raise exception 'poll_closed' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct c), '{}') into v_chosen from unnest(p_option_ids) c where c is not null;
  if cardinality(v_chosen) = 0 then
    raise exception 'no_choice' using errcode = 'P0001';
  end if;
  if not v_poll.allow_multiple and cardinality(v_chosen) > 1 then
    raise exception 'one_choice_only' using errcode = 'P0001';
  end if;
  if (select count(*) from public.poll_options where poll_id = p_poll_id and id = any (v_chosen)) <> cardinality(v_chosen) then
    raise exception 'choice_not_in_poll' using errcode = 'P0001';
  end if;

  delete from public.poll_votes where poll_id = p_poll_id and voter_id = v_uid;
  insert into public.poll_votes (poll_id, option_id, voter_id)
  select p_poll_id, c, v_uid from unnest(v_chosen) c;
end $$;

-- Vote totals for one poll, when the caller may see them; otherwise no rows.
create function public.poll_results(p_poll_id uuid)
returns table (option_id uuid, votes bigint, voters bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_member() or private.is_admin()) then
    return;
  end if;
  if not (
    private.is_admin()
    or exists (select 1 from public.polls where id = p_poll_id and closed_at is not null)
    or exists (select 1 from public.poll_votes where poll_id = p_poll_id and voter_id = (select auth.uid()))
  ) then
    return;
  end if;
  return query
    select o.id,
           (select count(*) from public.poll_votes v where v.option_id = o.id),
           (select count(distinct v.voter_id) from public.poll_votes v where v.poll_id = p_poll_id)
    from public.poll_options o
    where o.poll_id = p_poll_id
    order by o.position;
end $$;

create function public.close_poll(p_poll_id uuid, p_close boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'only the administrator can close polls' using errcode = '42501';
  end if;
  update public.polls set closed_at = case when p_close then now() end where id = p_poll_id;
  if not found then
    raise exception 'poll_not_found' using errcode = 'P0001';
  end if;
end $$;

revoke all on public.polls, public.poll_options, public.poll_votes from anon, authenticated;
revoke execute on function public.create_poll(text, text[], boolean), public.cast_vote(uuid, uuid[]),
  public.poll_results(uuid), public.close_poll(uuid, boolean) from public, anon, authenticated;

grant select, delete on public.polls to authenticated;
grant select on public.poll_options, public.poll_votes to authenticated;
grant execute on function public.create_poll(text, text[], boolean) to authenticated;
grant execute on function public.cast_vote(uuid, uuid[])             to authenticated;
grant execute on function public.poll_results(uuid)                  to authenticated;
grant execute on function public.close_poll(uuid, boolean)           to authenticated;
grant all on public.polls, public.poll_options, public.poll_votes to service_role;
