-- Fixes found by `supabase db lint` (plpgsql_check).

-- Both read the clock (clock_timestamp() is volatile), so they must not claim to be STABLE: the planner
-- is allowed to reuse the result of a STABLE function within one statement.
alter function public.get_snapshot(text) volatile;
alter function public.get_session_summary(uuid) volatile;

-- Leftover from when courts could be paused: the row was fetched but only its existence mattered.
create or replace function public.join_queue(p_session_id uuid, p_court_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := public._require_user();
  v_session public.open_play_sessions := public._lock_session(p_session_id);
  v_sp      public.session_players;
begin
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile_required';
  end if;
  if p_court_id is not null then
    if not exists (select 1 from public.courts where id = p_court_id and session_id = p_session_id and removed_at is null) then
      raise exception 'court_not_found';
    end if;
  end if;

  select * into v_sp from public.session_players where session_id = p_session_id and player_id = v_uid;
  if found and v_sp.state = 'PLAYING' then return; end if;
  if found and v_sp.state = 'QUEUED' then
    if v_sp.preferred_court_id is distinct from p_court_id then
      update public.session_players set preferred_court_id = p_court_id, updated_at = clock_timestamp()
       where session_id = p_session_id and player_id = v_uid;
      perform public._allocate(p_session_id);
      perform public._broadcast(p_session_id);
    end if;
    return;
  end if;

  -- Throttle leave/join churn: every state change fans out a broadcast to the whole room.
  if found and v_sp.updated_at > clock_timestamp() - interval '2 seconds' then
    raise exception 'too_fast';
  end if;

  if (select count(*) from public.session_players
       where session_id = p_session_id and state = 'QUEUED') >= v_session.max_queue_size then
    -- Only refuse if they'd actually add to the queue; a free court would place them immediately.
    if not exists (
      select 1 from public.courts c
       where c.session_id = p_session_id and c.removed_at is null
         and (p_court_id is null or c.id = p_court_id)
         and not exists (select 1 from public.rounds r where r.court_id = c.id and r.status = 'ACTIVE')
         and (select count(*) from public.round_players rp
                join public.rounds r on r.id = rp.round_id
               where r.court_id = c.id and r.status = 'FILLING' and rp.left_at is null) < c.capacity
    ) then
      raise exception 'queue_full';
    end if;
  end if;

  insert into public.session_players (session_id, player_id, state, queued_at, preferred_court_id)
  values (p_session_id, v_uid, 'QUEUED', clock_timestamp(), p_court_id)
  on conflict (session_id, player_id) do update
     set state = 'QUEUED', queued_at = clock_timestamp(), preferred_court_id = p_court_id,
         updated_at = clock_timestamp();

  perform public._allocate(p_session_id);
  perform public._broadcast(p_session_id);
end $$;
