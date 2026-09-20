-- Only one session can be live at a time. The console hides "New session" while one is running; this makes the
-- database refuse a second one too (two officers submitting together, a stale tab).

-- Ending a session, without the officer check, so this migration and end_session share one implementation.
create function public._end_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._lock_session(p_session_id);

  -- Mark the session ended first, so players still queued are recorded as "session ended", not "left".
  update public.open_play_sessions set status = 'ENDED', ended_at = clock_timestamp()
   where id = p_session_id;
  update public.rounds
     set status = case when status = 'ACTIVE' then 'COMPLETED'::public.round_status
                       else 'CANCELLED'::public.round_status end,
         ended_at = clock_timestamp()
   where session_id = p_session_id and status in ('FILLING', 'ACTIVE');
  update public.round_players set left_at = clock_timestamp()
   where left_at is null and round_id in (select id from public.rounds where session_id = p_session_id);
  update public.session_players
     set state = 'IDLE', queued_at = null, current_round_id = null, updated_at = clock_timestamp()
   where session_id = p_session_id and state <> 'IDLE';

  perform public._broadcast(p_session_id);
end $$;

revoke all on function public._end_session(uuid) from public, anon, authenticated;

create or replace function public.end_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_staff(true);
  perform public._end_session(p_session_id);
end $$;

-- Existing data: if several sessions are live, keep the newest (the one the QR poster already leads to).
select public._end_session(id)
  from public.open_play_sessions
 where status = 'ACTIVE'
   and id <> (select id from public.open_play_sessions where status = 'ACTIVE' order by started_at desc limit 1);

create unique index open_play_sessions_one_active on public.open_play_sessions ((true)) where status = 'ACTIVE';

-- A second live session trips the index; report it as a known error, not a raw unique violation.
create or replace function public.create_session(
  p_name text,
  p_court_count integer default 3,
  p_game_duration_seconds integer default 1200,
  p_code text default null,
  p_auto_requeue boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  perform public._require_staff(true);
  if p_court_count not between 1 and 30 then raise exception 'invalid_court_count'; end if;
  if v_code = '' then
    -- unambiguous alphabet (no 0/O/1/I)
    loop
      v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                                          1 + floor(random() * 32)::int, 1), '')
                   from generate_series(1, 6));
      exit when not exists (select 1 from public.open_play_sessions where code = v_code);
    end loop;
  end if;

  begin
    insert into public.open_play_sessions (code, name, game_duration_seconds, auto_requeue_on_finish)
    values (v_code, btrim(p_name), p_game_duration_seconds, p_auto_requeue)
    returning id into v_id;
  exception when unique_violation then
    if exists (select 1 from public.open_play_sessions where status = 'ACTIVE') then
      raise exception 'already_active';
    end if;
    raise; -- a code clash, not a second live session
  end;

  insert into public.courts (session_id, court_number)
  select v_id, n from generate_series(1, p_court_count) n;
  return v_id;
end $$;

-- At most one live session now, so there is nothing to order.
create or replace function public.get_active_session_code() returns text
language sql stable security definer set search_path = '' as $$
  select code from public.open_play_sessions where status = 'ACTIVE'
$$;
