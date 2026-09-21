-- Officer and admin RPCs. Each re-checks the caller's role inside the database, whatever the app already checked.

------------------------------------------------------------------ officers

-- Remove a queued player or a player standing in a not-yet-started round. p_participant_id is the id the board shows.
create function api.remove_player(p_session_id uuid, p_participant_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app._require_staff();
  perform app._lock_session(p_session_id);
  if not exists (select 1 from app.session_participants where id = p_participant_id and session_id = p_session_id) then
    return;
  end if;
  perform app._leave(p_participant_id, false);
  perform app._allocate(p_session_id);
  perform app._commit_session(p_session_id);
end $$;

create function api.list_sessions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app._require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'name', s.name, 'status', s.status,
      'created_at', s.created_at, 'ended_at', s.ended_at,
      'courts', (select count(*) from app.courts c where c.session_id = s.id and c.removed_at is null),
      'players', (select count(*) from app.session_players p where p.session_id = s.id)
    ) order by s.created_at desc)
    from app.open_play_sessions s), '[]'::jsonb);
end $$;

------------------------------------------------------------------ admins: sessions

create function api.create_session(
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
  perform app._require_staff(true);
  if p_court_count not between 1 and 30 then raise exception 'invalid_court_count'; end if;
  if v_code = '' then
    -- unambiguous alphabet (no 0/O/1/I)
    loop
      v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                                          1 + floor(random() * 32)::int, 1), '')
                   from generate_series(1, 6));
      exit when not exists (select 1 from app.open_play_sessions where code = v_code);
    end loop;
  end if;

  begin
    insert into app.open_play_sessions (code, name, game_duration_seconds, auto_requeue_on_finish)
    values (v_code, btrim(p_name), p_game_duration_seconds, p_auto_requeue)
    returning id into v_id;
  exception when unique_violation then
    -- A second live session trips the one-live-session index; report it as a known error.
    if exists (select 1 from app.open_play_sessions where status = 'ACTIVE') then
      raise exception 'already_active';
    end if;
    raise; -- a code clash, not a second live session
  end;

  insert into app.courts (session_id, court_number)
  select v_id, n from generate_series(1, p_court_count) n;

  perform app._announce_lobby();  -- phones waiting on the home page open the queue
  return v_id;
end $$;

create function api.end_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app._require_staff(true);
  perform app._end_session(p_session_id);
end $$;

-- Rounds, players, courts and queue history go with it (on delete cascade). A live session has to be ended first,
-- so nobody is on the board when it disappears.
create function api.delete_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_session app.open_play_sessions;
begin
  perform app._require_staff(true);
  v_session := app._lock_session(p_session_id);
  if v_session.status <> 'ENDED' then raise exception 'session_active'; end if;
  delete from app.open_play_sessions where id = p_session_id;
end $$;

