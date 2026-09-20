-- Games end by themselves when their time is up, and the next game then starts on its own (auto-start).
-- Before, a game sat at "Time's up" until somebody tapped End game.

alter table public.open_play_sessions add column auto_finish boolean not null default true;

-- The bookkeeping of ending a game. Callers hold the session lock and check who may do it.
create function public._finish_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_round   public.rounds;
  v_session public.open_play_sessions;
  v_requeue uuid;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if not found or v_round.status <> 'ACTIVE' then return; end if;
  select * into v_session from public.open_play_sessions where id = v_round.session_id;

  if v_session.auto_requeue_on_finish then v_requeue := v_round.court_id; end if;

  update public.rounds set status = 'COMPLETED', ended_at = clock_timestamp(), paused_at = null
   where id = p_round_id;
  update public.round_players set left_at = clock_timestamp()
   where round_id = p_round_id and left_at is null;
  update public.session_players
     set state = case when v_session.auto_requeue_on_finish
                      then 'QUEUED'::public.player_state else 'IDLE'::public.player_state end,
         queued_at = case when v_session.auto_requeue_on_finish then clock_timestamp() end,
         preferred_court_id = v_requeue,
         current_round_id = null,
         updated_at = clock_timestamp()
   where current_round_id = p_round_id;

  perform public._allocate(v_round.session_id);
end $$;

-- End a game (early, or at time-up). Allowed for staff and for the players still in it. When the session ends
-- games automatically, anyone may report a game that is past its time (like start_round for a countdown);
-- the clock is checked here, so an early or repeated report does nothing. Idempotent.
create or replace function public.finish_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := public._require_user();
  v_session_id uuid;
  v_session    public.open_play_sessions;
  v_round      public.rounds;
begin
  select session_id into v_session_id from public.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  v_session := public._lock_session(v_session_id);

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.status = 'COMPLETED' then return; end if;  -- lost the race: no-op
  if v_round.status <> 'ACTIVE' then raise exception 'round_not_active'; end if;

  if public._staff_role() is null
     and not exists (select 1 from public.round_players where round_id = p_round_id and player_id = v_uid and left_at is null)
     and not (v_session.auto_finish and v_round.paused_at is null and v_round.ends_at <= clock_timestamp())
  then
    raise exception 'not_allowed';
  end if;

  perform public._finish_round(p_round_id);
  perform public._broadcast(v_session_id);
end $$;

