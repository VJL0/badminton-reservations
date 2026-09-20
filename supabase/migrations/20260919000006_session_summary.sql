-- Session summary: record every wait, then derive the report from raw timestamps.
-- Nothing calculated is stored: attendance, waits and court use are computed when a summary is opened.

------------------------------------------------------------------ raw history

-- A court's life within a session is needed to know how long it was available.
alter table public.courts add column created_at timestamptz not null default now();
update public.courts c set created_at = s.started_at
  from public.open_play_sessions s where s.id = c.session_id;

create type public.queue_outcome as enum ('ASSIGNED', 'LEFT', 'REMOVED', 'SESSION_ENDED');

-- One row per stretch of waiting in the queue. session_players only keeps the current wait; this keeps them all.
create table public.queue_entries (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.open_play_sessions (id) on delete cascade,
  player_id  uuid not null references public.profiles (id) on delete cascade,
  queued_at  timestamptz not null,
  ended_at   timestamptz,
  outcome    public.queue_outcome,
  round_id   uuid references public.rounds (id) on delete set null,
  check ((ended_at is null) = (outcome is null))
);
create index queue_entries_session on public.queue_entries (session_id, player_id);
create index queue_entries_round on public.queue_entries (round_id) where round_id is not null;

alter table public.queue_entries enable row level security;
revoke all on public.queue_entries from anon, authenticated;
create policy "no direct client access" on public.queue_entries
  for all to anon, authenticated using (false) with check (false);

-- Recorded by a trigger so that no queue function can forget to.
create function public._track_queue() returns trigger
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
             when public._staff_role() is not null and auth.uid() is distinct from new.player_id then 'REMOVED'
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

create trigger session_players_track_queue
  after insert or update of state on public.session_players
  for each row execute function public._track_queue();

revoke all on function public._track_queue() from public, anon, authenticated;

-- Whoever is waiting right now when this ships keeps their wait.
insert into public.queue_entries (session_id, player_id, queued_at)
select session_id, player_id, queued_at from public.session_players where state = 'QUEUED';

-- Mark the session ended first, so players still queued are recorded as "session ended", not "left".
create or replace function public.end_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_staff(true);
  perform public._lock_session(p_session_id);

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

------------------------------------------------------------------ the summary

-- Staff-only. Works for live sessions too (everything measured up to now).
-- Idle-while-waiting counts only time a court had no game while at least enough people to fill it were in the queue.
-- "Wait" = time in the queue until a court, plus any time stood on a court that hadn't started. People
-- who left the queue by choice or were removed aren't counted, since they didn't wait for a court.
create function public.get_session_summary(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s      public.open_play_sessions;
  v_end    timestamptz;
  v_long   integer;   -- a wait longer than this is flagged: one full game, at least 10 minutes
begin
  perform public._require_staff();
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

revoke all on function public.get_session_summary(uuid) from public, anon;
grant execute on function public.get_session_summary(uuid) to authenticated;

-- Replaced by the summary (which includes the game list).
drop function public.get_session_details(uuid);
