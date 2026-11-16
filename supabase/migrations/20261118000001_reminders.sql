-- =============================================================================
-- Reminders: the administrator's own follow-ups
--
-- Rules enforced here:
--   * Only the administrator can see, create, change or delete reminders.
--     Participants never see them, even ones about themselves.
--   * A reminder is marked done only through complete_reminder(). A repeating
--     reminder then moves on to its next date instead of being closed.
-- =============================================================================

create type public.reminder_repeat as enum ('none', 'weekly', 'monthly');

create table public.reminders (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  participant_id uuid references public.profiles (id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  note           text check (char_length(note) <= 2000),
  due_on         date not null,
  repeats        public.reminder_repeat not null default 'none',
  done_at        timestamptz,
  created_at     timestamptz not null default now(),
  constraint reminders_repeating_never_done check (repeats = 'none' or done_at is null)
);
create index reminders_open_due_idx    on public.reminders (due_on) where done_at is null;
create index reminders_owner_idx       on public.reminders (owner_id);
create index reminders_participant_idx on public.reminders (participant_id);

-- A reminder can only be about a participant.
create function private.reminders_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.participant_id is not null
     and not exists (select 1 from public.profiles where id = new.participant_id and role = 'participant') then
    raise exception 'person_not_found' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    new.owner_id := coalesce((select auth.uid()), new.owner_id);
    new.done_at := null;
  end if;
  return new;
end $$;
revoke all on function private.reminders_guard() from public;
create trigger reminders_guard before insert or update on public.reminders
  for each row execute function private.reminders_guard();

alter table public.reminders enable row level security;
create policy "reminders: admin only"
  on public.reminders for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create function public.complete_reminder(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.reminders;
  v_next date;
  v_steps integer := 0;
begin
  if not private.is_admin() then
    raise exception 'only the administrator can do this' using errcode = '42501';
  end if;
  select * into r from public.reminders where id = p_id and done_at is null for update;
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

revoke all on public.reminders from anon, authenticated;
revoke execute on function public.complete_reminder(uuid) from public, anon, authenticated;
grant select, delete on public.reminders to authenticated;
grant insert (participant_id, title, note, due_on, repeats) on public.reminders to authenticated;
grant update (participant_id, title, note, due_on, repeats) on public.reminders to authenticated;
grant execute on function public.complete_reminder(uuid) to authenticated;
grant all on public.reminders to service_role;
