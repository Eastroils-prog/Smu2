-- Invitations and password resets are delivered as links that the
-- administrator copies and sends personally (no e-mail provider needed).
--
-- The Edge Function asks the database, with the caller's own token, whether
-- the caller may create a reset link for a given person. Only the
-- administrator may, and only for a participant who has already joined.

create function public.reset_link_target(p_profile_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  if not private.is_admin() then
    raise exception 'only the administrator can create reset links' using errcode = '42501';
  end if;

  select email::text into v_email
  from public.profiles
  where id = p_profile_id and role = 'participant' and status <> 'invited';

  if v_email is null then
    raise exception 'person_not_found' using errcode = 'P0001';
  end if;
  return v_email;
end $$;

revoke execute on function public.reset_link_target(uuid) from public, anon, authenticated;
grant execute on function public.reset_link_target(uuid) to authenticated;