-- Server-side timer: ends every running game that is past its time, in sessions that end games automatically.
create function public._finish_overdue_rounds() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select rd.id, rd.session_id
      from public.rounds rd join public.open_play_sessions s on s.id = rd.session_id
     where rd.status = 'ACTIVE' and rd.paused_at is null and rd.ends_at <= clock_timestamp()
       and s.status = 'ACTIVE' and s.auto_finish
     order by rd.session_id, rd.ends_at
  loop
    perform public._lock_session(r.session_id);
    if exists (select 1 from public.rounds where id = r.id and status = 'ACTIVE' and paused_at is null and ends_at <= clock_timestamp()) then
      perform public._finish_round(r.id);
      perform public._broadcast(r.session_id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public._finish_round(uuid), public._finish_overdue_rounds() from public, anon, authenticated;

-- Run the timer every 30 seconds where pg_cron exists (Supabase has it). Anywhere else, phones that have the
-- board open report time-up themselves, so games still end; only a room with no phone open would wait.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('finish-overdue-rounds', '30 seconds', 'select public._finish_overdue_rounds()');
exception when others then
  raise notice 'pg_cron unavailable (%): overdue games will be ended by open boards instead', sqlerrm;
end $$;

------------------------------------------------------------------ settings + snapshot

drop function public.update_session_settings(uuid, integer, boolean, boolean, integer);
create function public.update_session_settings(
  p_session_id uuid,
  p_game_duration_seconds integer,
  p_auto_requeue boolean,
  p_auto_start boolean,
  p_start_delay_seconds integer,
  p_auto_finish boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.open_play_sessions;
  v_round   uuid;
begin
  perform public._require_staff(true);
  v_session := public._lock_session(p_session_id);
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if p_game_duration_seconds not between 60 and 10800 then raise exception 'invalid_duration'; end if;
  if p_start_delay_seconds not between 0 and 300 then raise exception 'invalid_delay'; end if;

  -- Games already running keep the length they started with.
  update public.open_play_sessions
     set game_duration_seconds = p_game_duration_seconds,
         auto_requeue_on_finish = p_auto_requeue,
         auto_start = p_auto_start,
         start_delay_seconds = p_start_delay_seconds,
         auto_finish = p_auto_finish
   where id = p_session_id;

  -- Full courts re-evaluate under the new rules: restart their countdown, start now, or wait for a manual start.
  update public.rounds set start_at = null where session_id = p_session_id and status = 'FILLING';
  for v_round in select id from public.rounds where session_id = p_session_id and status = 'FILLING' loop
    perform public._sync_round(v_round);
  end loop;
  -- Turning automatic ending on also ends games that are already past their time.
  if p_auto_finish then perform public._finish_overdue_rounds(); end if;

  perform public._broadcast(p_session_id);
end $$;

create or replace function public.get_snapshot(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid     uuid := public._require_user();
  v_session public.open_play_sessions;
  v_me      jsonb;
begin
  select * into v_session from public.open_play_sessions where code = upper(btrim(p_code));
  if not found then return null; end if;

  select jsonb_build_object(
           'id', v_uid,
           'display_name', pr.display_name,
           'state', coalesce(sp.state::text, 'IDLE'),
           'round_id', sp.current_round_id,
           'preferred_court_id', sp.preferred_court_id,
           'queue_position', case when sp.state = 'QUEUED' then
              (select count(*) + 1 from public.session_players q
                where q.session_id = v_session.id and q.state = 'QUEUED'
                  and (q.queued_at, q.player_id) < (sp.queued_at, sp.player_id)) end,
           'role', public._staff_role())
    into v_me
    from (select 1) one
    left join public.profiles pr on pr.id = v_uid
    left join public.session_players sp
      on sp.session_id = v_session.id and sp.player_id = v_uid;

  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'session', jsonb_build_object(
      'id', v_session.id, 'code', v_session.code, 'name', v_session.name,
      'status', v_session.status,
      'game_duration_seconds', v_session.game_duration_seconds,
      'auto_requeue_on_finish', v_session.auto_requeue_on_finish,
      'auto_start', v_session.auto_start,
      'auto_finish', v_session.auto_finish,
      'start_delay_seconds', v_session.start_delay_seconds),
    'me', v_me,
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'court_number', c.court_number,
        'side_a_size', c.side_a_size, 'side_b_size', c.side_b_size, 'capacity', c.capacity,
        'round', (
          select jsonb_build_object(
            'id', r.id, 'status', r.status, 'started_at', r.started_at, 'ends_at', r.ends_at,
            'start_at', r.start_at, 'paused_at', r.paused_at,
            'players', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'player_id', rp.player_id, 'name', p.display_name, 'slot', rp.slot)
                     order by rp.slot)
                from public.round_players rp
                join public.profiles p on p.id = rp.player_id
               where rp.round_id = r.id and rp.left_at is null), '[]'::jsonb))
          from public.rounds r
         where r.court_id = c.id and r.status in ('FILLING', 'ACTIVE'))
      ) order by c.court_number)
      from public.courts c where c.session_id = v_session.id and c.removed_at is null), '[]'::jsonb),
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', q.player_id, 'name', p.display_name, 'position', q.pos,
               'court_number', c.court_number)
             order by q.pos)
        from (select sp.player_id, sp.preferred_court_id,
                     row_number() over (order by sp.queued_at, sp.player_id) as pos
                from public.session_players sp
               where sp.session_id = v_session.id and sp.state = 'QUEUED') q
        join public.profiles p on p.id = q.player_id
        left join public.courts c on c.id = q.preferred_court_id), '[]'::jsonb)
  );
end $$;

revoke all on function public.update_session_settings(uuid, integer, boolean, boolean, integer, boolean) from public, anon;
grant execute on function public.update_session_settings(uuid, integer, boolean, boolean, integer, boolean) to authenticated;
