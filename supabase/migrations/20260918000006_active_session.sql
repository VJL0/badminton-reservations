-- Lets the permanent QR poster (which points at "/") find tonight's session.
-- Exposes only the code of the newest ACTIVE session, which is already public on the poster.
create function public.get_active_session_code() returns text
language sql stable security definer set search_path = '' as $$
  select code from public.open_play_sessions
   where status = 'ACTIVE'
   order by started_at desc
   limit 1
$$;

revoke all on function public.get_active_session_code() from public;
grant execute on function public.get_active_session_code() to anon, authenticated;
