-- Replace the staff email/password/role system with one shared staff code, verified by the Next.js
-- app (never in the database). Staff no longer have a Supabase identity: the database can't check
-- "is this JWT staff" any more, so every staff-only function is re-anchored to the Postgres
-- `service_role` instead — reachable only through the app's service-role client, which the app only
-- uses once it has verified the caller's signed staff-code cookie. `authenticated` keeps calling the
-- "mixed" functions (finish/start/pause/resume a round) directly; only their staff-bypass branch
-- changes from "has a public.staff row" to "is the service role".

create function public._require_service_role() returns void
language plpgsql stable set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_staff';
  end if;
end $$;

------------------------------------------------------------------ staff-only functions

create or replace function public.remove_player(p_session_id uuid, p_player_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_service_role();
  perform public._lock_session(p_session_id);
  perform public._leave(p_session_id, p_player_id, false);
  perform public._allocate(p_session_id);
  perform public._broadcast(p_session_id);
end $$;

create or replace function public.list_sessions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_service_role();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'name', s.name, 'status', s.status,
      'created_at', s.created_at, 'ended_at', s.ended_at,
      'courts', (select count(*) from public.courts c where c.session_id = s.id and c.removed_at is null),
      'players', (select count(*) from public.session_players p where p.session_id = s.id)
    ) order by s.created_at desc)
    from public.open_play_sessions s), '[]'::jsonb);
end $$;

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
  perform public._require_service_role();
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

create or replace function public.end_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_service_role();
  perform public._end_session(p_session_id);
end $$;

