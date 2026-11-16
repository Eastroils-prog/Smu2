-- =============================================================================
-- Reminders for everyone
--
-- Every person who has joined can keep their own reminders. A reminder is
-- visible only to the person who made it. Only the administrator can attach a
-- reminder to a participant. (Reminders about task deadlines are not stored:
-- the app works them out from the tasks each person can already see.)
-- =============================================================================

drop policy "reminders: admin only" on public.reminders;

create policy "reminders: read your own"
  on public.reminders for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "reminders: members add their own"
  on public.reminders for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.is_member()));
create policy "reminders: change your own"
  on public.reminders for update to authenticated
  using      (owner_id = (select auth.uid()) and (select private.is_member()))
  with check (owner_id = (select auth.uid()) and (select private.is_member()));
create policy "reminders: delete your own"
  on public.reminders for delete to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_member()));

create or replace function private.reminders_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.participant_id is not null then
    -- (This runs as the function owner, so check who is signed in, not current_user.)
    if (select auth.uid()) is not null and not private.is_admin() then
      raise exception 'only the administrator can link a reminder to a person' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles where id = new.participant_id and role = 'participant') then
      raise exception 'person_not_found' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.owner_id := coalesce((select auth.uid()), new.owner_id);
    new.done_at := null;
  elsif new.owner_id is distinct from old.owner_id then
    raise exception 'a reminder cannot change hands' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.complete_reminder(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.reminders;
  v_next date;
  v_steps integer := 0;
begin
  if not private.is_member() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.reminders
  where id = p_id and owner_id = (select auth.uid()) and done_at is null
  for update;
  if not found then
    raise exception 'reminder_not_found' using errcode = 'P0001';
  end if;

  if r.repeats = 'none' then
    update public.reminders set done_at = now() where id = p_id;
    return;
  end if;

  -- Move to the next date after today, keeping the same weekday or day of the
  -- month (a reminder on the 31st falls on the last day of shorter months).
  loop
    v_steps := v_steps + 1;
    v_next := case r.repeats
                when 'weekly' then r.due_on + 7 * v_steps
                else (r.due_on + make_interval(months => v_steps))::date
              end;
    exit when v_next > current_date;
  end loop;
  update public.reminders set due_on = v_next where id = p_id;
end $$;
