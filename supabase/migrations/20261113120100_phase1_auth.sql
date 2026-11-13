-- =============================================================================
-- Phase 1 — accounts: invitation-only sign-up, admin provisioning, onboarding
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Every auth user gets a profile, created here and nowhere else.
--
-- Rule: a new account is only accepted if a pending, unexpired invitation exists
-- for its e-mail address. This holds even if public sign-up were enabled by
-- mistake in the Auth settings.
--
-- The single exception is the very first account in an empty installation: the
-- project owner creates it by hand and then promotes it with
-- private.provision_admin(). Until then it is an ordinary unprivileged account.
-- -----------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  inv         public.participant_invitations%rowtype;
  first_stage uuid;
begin
  if new.email is null or btrim(new.email) = '' then
    raise exception 'VentureTrack accounts require an e-mail address';
  end if;

  select i.* into inv
  from public.participant_invitations i
  where lower(i.email::text) = lower(new.email)
    and i.status = 'pending'
    and i.expires_at > now()
  for update;

  if found then
    select s.id into first_stage
    from public.stages s
    where not s.is_archived
    order by s.position
    limit 1;

    insert into public.profiles (id, email, full_name, current_stage_id, status)
    values (new.id, new.email, inv.full_name, coalesce(inv.initial_stage_id, first_stage), 'invited');

    update public.participant_invitations set profile_id = new.id where id = inv.id;
    return new;
  end if;

  if not exists (select 1 from public.profiles) then
    insert into public.profiles (id, email, full_name, status)
    values (
      new.id,
      new.email,
      left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), 120),
      'invited'
    );
    return new;
  end if;

  raise exception 'Registration is by invitation only';
end $$;

revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();


-- Keep profiles.email in step with the address used to sign in.
create function private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

revoke all on function private.handle_user_email_change() from public;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();


-- -----------------------------------------------------------------------------
-- Admin provisioning — the ONLY way the admin role is ever assigned.
--
-- Run once, as the database owner, in the SQL editor:
--     select private.provision_admin('you@example.com');
--
-- Not SECURITY DEFINER and not executable by any API role; `private` is not
-- exposed through the Data API either.
-- -----------------------------------------------------------------------------
create function private.provision_admin(admin_email text) returns uuid
language plpgsql set search_path = '' as $$
declare
  target record;
begin
  select u.id, u.email_confirmed_at into target
  from auth.users u
  where lower(u.email) = lower(btrim(admin_email));

  if not found then
    raise exception 'No account exists for %. Create it first under Authentication > Users.', admin_email;
  end if;
  if target.email_confirmed_at is null then
    raise exception 'The e-mail address % has not been confirmed yet.', admin_email;
  end if;
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'An administrator already exists. There can only be one.';
  end if;
  if exists (select 1 from public.profiles where id <> target.id) then
    raise exception 'Other accounts already exist. The administrator must be provisioned on an empty installation.';
  end if;

  update public.profiles
  set role = 'admin', status = 'active', joined_at = now(), current_stage_id = null
  where id = target.id;

  if not found then
    raise exception 'The account % has no profile.', admin_email;
  end if;

  return target.id;
end $$;

revoke all on function private.provision_admin(text) from public;


-- -----------------------------------------------------------------------------
-- Onboarding: called by an invited participant after choosing a password.
-- Idempotent; does nothing for accounts that are not in the 'invited' state.
-- -----------------------------------------------------------------------------
create function public.accept_invitation() returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;

  -- Reaching this point already proves control of the invited mailbox: the only
  -- way to hold a session for an 'invited' account is the one-time e-mail link.
  -- (The app sets the password first; whether one was chosen cannot be told
  -- from the database, because the auth server stores a placeholder hash.)
  update public.profiles
  set status = 'active', joined_at = coalesce(joined_at, now())
  where id = uid and role = 'participant' and status = 'invited';

  update public.participant_invitations
  set status = 'accepted', accepted_at = now()
  where profile_id = uid and status = 'pending';
end $$;

revoke all on function public.accept_invitation() from public, anon;
grant execute on function public.accept_invitation() to authenticated;


-- "Last activity" heartbeat, throttled to one write per five minutes.
create function public.touch_last_active() returns void
language sql security definer set search_path = '' as $$
  update public.profiles
  set last_active_at = now()
  where id = (select auth.uid())
    and (last_active_at is null or last_active_at < now() - interval '5 minutes');
$$;

revoke all on function public.touch_last_active() from public, anon;
grant execute on function public.touch_last_active() to authenticated;
