-- The state machine, in the private `app` schema. Nothing here is callable from outside: the api.* functions in
-- the next migration are the only way in. Every state-changing api function has the same shape:
--   lock the session -> check -> change rows -> app._allocate -> app._commit_session
-- so one logical change is one allocation, one revision bump and one broadcast, however many rows it touched.

------------------------------------------------------------------ identity and authorization

create function app._require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return v_uid;
end $$;

create function app._staff_role() returns app.staff_role
language sql stable security definer set search_path = '' as $$
  select role from app.staff where user_id = auth.uid();
$$;

create function app._require_staff(p_admin_only boolean default false) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_role app.staff_role := app._staff_role();
begin
  if v_role is null or (p_admin_only and v_role <> 'ADMIN') then
    raise exception 'not_staff';
  end if;
end $$;

-- The person a login is within one session (null if they have not joined it).
create function app._participant_id(p_session_id uuid, p_uid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from app.session_participants where session_id = p_session_id and auth_user_id = p_uid
$$;

-- Joining a session for the first time creates the participant, named as the login is named now.
create function app._ensure_participant(p_session_id uuid, p_uid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into app.session_participants (session_id, auth_user_id, display_name)
  select p_session_id, p_uid, pr.display_name from app.profiles pr where pr.id = p_uid
  on conflict (session_id, auth_user_id) do nothing
  returning id into v_id;
  return coalesce(v_id, app._participant_id(p_session_id, p_uid));
end $$;

-- Is this login one of the players still on the round?
create function app._on_round(p_round_id uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.round_players rp join app.session_participants sp on sp.id = rp.participant_id
     where rp.round_id = p_round_id and sp.auth_user_id = p_uid and rp.left_at is null)
$$;

------------------------------------------------------------------ locking, revisions, broadcasts

-- All mutations of a session queue up behind this row lock. Waiting longer than 100 ms means another
-- transaction held the session for a while, which is worth a line in the Postgres logs.
create function app._lock_session(p_session_id uuid) returns app.open_play_sessions
language plpgsql security definer set search_path = '' as $$
declare
  v_session app.open_play_sessions;
  v_t0      timestamptz := clock_timestamp();
begin
  select * into v_session from app.open_play_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if clock_timestamp() - v_t0 > interval '100 milliseconds' then
    raise log 'session_lock_wait session=% wait_ms=%', p_session_id,
      round(extract(epoch from clock_timestamp() - v_t0) * 1000);
  end if;
  return v_session;
end $$;

-- The end of every state change (the caller holds the session lock): bump the revision once, tell the room once
-- (the message carries no state, only the revision to compare), and queue whatever push notifications are due.
create function app._commit_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_revision bigint;
begin
  update app.open_play_sessions set revision = revision + 1 where id = p_session_id returning revision into v_revision;
  perform realtime.send(
    jsonb_build_object('session_id', p_session_id, 'revision', v_revision),
    'session_changed',
    'session:' || p_session_id::text,
    true
  );
  perform app._notify(p_session_id);
end $$;

-- "Whichever session is live has changed." Waiting phones on the home page ask the database what is true now.
create function app._announce_lobby() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send('{}'::jsonb, 'active_session_changed', 'open-play:lobby', true);
end $$;

------------------------------------------------------------------ rounds

create function app._start_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_duration integer;
begin
  select s.game_duration_seconds into v_duration
    from app.rounds r join app.open_play_sessions s on s.id = r.session_id
   where r.id = p_round_id;
  update app.rounds
     set status = 'ACTIVE', started_at = clock_timestamp(), start_at = null, paused_at = null,
         ends_at = clock_timestamp() + make_interval(secs => v_duration)
   where id = p_round_id and status = 'FILLING';
end $$;

-- Re-evaluate a FILLING round after its roster, its court, or the session settings changed:
-- a full court starts (now, or after the countdown) when auto-start is on; otherwise it waits.
create function app._sync_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_round   app.rounds;
  v_court   app.courts;
  v_session app.open_play_sessions;
  v_n       integer;
begin
  select * into v_round from app.rounds where id = p_round_id;
  if not found or v_round.status <> 'FILLING' then return; end if;
  select * into v_court from app.courts where id = v_round.court_id;
  select * into v_session from app.open_play_sessions where id = v_round.session_id;
  select count(*) into v_n from app.round_players where round_id = p_round_id and left_at is null;

  if v_n >= v_court.capacity and v_session.auto_start then
    if v_session.start_delay_seconds = 0 then
      perform app._start_round(p_round_id);
    else
      update app.rounds
         set start_at = coalesce(start_at, clock_timestamp() + make_interval(secs => v_session.start_delay_seconds))
       where id = p_round_id;
    end if;
  else
    update app.rounds set start_at = null where id = p_round_id and start_at is not null;
  end if;
end $$;

-- Take a player out of a FILLING round. Cancels the round if it empties.
-- p_requeue keeps the player's original queued_at, so they keep their place.
create function app._release_from_filling(p_round_id uuid, p_participant_id uuid, p_requeue boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update app.round_players set left_at = clock_timestamp()
   where round_id = p_round_id and participant_id = p_participant_id and left_at is null;

  update app.session_players
     set state = case when p_requeue then 'QUEUED'::app.player_state else 'IDLE'::app.player_state end,
         queued_at = case when p_requeue then coalesce(queued_at, clock_timestamp()) else null end,
         current_round_id = null,
         preferred_court_id = null,
         updated_at = clock_timestamp()
   where participant_id = p_participant_id;

  if not exists (select 1 from app.round_players where round_id = p_round_id and left_at is null) then
    update app.rounds set status = 'CANCELLED', ended_at = clock_timestamp(), start_at = null
     where id = p_round_id;
  else
    perform app._sync_round(p_round_id);
  end if;
end $$;

-- Remove one person from wherever they are. A running game keeps going without them and is
-- closed only if they were the last one on court.
create function app._leave(p_participant_id uuid, p_allow_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_sp    app.session_players;
  v_round app.rounds;
begin
  select * into v_sp from app.session_players where participant_id = p_participant_id;
  if not found or v_sp.state = 'IDLE' then return; end if;

  if v_sp.state = 'QUEUED' then
    update app.session_players
       set state = 'IDLE', queued_at = null, preferred_court_id = null, updated_at = clock_timestamp()
     where participant_id = p_participant_id;
  else
    select * into v_round from app.rounds where id = v_sp.current_round_id;
    if v_round.status = 'FILLING' then
      perform app._release_from_filling(v_round.id, p_participant_id, false);
    elsif not p_allow_active then
      raise exception 'game_in_progress';
    else
      update app.round_players set left_at = clock_timestamp()
       where round_id = v_round.id and participant_id = p_participant_id and left_at is null;
      update app.session_players
         set state = 'IDLE', queued_at = null, current_round_id = null, preferred_court_id = null,
             updated_at = clock_timestamp()
       where participant_id = p_participant_id;
      if not exists (select 1 from app.round_players where round_id = v_round.id and left_at is null) then
        update app.rounds set status = 'COMPLETED', ended_at = clock_timestamp(), paused_at = null
         where id = v_round.id;
      end if;
    end if;
  end if;
end $$;

-- The bookkeeping of ending a game. It neither refills the court nor broadcasts: the caller does that once,
-- after however many games it ended.
create function app._finish_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_round   app.rounds;
  v_session app.open_play_sessions;
  v_requeue uuid;
begin
  select * into v_round from app.rounds where id = p_round_id;
  if not found or v_round.status <> 'ACTIVE' then return; end if;
  select * into v_session from app.open_play_sessions where id = v_round.session_id;

  if v_session.auto_requeue_on_finish then v_requeue := v_round.court_id; end if;

  update app.rounds set status = 'COMPLETED', ended_at = clock_timestamp(), paused_at = null
   where id = p_round_id;
  update app.round_players set left_at = clock_timestamp()
   where round_id = p_round_id and left_at is null;
  update app.session_players
     set state = case when v_session.auto_requeue_on_finish
                      then 'QUEUED'::app.player_state else 'IDLE'::app.player_state end,
         queued_at = case when v_session.auto_requeue_on_finish then clock_timestamp() end,
         preferred_court_id = v_requeue,
         current_round_id = null,
         updated_at = clock_timestamp()
   where current_round_id = p_round_id;
end $$;

-- Ends every running game in the session that is past its time, when the session ends games automatically.
-- The caller holds the lock and then allocates and commits once for all of them, so three courts running out
-- together cost one refill and one broadcast instead of three.
create function app._finish_overdue_in_session(p_session_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  if not exists (select 1 from app.open_play_sessions where id = p_session_id and status = 'ACTIVE' and auto_finish) then
    return 0;
  end if;
  for r in
    select id from app.rounds
     where session_id = p_session_id and status = 'ACTIVE' and paused_at is null and ends_at <= clock_timestamp()
     order by ends_at
  loop
    perform app._finish_round(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Server-side timer (pg_cron, every 30 s): the safety net for rooms where no phone reports a game that is over.
create function app._finish_overdue_rounds() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
  v_n integer;
begin
  for r in
    select distinct rd.session_id
      from app.rounds rd join app.open_play_sessions s on s.id = rd.session_id
     where rd.status = 'ACTIVE' and rd.paused_at is null and rd.ends_at <= clock_timestamp()
       and s.status = 'ACTIVE' and s.auto_finish
     order by rd.session_id
  loop
    perform app._lock_session(r.session_id);
    v_n := app._finish_overdue_in_session(r.session_id);  -- looks again, now that the session is locked
    if v_n > 0 then
      perform app._allocate(r.session_id);
      perform app._commit_session(r.session_id);
      n := n + v_n;
    end if;
  end loop;
  return n;
end $$;

------------------------------------------------------------------ allocator

-- Walk the queue oldest first. A player who picked a court only takes that court; everyone else takes
-- the best court: partially filled first, then the fullest, then the lowest number. Someone whose court
-- isn't free is skipped, not blocking those behind them.
create function app._allocate(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_q        record;
  v_court_id uuid;
  v_round_id uuid;
  v_slot     integer;
begin
  for v_q in
    select sp.participant_id, sp.preferred_court_id
      from app.session_players sp
     where sp.session_id = p_session_id and sp.state = 'QUEUED'
     order by sp.queued_at, sp.participant_id
  loop
    v_court_id := null; v_round_id := null;

    select c.id, r.id
      into v_court_id, v_round_id
      from app.courts c
      left join app.rounds r
        on r.court_id = c.id and r.status in ('FILLING', 'ACTIVE')
      left join lateral (
        select count(*) as n from app.round_players x
         where x.round_id = r.id and x.left_at is null
      ) rp on true
     where c.session_id = p_session_id
       and c.removed_at is null
       and (r.id is null or r.status = 'FILLING')
       and coalesce(rp.n, 0) < c.capacity
       and (v_q.preferred_court_id is null or c.id = v_q.preferred_court_id)
     order by coalesce(rp.n, 0) desc, c.court_number
     limit 1;
    continue when v_court_id is null;

    if v_round_id is null then
      insert into app.rounds (session_id, court_id) values (p_session_id, v_court_id)
      returning id into v_round_id;
    end if;

    select min(s) into v_slot
      from generate_series(1, (select capacity from app.courts where id = v_court_id)) s
     where not exists (
       select 1 from app.round_players
        where round_id = v_round_id and slot = s and left_at is null);

    insert into app.round_players (round_id, participant_id, slot)
    values (v_round_id, v_q.participant_id, v_slot);

    update app.session_players
       set state = 'PLAYING', current_round_id = v_round_id, preferred_court_id = null,
           updated_at = clock_timestamp()
     where participant_id = v_q.participant_id;

    perform app._sync_round(v_round_id);
  end loop;
end $$;

------------------------------------------------------------------ ending a session

-- Ending a session, without the officer check, so end_session and the migrations share one implementation.
create function app._end_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app._lock_session(p_session_id);

  -- Mark the session ended first, so players still queued are recorded as "session ended", not "left".
  update app.open_play_sessions set status = 'ENDED', ended_at = clock_timestamp()
   where id = p_session_id;
  update app.rounds
     set status = case when status = 'ACTIVE' then 'COMPLETED'::app.round_status
                       else 'CANCELLED'::app.round_status end,
         ended_at = clock_timestamp()
   where session_id = p_session_id and status in ('FILLING', 'ACTIVE');
  update app.round_players set left_at = clock_timestamp()
   where left_at is null and round_id in (select id from app.rounds where session_id = p_session_id);
  update app.session_players
     set state = 'IDLE', queued_at = null, current_round_id = null, updated_at = clock_timestamp()
   where session_id = p_session_id and state <> 'IDLE';

  perform app._commit_session(p_session_id);
  perform app._announce_lobby();
end $$;

------------------------------------------------------------------ queue history

-- Recorded by a trigger so that no queue function can forget to.
create function app._track_queue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev app.queue_entries;
  v_open uuid;
  v_auth uuid;
begin
  if tg_op = 'INSERT' then
    if new.state = 'QUEUED' then
      insert into app.queue_entries (session_id, participant_id, queued_at)
      values (new.session_id, new.participant_id, coalesce(new.queued_at, clock_timestamp()));
    end if;
    return null;
  end if;

  if old.state = 'QUEUED' and new.state <> 'QUEUED' then
    select id into v_open from app.queue_entries
     where session_id = new.session_id and participant_id = new.participant_id and ended_at is null
     order by queued_at desc limit 1;
    select auth_user_id into v_auth from app.session_participants where id = new.participant_id;
    update app.queue_entries
       set ended_at = clock_timestamp(),
           outcome = case
             when new.state = 'PLAYING' then 'ASSIGNED'::app.queue_outcome
             when (select status from app.open_play_sessions where id = new.session_id) = 'ENDED' then 'SESSION_ENDED'
             when app._staff_role() is not null and auth.uid() is distinct from v_auth then 'REMOVED'
             else 'LEFT' end,
           round_id = case when new.state = 'PLAYING' then new.current_round_id end
     where id = v_open;
  elsif new.state = 'QUEUED' and old.state <> 'QUEUED' then
    -- Bumped off a court whose game never started: the wait they already had carries on.
    select e.* into v_prev from app.queue_entries e
      join app.rounds r on r.id = e.round_id
     where e.session_id = new.session_id and e.participant_id = new.participant_id
       and e.outcome = 'ASSIGNED' and e.round_id = old.current_round_id and r.started_at is null
     order by e.queued_at desc limit 1;
    if found then
      update app.queue_entries set ended_at = null, outcome = null, round_id = null where id = v_prev.id;
    else
      insert into app.queue_entries (session_id, participant_id, queued_at)
      values (new.session_id, new.participant_id, coalesce(new.queued_at, clock_timestamp()));
    end if;
  end if;
  return null;
end $$;

drop trigger session_players_track_queue on app.session_players;
create trigger session_players_track_queue
  after insert or update of state on app.session_players
  for each row execute function app._track_queue();
