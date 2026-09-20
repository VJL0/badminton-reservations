-- Admins can delete an ended session. Rounds, players, courts and queue history go with it (on delete cascade).
-- A live session has to be ended first, so nobody is on the board when it disappears.
create function public.delete_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_session public.open_play_sessions;
begin
  perform public._require_staff(true);
  v_session := public._lock_session(p_session_id);
  if v_session.status <> 'ENDED' then raise exception 'session_active'; end if;
  delete from public.open_play_sessions where id = p_session_id;
end $$;

revoke all on function public.delete_session(uuid) from public, anon;
grant execute on function public.delete_session(uuid) to authenticated;