create or replace function public.update_session_settings(
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
  perform public._require_service_role();
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

create or replace function public.add_court(p_session_id uuid, p_side_a integer default 2, p_side_b integer default 2)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_session public.open_play_sessions;
begin
  perform public._require_service_role();
  v_session := public._lock_session(p_session_id);
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if p_side_a not between 1 and 4 or p_side_b not between 1 and 4 then raise exception 'invalid_court_format'; end if;
  if (select count(*) from public.courts where session_id = p_session_id and removed_at is null) >= 30 then
    raise exception 'too_many_courts';
  end if;

  insert into public.courts (session_id, court_number, side_a_size, side_b_size)
  select p_session_id, coalesce(max(court_number), 0) + 1, p_side_a, p_side_b
    from public.courts where session_id = p_session_id;

  perform public._allocate(p_session_id);  -- a new court can seat people who were waiting
  perform public._broadcast(p_session_id);
end $$;

create or replace function public.update_court(p_court_id uuid, p_side_a integer, p_side_b integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_court      public.courts;
  v_session    public.open_play_sessions;
  v_round      public.rounds;
  v_capacity   integer := p_side_a + p_side_b;
begin
  perform public._require_service_role();
  select * into v_court from public.courts where id = p_court_id and removed_at is null;
  if not found then raise exception 'court_not_found'; end if;
  v_session := public._lock_session(v_court.session_id);
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if p_side_a not between 1 and 4 or p_side_b not between 1 and 4 then raise exception 'invalid_court_format'; end if;

  select * into v_round from public.rounds where court_id = p_court_id and status in ('FILLING', 'ACTIVE');
  if found and v_round.status = 'ACTIVE' then raise exception 'game_in_progress'; end if;

  update public.courts set side_a_size = p_side_a, side_b_size = p_side_b where id = p_court_id;

  if v_round.id is not null then
    -- Release everyone past the new capacity in one go: releasing one at a time could start the
    -- game (court now "full") before the rest are out.
    with gone as (
      update public.round_players set left_at = clock_timestamp()
       where round_id = v_round.id and left_at is null and slot > v_capacity
      returning player_id)
    update public.session_players sp
       set state = 'QUEUED', queued_at = coalesce(sp.queued_at, clock_timestamp()),
           current_round_id = null, preferred_court_id = null, updated_at = clock_timestamp()
      from gone
     where sp.session_id = v_court.session_id and sp.player_id = gone.player_id;

    if exists (select 1 from public.round_players where round_id = v_round.id and left_at is null) then
      perform public._sync_round(v_round.id);
    else
      update public.rounds set status = 'CANCELLED', ended_at = clock_timestamp(), start_at = null
       where id = v_round.id;
    end if;
  end if;

  perform public._allocate(v_court.session_id);
  perform public._broadcast(v_court.session_id);
end $$;

create or replace function public.delete_court(p_court_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_court   public.courts;
  v_session public.open_play_sessions;
  v_round   public.rounds;
begin
  perform public._require_service_role();
  select * into v_court from public.courts where id = p_court_id and removed_at is null;
  if not found then raise exception 'court_not_found'; end if;
  v_session := public._lock_session(v_court.session_id);
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if (select count(*) from public.courts where session_id = v_court.session_id and removed_at is null) <= 1 then
    raise exception 'last_court';
  end if;

  select * into v_round from public.rounds where court_id = p_court_id and status in ('FILLING', 'ACTIVE');
  if found and v_round.status = 'ACTIVE' then raise exception 'game_in_progress'; end if;
  if found then
    with gone as (
      update public.round_players set left_at = clock_timestamp()
       where round_id = v_round.id and left_at is null
      returning player_id)
    update public.session_players sp
       set state = 'QUEUED', queued_at = coalesce(sp.queued_at, clock_timestamp()),
           current_round_id = null, preferred_court_id = null, updated_at = clock_timestamp()
      from gone
     where sp.session_id = v_court.session_id and sp.player_id = gone.player_id;
    update public.rounds set status = 'CANCELLED', ended_at = clock_timestamp(), start_at = null
     where id = v_round.id;
  end if;

  update public.courts set removed_at = clock_timestamp() where id = p_court_id;
  update public.session_players set preferred_court_id = null where preferred_court_id = p_court_id;

  perform public._allocate(v_court.session_id);
  perform public._broadcast(v_court.session_id);
end $$;

create or replace function public.delete_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_session public.open_play_sessions;
begin
  perform public._require_service_role();
  v_session := public._lock_session(p_session_id);
  if v_session.status <> 'ENDED' then raise exception 'session_active'; end if;
  delete from public.open_play_sessions where id = p_session_id;
end $$;

-- Staff-only. Works for live sessions too (everything measured up to now). Reads the clock
-- (clock_timestamp()), so it must stay volatile, not stable (see 20260919000009_lint_fixes.sql).
create or replace function public.get_session_summary(p_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      public.open_play_sessions;
  v_end    timestamptz;
  v_long   integer;   -- a wait longer than this is flagged: one full game, at least 10 minutes
begin
  perform public._require_service_role();
  select * into v_s from public.open_play_sessions where id = p_session_id;
  if not found then return null; end if;
  v_end := coalesce(v_s.ended_at, clock_timestamp());
  v_long := greatest(600, v_s.game_duration_seconds);

  return (
    with
    entries as (
      select e.*, extract(epoch from coalesce(e.ended_at, v_end) - e.queued_at)::numeric as secs
        from public.queue_entries e where e.session_id = p_session_id),
    counted as (select * from entries where outcome is null or outcome in ('ASSIGNED', 'SESSION_ENDED')),
    seats as (
      select rp.player_id, r.id as round_id, r.court_id, r.started_at, rp.joined_at,
             coalesce(rp.left_at, r.ended_at, v_end) as out_at
        from public.round_players rp join public.rounds r on r.id = rp.round_id
       where r.session_id = p_session_id),
    seat_calc as (
      select player_id, round_id, started_at,
             case when started_at is not null and out_at > greatest(joined_at, started_at)
                  then extract(epoch from out_at - greatest(joined_at, started_at)) else 0 end as playing,
             greatest(0, extract(epoch from least(coalesce(started_at, out_at), out_at) - joined_at)) as court_wait,
             out_at
        from seats),
    per_player as (
      select sp.player_id, pr.display_name as name,
             coalesce((select count(distinct sc.round_id) from seat_calc sc
                        where sc.player_id = sp.player_id and sc.started_at is not null), 0) as games,
             coalesce((select sum(sc.playing) from seat_calc sc where sc.player_id = sp.player_id), 0) as playing,
             coalesce((select sum(c.secs) from counted c where c.player_id = sp.player_id), 0)
               + coalesce((select sum(sc.court_wait) from seat_calc sc where sc.player_id = sp.player_id), 0) as waiting,
             (select max(c.secs) from counted c where c.player_id = sp.player_id) as longest,
             least(sp.joined_at,
                   coalesce((select min(e.queued_at) from entries e where e.player_id = sp.player_id), sp.joined_at),
                   coalesce((select min(s.joined_at) from seats s where s.player_id = sp.player_id), sp.joined_at)) as first_seen,
             least(v_end, greatest(sp.updated_at,
                   coalesce((select max(coalesce(e.ended_at, v_end)) from entries e where e.player_id = sp.player_id), sp.joined_at),
                   coalesce((select max(sc.out_at) from seat_calc sc where sc.player_id = sp.player_id), sp.joined_at))) as last_seen
        from public.session_players sp join public.profiles pr on pr.id = sp.player_id
       where sp.session_id = p_session_id),
    players as (
      select pp.*, extract(epoch from pp.last_seen - pp.first_seen) as present,
             array_remove(array[
               case when pp.games = 0 and extract(epoch from pp.last_seen - pp.first_seen) >= 600 then 'no_games' end,
               case when coalesce(pp.longest, 0) >= v_long then 'long_wait' end], null) as flags
        from per_player pp),
    peak_q as (
      select coalesce(max(c), 0) as n from (
        select sum(delta) over (order by t, delta) as c from (
          select queued_at as t, 1 as delta from entries
          union all select coalesce(ended_at, v_end), -1 from entries) x) y),
    peak_p as (
      select coalesce(max(c), 0) as n from (
        select sum(delta) over (order by t, delta) as c from (
          select first_seen as t, 1 as delta from players
          union all select last_seen, -1 from players) x) y),
    -- How many were waiting, as steps over time: [t, next t) had n people in the queue.
    q_steps as (
      select t, lead(t) over (order by t, delta) as t2, sum(delta) over (order by t, delta) as n
        from (select queued_at as t, 1 as delta from entries
              union all select coalesce(ended_at, v_end), -1 from entries) x),
    court_calc as (
      select c.id, c.court_number, c.removed_at, c.side_a_size, c.side_b_size, c.capacity,
             greatest(c.created_at, v_s.started_at) as ws,
             least(coalesce(c.removed_at, v_end), v_end) as we
        from public.courts c where c.session_id = p_session_id),
    courts as (
      select cc.*,
             greatest(0, extract(epoch from cc.we - cc.ws)) as window_s,
             coalesce((select sum(extract(epoch from least(coalesce(r.ended_at, v_end), cc.we) - greatest(r.started_at, cc.ws)))
                         from public.rounds r
                        where r.court_id = cc.id and r.started_at is not null
                          and least(coalesce(r.ended_at, v_end), cc.we) > greatest(r.started_at, cc.ws)), 0) as busy_s,
             (select coalesce(sum(extract(epoch from upper(x) - lower(x))), 0)
                from unnest(
                  (tstzmultirange(tstzrange(cc.ws, cc.we))
                    - coalesce((select range_agg(tstzrange(greatest(r.started_at, cc.ws), least(coalesce(r.ended_at, v_end), cc.we)))
                                  from public.rounds r
                                 where r.court_id = cc.id and r.started_at is not null
                                   and least(coalesce(r.ended_at, v_end), cc.we) > greatest(r.started_at, cc.ws)),
                               '{}'::tstzmultirange))
                  * coalesce((select range_agg(tstzrange(qs.t, qs.t2)) from q_steps qs
                               where qs.t2 > qs.t and qs.n >= cc.capacity), '{}'::tstzmultirange)) as x) as idle_backed_s
        from court_calc cc where cc.we > cc.ws),
    games as (
      select r.id, c.court_number, r.started_at, r.ended_at,
             coalesce((select jsonb_agg(pr.display_name order by rp.slot)
                         from public.round_players rp join public.profiles pr on pr.id = rp.player_id
                        where rp.round_id = r.id), '[]'::jsonb) as names
        from public.rounds r join public.courts c on c.id = r.court_id
       where r.session_id = p_session_id and r.started_at is not null)
    select jsonb_build_object(
      'session', jsonb_build_object(
        'id', v_s.id, 'code', v_s.code, 'name', v_s.name, 'status', v_s.status,
        'started_at', v_s.started_at, 'ended_at', v_s.ended_at, 'now', clock_timestamp(),
        'game_duration_seconds', v_s.game_duration_seconds,
        'auto_requeue_on_finish', v_s.auto_requeue_on_finish,
        'auto_start', v_s.auto_start, 'start_delay_seconds', v_s.start_delay_seconds,
        'courts', (select count(*) from public.courts where session_id = p_session_id and removed_at is null),
        'wait_tracked', exists (select 1 from entries)),
      'totals', jsonb_build_object(
        'players', (select count(*) from players),
        'games', (select count(*) from games),
        'played', (select count(*) from players where games > 0),
        'no_games', (select count(*) from players where games = 0),
        'median_wait_s', (select round(percentile_cont(0.5) within group (order by secs)) from counted),
        'longest_wait_s', (select round(max(secs)) from counted),
        'peak_queue', (select n from peak_q),
        'peak_present', (select n from peak_p),
        'flagged', (select count(*) from players where cardinality(flags) > 0)),
      'court_use', jsonb_build_object(
        'busy_s', (select round(coalesce(sum(busy_s), 0)) from courts),
        'window_s', (select round(coalesce(sum(window_s), 0)) from courts),
        'idle_backed_s', (select round(coalesce(sum(idle_backed_s), 0)) from courts)),
      'courts', coalesce((select jsonb_agg(jsonb_build_object(
          'court_number', court_number, 'removed', removed_at is not null,
          'format', side_a_size || 'v' || side_b_size,
          'busy_s', round(busy_s), 'window_s', round(window_s), 'idle_backed_s', round(idle_backed_s))
          order by court_number) from courts), '[]'::jsonb),
      'players', coalesce((select jsonb_agg(jsonb_build_object(
          'player_id', player_id, 'name', name, 'games', games,
          'playing_s', round(playing), 'waiting_s', round(waiting), 'longest_wait_s', round(longest),
          'first_seen', first_seen, 'last_seen', last_seen, 'present_s', round(present), 'flags', to_jsonb(flags))
          order by games desc, name) from players), '[]'::jsonb),
      'games', coalesce((select jsonb_agg(jsonb_build_object(
          'id', id, 'court_number', court_number, 'started_at', started_at, 'ended_at', ended_at, 'players', names)
          order by started_at desc) from games), '[]'::jsonb)
    ));
end $$;

------------------------------------------------------------------ mixed (staff-or-self) functions

create or replace function public.start_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- Not _require_user(): the service role (staff) has no JWT `sub` to be "authenticated" as.
  v_uid        uuid := auth.uid();
  v_session_id uuid;
  v_round      public.rounds;
  v_n          integer;
begin
  if auth.role() <> 'service_role' and v_uid is null then raise exception 'not_authenticated'; end if;
  select session_id into v_session_id from public.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  perform public._lock_session(v_session_id);

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.status = 'ACTIVE' then return; end if;  -- lost the race: no-op
  if v_round.status <> 'FILLING' then raise exception 'round_not_found'; end if;

  if v_round.start_at is null or v_round.start_at > clock_timestamp() then
    if auth.role() <> 'service_role' and not exists (
      select 1 from public.round_players
       where round_id = p_round_id and player_id = v_uid and left_at is null
    ) then
      raise exception 'not_allowed';
    end if;
    select count(*) into v_n from public.round_players where round_id = p_round_id and left_at is null;
    if v_n < 2 then raise exception 'not_enough_players'; end if;
  end if;

  perform public._start_round(p_round_id);
  perform public._broadcast(v_session_id);
end $$;

create or replace function public.finish_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- Not _require_user(): the service role (staff) has no JWT `sub` to be "authenticated" as.
  v_uid        uuid := auth.uid();
  v_session_id uuid;
  v_session    public.open_play_sessions;
  v_round      public.rounds;
begin
  if auth.role() <> 'service_role' and v_uid is null then raise exception 'not_authenticated'; end if;
  select session_id into v_session_id from public.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  v_session := public._lock_session(v_session_id);

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.status = 'COMPLETED' then return; end if;  -- lost the race: no-op
  if v_round.status <> 'ACTIVE' then raise exception 'round_not_active'; end if;

  if auth.role() <> 'service_role'
     and not exists (select 1 from public.round_players where round_id = p_round_id and player_id = v_uid and left_at is null)
     and not (v_session.auto_finish and v_round.paused_at is null and v_round.ends_at <= clock_timestamp())
  then
    raise exception 'not_allowed';
  end if;

  perform public._finish_round(p_round_id);
  perform public._broadcast(v_session_id);
end $$;

create or replace function public.pause_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- Not _require_user(): the service role (staff) has no JWT `sub` to be "authenticated" as.
  v_uid        uuid := auth.uid();
  v_session_id uuid;
  v_round      public.rounds;
begin
  if auth.role() <> 'service_role' and v_uid is null then raise exception 'not_authenticated'; end if;
  select session_id into v_session_id from public.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  perform public._lock_session(v_session_id);

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.status <> 'ACTIVE' then raise exception 'round_not_active'; end if;
  if auth.role() <> 'service_role' and not exists (
    select 1 from public.round_players where round_id = p_round_id and player_id = v_uid and left_at is null
  ) then
    raise exception 'not_allowed';
  end if;

  update public.rounds set paused_at = coalesce(paused_at, clock_timestamp()) where id = p_round_id;
  perform public._broadcast(v_session_id);
end $$;

create or replace function public.resume_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- Not _require_user(): the service role (staff) has no JWT `sub` to be "authenticated" as.
  v_uid        uuid := auth.uid();
  v_session_id uuid;
  v_round      public.rounds;
begin
  if auth.role() <> 'service_role' and v_uid is null then raise exception 'not_authenticated'; end if;
  select session_id into v_session_id from public.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  perform public._lock_session(v_session_id);

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.status <> 'ACTIVE' then raise exception 'round_not_active'; end if;
  if auth.role() <> 'service_role' and not exists (
    select 1 from public.round_players where round_id = p_round_id and player_id = v_uid and left_at is null
  ) then
    raise exception 'not_allowed';
  end if;

  -- Give back the time the clock stood still.
  update public.rounds set ends_at = ends_at + (clock_timestamp() - paused_at), paused_at = null
   where id = p_round_id and paused_at is not null;
  perform public._broadcast(v_session_id);
end $$;

-- Recorded by a trigger so that no queue function can forget to. "REMOVED" vs. "LEFT" now turns on
-- the service role rather than a public.staff row.
create or replace function public._track_queue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev public.queue_entries;
  v_open uuid;
begin
  if tg_op = 'INSERT' then
    if new.state = 'QUEUED' then
      insert into public.queue_entries (session_id, player_id, queued_at)
      values (new.session_id, new.player_id, coalesce(new.queued_at, clock_timestamp()));
    end if;
    return null;
  end if;

  if old.state = 'QUEUED' and new.state <> 'QUEUED' then
    select id into v_open from public.queue_entries
     where session_id = new.session_id and player_id = new.player_id and ended_at is null
     order by queued_at desc limit 1;
    update public.queue_entries
       set ended_at = clock_timestamp(),
           outcome = case
             when new.state = 'PLAYING' then 'ASSIGNED'::public.queue_outcome
             when (select status from public.open_play_sessions where id = new.session_id) = 'ENDED' then 'SESSION_ENDED'
             when auth.role() = 'service_role' and auth.uid() is distinct from new.player_id then 'REMOVED'
             else 'LEFT' end,
           round_id = case when new.state = 'PLAYING' then new.current_round_id end
     where id = v_open;
  elsif new.state = 'QUEUED' and old.state <> 'QUEUED' then
    -- Bumped off a court whose game never started: the wait they already had carries on.
    select e.* into v_prev from public.queue_entries e
      join public.rounds r on r.id = e.round_id
     where e.session_id = new.session_id and e.player_id = new.player_id
       and e.outcome = 'ASSIGNED' and e.round_id = old.current_round_id and r.started_at is null
     order by e.queued_at desc limit 1;
    if found then
      update public.queue_entries set ended_at = null, outcome = null, round_id = null where id = v_prev.id;
    else
      insert into public.queue_entries (session_id, player_id, queued_at)
      values (new.session_id, new.player_id, coalesce(new.queued_at, clock_timestamp()));
    end if;
  end if;
  return null;
end $$;

------------------------------------------------------------------ read API

-- One authoritative snapshot of a session. `role` is gone: staff status now lives entirely in the
-- Next.js staff-code cookie (there's no Supabase identity left to check it against), so the app
-- threads it through separately instead of reading it out of the snapshot. Reads the clock, so
-- volatile, not stable (see 20260919000009_lint_fixes.sql).
create or replace function public.get_snapshot(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  -- Not _require_user(): staff view the board through the service role, which has no JWT `sub`.
  -- A null v_uid just means no profile/session-player match below, which is exactly "not a player".
  v_uid     uuid := auth.uid();
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
                  and (q.queued_at, q.player_id) < (sp.queued_at, sp.player_id)) end)
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

------------------------------------------------------------------ tighten grants

-- Only the service role calls these now (the app's admin client, gated by the staff-code cookie).
revoke execute on function
  public.remove_player(uuid, uuid),
  public.create_session(text, integer, integer, text, boolean),
  public.end_session(uuid),
  public.list_sessions(),
  public.update_session_settings(uuid, integer, boolean, boolean, integer, boolean),
  public.add_court(uuid, integer, integer),
  public.update_court(uuid, integer, integer),
  public.delete_court(uuid),
  public.delete_session(uuid),
  public.get_session_summary(uuid)
from anon, authenticated;

------------------------------------------------------------------ remove the old staff-account system

drop function public.list_staff();
drop function public._require_staff(boolean);
drop function public._staff_role();
drop table public.staff;
drop type public.staff_role;
