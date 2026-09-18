-- Let an idle player pick a court instead of taking whatever the allocator offers.
-- This can't jump the queue: the allocator fills every free slot from the queue straight away, so a
-- court only has room while the queue is empty. Choosing just decides *which* court with room.
create function public.join_court(p_court_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := public._require_user();
  v_court     public.courts;
  v_session   public.open_play_sessions;
  v_round_id  uuid;
  v_round_status public.round_status;
  v_filled    integer := 0;
  v_slot      integer;
begin
  select * into v_court from public.courts where id = p_court_id;
  if not found then raise exception 'court_not_found'; end if;

  v_session := public._lock_session(v_court.session_id);
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile_required';
  end if;

  -- Already queued or playing: nothing to choose. Same churn throttle as join_queue.
  if exists (select 1 from public.session_players
              where session_id = v_session.id and player_id = v_uid and state <> 'IDLE') then
    return;
  end if;
  if exists (select 1 from public.session_players
              where session_id = v_session.id and player_id = v_uid
                and updated_at > clock_timestamp() - interval '2 seconds') then
    raise exception 'too_fast';
  end if;

  -- Re-read the court under the session lock: it may have filled or paused since the player looked.
  select c.status into v_court.status from public.courts c where c.id = p_court_id;
  select r.id, r.status into v_round_id, v_round_status
    from public.rounds r where r.court_id = p_court_id and r.status in ('FILLING', 'ACTIVE');
  if v_round_id is not null then
    select count(*) into v_filled from public.round_players where round_id = v_round_id and left_at is null;
  end if;
  if v_court.status <> 'OPEN' or v_round_status = 'ACTIVE' or v_filled >= 4 then
    raise exception 'court_unavailable';
  end if;

  if v_round_id is null then
    insert into public.rounds (session_id, court_id) values (v_session.id, p_court_id)
    returning id into v_round_id;
  end if;

  select min(s) into v_slot from generate_series(1, 4) s
   where not exists (select 1 from public.round_players
                      where round_id = v_round_id and slot = s and left_at is null);

  insert into public.round_players (round_id, player_id, slot) values (v_round_id, v_uid, v_slot);

  insert into public.session_players (session_id, player_id, state, current_round_id)
  values (v_session.id, v_uid, 'PLAYING', v_round_id)
  on conflict (session_id, player_id) do update
     set state = 'PLAYING', queued_at = null, current_round_id = v_round_id, updated_at = clock_timestamp();

  if v_filled + 1 = 4 then
    update public.rounds
       set status = 'ACTIVE', started_at = clock_timestamp(),
           ends_at = clock_timestamp() + make_interval(secs => v_session.game_duration_seconds)
     where id = v_round_id;
  end if;

  perform public._broadcast(v_session.id);
end $$;

revoke all on function public.join_court(uuid) from public, anon;
grant execute on function public.join_court(uuid) to authenticated;