create function api.update_session_settings(
  p_session_id uuid,
  p_game_duration_seconds integer,
  p_auto_requeue boolean,
  p_auto_start boolean,
  p_start_delay_seconds integer,
  p_auto_finish boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session app.open_play_sessions;
  v_round   uuid;
begin
  perform app._require_staff(true);
  v_session := app._lock_session(p_session_id);
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if p_game_duration_seconds not between 60 and 10800 then raise exception 'invalid_duration'; end if;
  if p_start_delay_seconds not between 0 and 300 then raise exception 'invalid_delay'; end if;

  -- Games already running keep the length they started with.
  update app.open_play_sessions
     set game_duration_seconds = p_game_duration_seconds,
         auto_requeue_on_finish = p_auto_requeue,
         auto_start = p_auto_start,
         start_delay_seconds = p_start_delay_seconds,
         auto_finish = p_auto_finish
   where id = p_session_id;

  -- Full courts re-evaluate under the new rules: restart their countdown, start now, or wait for a manual start.
  update app.rounds set start_at = null where session_id = p_session_id and status = 'FILLING';
  for v_round in select id from app.rounds where session_id = p_session_id and status = 'FILLING' loop
    perform app._sync_round(v_round);
  end loop;
  -- Turning automatic ending on also ends games that are already past their time.
  perform app._finish_overdue_in_session(p_session_id);
  perform app._allocate(p_session_id);

  perform app._commit_session(p_session_id);
end $$;

------------------------------------------------------------------ admins: courts

create function api.add_court(p_session_id uuid, p_side_a integer default 2, p_side_b integer default 2)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_session app.open_play_sessions;
begin
  perform app._require_staff(true);
  v_session := app._lock_session(p_session_id);
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if p_side_a not between 1 and 4 or p_side_b not between 1 and 4 then raise exception 'invalid_court_format'; end if;
  if (select count(*) from app.courts where session_id = p_session_id and removed_at is null) >= 30 then
    raise exception 'too_many_courts';
  end if;

  insert into app.courts (session_id, court_number, side_a_size, side_b_size)
  select p_session_id, coalesce(max(court_number), 0) + 1, p_side_a, p_side_b
    from app.courts where session_id = p_session_id;

  perform app._allocate(p_session_id);  -- a new court can seat people who were waiting
  perform app._commit_session(p_session_id);
end $$;

-- Change a court's format. Not while a game is running on it. Players waiting on the court who no
-- longer fit go back to the queue with their place.
create function api.update_court(p_court_id uuid, p_side_a integer, p_side_b integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_court      app.courts;
  v_session    app.open_play_sessions;
  v_round      app.rounds;
  v_capacity   integer := p_side_a + p_side_b;
begin
  perform app._require_staff(true);
  select * into v_court from app.courts where id = p_court_id and removed_at is null;
  if not found then raise exception 'court_not_found'; end if;
  v_session := app._lock_session(v_court.session_id);
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if p_side_a not between 1 and 4 or p_side_b not between 1 and 4 then raise exception 'invalid_court_format'; end if;

  select * into v_round from app.rounds where court_id = p_court_id and status in ('FILLING', 'ACTIVE');
  if found and v_round.status = 'ACTIVE' then raise exception 'game_in_progress'; end if;

  update app.courts set side_a_size = p_side_a, side_b_size = p_side_b where id = p_court_id;

  if v_round.id is not null then
    -- Release everyone past the new capacity in one go: releasing one at a time could start the
    -- game (court now "full") before the rest are out.
    with gone as (
      update app.round_players set left_at = clock_timestamp()
       where round_id = v_round.id and left_at is null and slot > v_capacity
      returning participant_id)
    update app.session_players sp
       set state = 'QUEUED', queued_at = coalesce(sp.queued_at, clock_timestamp()),
           current_round_id = null, preferred_court_id = null, updated_at = clock_timestamp()
      from gone
     where sp.participant_id = gone.participant_id;

    if exists (select 1 from app.round_players where round_id = v_round.id and left_at is null) then
      perform app._sync_round(v_round.id);
    else
      update app.rounds set status = 'CANCELLED', ended_at = clock_timestamp(), start_at = null
       where id = v_round.id;
    end if;
  end if;

  perform app._allocate(v_court.session_id);
  perform app._commit_session(v_court.session_id);
end $$;

-- Delete a court. Not while a game is running on it, and never the last one. Anyone waiting on it
-- goes back to the queue with their place. The court is kept (soft delete) so past games still show it.
create function api.delete_court(p_court_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_court   app.courts;
  v_session app.open_play_sessions;
  v_round   app.rounds;
begin
  perform app._require_staff(true);
  select * into v_court from app.courts where id = p_court_id and removed_at is null;
  if not found then raise exception 'court_not_found'; end if;
  v_session := app._lock_session(v_court.session_id);
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if (select count(*) from app.courts where session_id = v_court.session_id and removed_at is null) <= 1 then
    raise exception 'last_court';
  end if;

  select * into v_round from app.rounds where court_id = p_court_id and status in ('FILLING', 'ACTIVE');
  if found and v_round.status = 'ACTIVE' then raise exception 'game_in_progress'; end if;
  if found then
    with gone as (
      update app.round_players set left_at = clock_timestamp()
       where round_id = v_round.id and left_at is null
      returning participant_id)
    update app.session_players sp
       set state = 'QUEUED', queued_at = coalesce(sp.queued_at, clock_timestamp()),
           current_round_id = null, preferred_court_id = null, updated_at = clock_timestamp()
      from gone
     where sp.participant_id = gone.participant_id;
    update app.rounds set status = 'CANCELLED', ended_at = clock_timestamp(), start_at = null
     where id = v_round.id;
  end if;

  update app.courts set removed_at = clock_timestamp() where id = p_court_id;
  update app.session_players set preferred_court_id = null where preferred_court_id = p_court_id;

  perform app._allocate(v_court.session_id);
  perform app._commit_session(v_court.session_id);
end $$;

------------------------------------------------------------------ the summary

-- Staff-only. Works for live sessions too (everything measured up to now).
-- Idle-while-waiting counts only time a court had no game while at least enough people to fill it were in the queue.
-- "Wait" = time in the queue until a court, plus any time stood on a court that hadn't started. People
-- who left the queue by choice or were removed aren't counted, since they didn't wait for a court.
create function api.get_session_summary(p_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s      app.open_play_sessions;
  v_end    timestamptz;
  v_long   integer;   -- a wait longer than this is flagged: one full game, at least 10 minutes
begin
  perform app._require_staff();
  select * into v_s from app.open_play_sessions where id = p_session_id;
  if not found then return null; end if;
  v_end := coalesce(v_s.ended_at, clock_timestamp());
  v_long := greatest(600, v_s.game_duration_seconds);

  return (
    with
    entries as (
      select e.*, extract(epoch from coalesce(e.ended_at, v_end) - e.queued_at)::numeric as secs
        from app.queue_entries e where e.session_id = p_session_id),
    counted as (select * from entries where outcome is null or outcome in ('ASSIGNED', 'SESSION_ENDED')),
    seats as (
      select rp.participant_id, r.id as round_id, r.court_id, r.started_at, rp.joined_at,
             coalesce(rp.left_at, r.ended_at, v_end) as out_at
        from app.round_players rp join app.rounds r on r.id = rp.round_id
       where r.session_id = p_session_id),
    seat_calc as (
      select participant_id, round_id, started_at,
             case when started_at is not null and out_at > greatest(joined_at, started_at)
                  then extract(epoch from out_at - greatest(joined_at, started_at)) else 0 end as playing,
             greatest(0, extract(epoch from least(coalesce(started_at, out_at), out_at) - joined_at)) as court_wait,
             out_at
        from seats),
    per_player as (
      select sp.participant_id, pr.display_name as name,
             coalesce((select count(distinct sc.round_id) from seat_calc sc
                        where sc.participant_id = sp.participant_id and sc.started_at is not null), 0) as games,
             coalesce((select sum(sc.playing) from seat_calc sc where sc.participant_id = sp.participant_id), 0) as playing,
             coalesce((select sum(c.secs) from counted c where c.participant_id = sp.participant_id), 0)
               + coalesce((select sum(sc.court_wait) from seat_calc sc where sc.participant_id = sp.participant_id), 0) as waiting,
             (select max(c.secs) from counted c where c.participant_id = sp.participant_id) as longest,
             least(pr.joined_at,
                   coalesce((select min(e.queued_at) from entries e where e.participant_id = sp.participant_id), pr.joined_at),
                   coalesce((select min(s.joined_at) from seats s where s.participant_id = sp.participant_id), pr.joined_at)) as first_seen,
             least(v_end, greatest(sp.updated_at,
                   coalesce((select max(coalesce(e.ended_at, v_end)) from entries e where e.participant_id = sp.participant_id), pr.joined_at),
                   coalesce((select max(sc.out_at) from seat_calc sc where sc.participant_id = sp.participant_id), pr.joined_at))) as last_seen
        from app.session_players sp join app.session_participants pr on pr.id = sp.participant_id
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
        from app.courts c where c.session_id = p_session_id),
    courts as (
      select cc.*,
             greatest(0, extract(epoch from cc.we - cc.ws)) as window_s,
             coalesce((select sum(extract(epoch from least(coalesce(r.ended_at, v_end), cc.we) - greatest(r.started_at, cc.ws)))
                         from app.rounds r
                        where r.court_id = cc.id and r.started_at is not null
                          and least(coalesce(r.ended_at, v_end), cc.we) > greatest(r.started_at, cc.ws)), 0) as busy_s,
             (select coalesce(sum(extract(epoch from upper(x) - lower(x))), 0)
                from unnest(
                  (tstzmultirange(tstzrange(cc.ws, cc.we))
                    - coalesce((select range_agg(tstzrange(greatest(r.started_at, cc.ws), least(coalesce(r.ended_at, v_end), cc.we)))
                                  from app.rounds r
                                 where r.court_id = cc.id and r.started_at is not null
                                   and least(coalesce(r.ended_at, v_end), cc.we) > greatest(r.started_at, cc.ws)),
                               '{}'::tstzmultirange))
                  * coalesce((select range_agg(tstzrange(qs.t, qs.t2)) from q_steps qs
                               where qs.t2 > qs.t and qs.n >= cc.capacity), '{}'::tstzmultirange)) as x) as idle_backed_s
        from court_calc cc where cc.we > cc.ws),
    games as (
      select r.id, c.court_number, r.started_at, r.ended_at,
             coalesce((select jsonb_agg(pr.display_name order by rp.slot)
                         from app.round_players rp join app.session_participants pr on pr.id = rp.participant_id
                        where rp.round_id = r.id), '[]'::jsonb) as names
        from app.rounds r join app.courts c on c.id = r.court_id
       where r.session_id = p_session_id and r.started_at is not null)
    select jsonb_build_object(
      'session', jsonb_build_object(
        'id', v_s.id, 'code', v_s.code, 'name', v_s.name, 'status', v_s.status,
        'started_at', v_s.started_at, 'ended_at', v_s.ended_at, 'now', clock_timestamp(),
        'game_duration_seconds', v_s.game_duration_seconds,
        'auto_requeue_on_finish', v_s.auto_requeue_on_finish,
        'auto_start', v_s.auto_start, 'start_delay_seconds', v_s.start_delay_seconds,
        'courts', (select count(*) from app.courts where session_id = p_session_id and removed_at is null),
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
          'participant_id', participant_id, 'name', name, 'games', games,
          'playing_s', round(playing), 'waiting_s', round(waiting), 'longest_wait_s', round(longest),
          'first_seen', first_seen, 'last_seen', last_seen, 'present_s', round(present), 'flags', to_jsonb(flags))
          order by games desc, name) from players), '[]'::jsonb),
      'games', coalesce((select jsonb_agg(jsonb_build_object(
          'id', id, 'court_number', court_number, 'started_at', started_at, 'ended_at', ended_at, 'players', names)
          order by started_at desc) from games), '[]'::jsonb)
    ));
end $$;

------------------------------------------------------------------ grants

grant execute on function
  api.remove_player(uuid, uuid),
  api.list_sessions(),
  api.get_session_summary(uuid)
to authenticated;
-- Admin-only: the role is checked inside as well.
grant execute on function
  api.create_session(text, integer, integer, text, boolean),
  api.end_session(uuid),
  api.delete_session(uuid),
  api.update_session_settings(uuid, integer, boolean, boolean, integer, boolean),
  api.add_court(uuid, integer, integer),
  api.update_court(uuid, integer, integer),
  api.delete_court(uuid)
to authenticated;
