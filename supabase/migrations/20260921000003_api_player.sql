-- The player-facing RPC surface (`api` is the only schema the Data API exposes). Grants are at the end: every
-- function starts closed (see the default privileges in 20260921000001) and is opened here on purpose.

------------------------------------------------------------------ who am I

-- 'ADMIN', 'OPERATOR' or null. Lets the app ask the question it means instead of probing an admin-only function.
create function api.current_staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select role::text from app.staff where user_id = auth.uid()
$$;

-- Lets the permanent QR poster (which points at "/") find tonight's session. Only one session is live at a time.
create function api.get_active_session_code() returns text
language sql stable security definer set search_path = '' as $$
  select code from app.open_play_sessions where status = 'ACTIVE'
$$;

create function api.set_display_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := app._require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_live uuid;
begin
  if char_length(v_name) not between 1 and 40 then raise exception 'invalid_name'; end if;
  insert into app.profiles (id, display_name) values (v_uid, v_name)
  on conflict (id) do update set display_name = excluded.display_name;

  -- A name changed after joining shows on the live board too.
  select id into v_live from app.open_play_sessions where status = 'ACTIVE';
  if v_live is not null then
    perform app._lock_session(v_live);
    update app.session_participants set display_name = v_name
     where session_id = v_live and auth_user_id = v_uid and display_name <> v_name;
    if found then perform app._commit_session(v_live); end if;
  end if;
end $$;

------------------------------------------------------------------ read

-- One authoritative snapshot of a session, looked up by its QR code. A single statement, so the revision and
-- everything else in it come from the same database snapshot even while other transactions commit.
create function api.get_snapshot(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := app._require_user();
  v_result jsonb;
begin
  select jsonb_build_object(
    'revision', s.revision,
    'server_now', clock_timestamp(),
    'session', jsonb_build_object(
      'id', s.id, 'code', s.code, 'name', s.name, 'status', s.status,
      'game_duration_seconds', s.game_duration_seconds,
      'auto_requeue_on_finish', s.auto_requeue_on_finish,
      'auto_start', s.auto_start,
      'auto_finish', s.auto_finish,
      'start_delay_seconds', s.start_delay_seconds),
    'me', (
      select jsonb_build_object(
               'id', v_uid,
               'participant_id', mp.id,
               'display_name', pr.display_name,
               'state', coalesce(sp.state::text, 'IDLE'),
               'round_id', sp.current_round_id,
               'preferred_court_id', sp.preferred_court_id,
               'queue_position', case when sp.state = 'QUEUED' then
                  (select count(*) + 1 from app.session_players q
                    where q.session_id = s.id and q.state = 'QUEUED'
                      and (q.queued_at, q.participant_id) < (sp.queued_at, sp.participant_id)) end,
               'role', app._staff_role())
        from (select 1) one
        left join app.profiles pr on pr.id = v_uid
        left join app.session_participants mp on mp.session_id = s.id and mp.auth_user_id = v_uid
        left join app.session_players sp on sp.participant_id = mp.id),
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
                       'participant_id', rp.participant_id, 'name', p.display_name, 'slot', rp.slot)
                     order by rp.slot)
                from app.round_players rp
                join app.session_participants p on p.id = rp.participant_id
               where rp.round_id = r.id and rp.left_at is null), '[]'::jsonb))
          from app.rounds r
         where r.court_id = c.id and r.status in ('FILLING', 'ACTIVE'))
      ) order by c.court_number)
      from app.courts c where c.session_id = s.id and c.removed_at is null), '[]'::jsonb),
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object(
               'participant_id', q.participant_id, 'name', p.display_name, 'position', q.pos,
               'court_number', c.court_number)
             order by q.pos)
        from (select sp.participant_id, sp.preferred_court_id,
                     row_number() over (order by sp.queued_at, sp.participant_id) as pos
                from app.session_players sp
               where sp.session_id = s.id and sp.state = 'QUEUED') q
        join app.session_participants p on p.id = q.participant_id
        left join app.courts c on c.id = q.preferred_court_id), '[]'::jsonb)
  )
    into v_result
    from app.open_play_sessions s
   where s.code = upper(btrim(p_code));

  return v_result;  -- null when there is no such session
end $$;

------------------------------------------------------------------ player commands

-- Queue for the session, or for one specific court. Already queued? This just switches courts, keeping the place.
create function api.join_queue(p_session_id uuid, p_court_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := app._require_user();
  v_session app.open_play_sessions := app._lock_session(p_session_id);
  v_pid     uuid;
  v_sp      app.session_players;
begin
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if not exists (select 1 from app.profiles where id = v_uid) then
    raise exception 'profile_required';
  end if;
  if p_court_id is not null then
    if not exists (select 1 from app.courts where id = p_court_id and session_id = p_session_id and removed_at is null) then
      raise exception 'court_not_found';
    end if;
  end if;

  v_pid := app._participant_id(p_session_id, v_uid);
  select * into v_sp from app.session_players where participant_id = v_pid;
  if found and v_sp.state = 'PLAYING' then return; end if;
  if found and v_sp.state = 'QUEUED' then
    if v_sp.preferred_court_id is distinct from p_court_id then
      update app.session_players set preferred_court_id = p_court_id, updated_at = clock_timestamp()
       where participant_id = v_pid;
      perform app._allocate(p_session_id);
      perform app._commit_session(p_session_id);
    end if;
    return;
  end if;

  -- Throttle leave/join churn: every state change fans out a broadcast to the whole room.
  if found and v_sp.updated_at > clock_timestamp() - interval '2 seconds' then
    raise exception 'too_fast';
  end if;

  if (select count(*) from app.session_players
       where session_id = p_session_id and state = 'QUEUED') >= v_session.max_queue_size then
    -- Only refuse if they'd actually add to the queue; a free court would place them immediately.
    if not exists (
      select 1 from app.courts c
       where c.session_id = p_session_id and c.removed_at is null
         and (p_court_id is null or c.id = p_court_id)
         and not exists (select 1 from app.rounds r where r.court_id = c.id and r.status = 'ACTIVE')
         and (select count(*) from app.round_players rp
                join app.rounds r on r.id = rp.round_id
               where r.court_id = c.id and r.status = 'FILLING' and rp.left_at is null) < c.capacity
    ) then
      raise exception 'queue_full';
    end if;
  end if;

  v_pid := app._ensure_participant(p_session_id, v_uid);
  insert into app.session_players (participant_id, session_id, state, queued_at, preferred_court_id)
  values (v_pid, p_session_id, 'QUEUED', clock_timestamp(), p_court_id)
  on conflict (participant_id) do update
     set state = 'QUEUED', queued_at = clock_timestamp(), preferred_court_id = p_court_id,
         updated_at = clock_timestamp();

  perform app._allocate(p_session_id);
  perform app._commit_session(p_session_id);
end $$;

-- Leave the queue, a court that is still filling, or a game in progress (which carries on without you).
create function api.leave_queue(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app._require_user();
  v_pid uuid;
begin
  perform app._lock_session(p_session_id);
  v_pid := app._participant_id(p_session_id, v_uid);
  if v_pid is null or not exists (select 1 from app.session_players where participant_id = v_pid and state <> 'IDLE') then
    return;
  end if;
  perform app._leave(v_pid, true);
  perform app._allocate(p_session_id);
  perform app._commit_session(p_session_id);
end $$;

-- Start a game that is waiting on its court: on schedule (auto-start countdown reached; any client
-- may report that) or early by someone standing on it or an officer. Idempotent.
create function api.start_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := app._require_user();
  v_session_id uuid;
  v_round      app.rounds;
  v_n          integer;
begin
  select session_id into v_session_id from app.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  perform app._lock_session(v_session_id);

  select * into v_round from app.rounds where id = p_round_id;
  if v_round.status = 'ACTIVE' then return; end if;  -- lost the race: no-op
  if v_round.status <> 'FILLING' then raise exception 'round_not_found'; end if;

  if v_round.start_at is null or v_round.start_at > clock_timestamp() then
    if app._staff_role() is null and not app._on_round(p_round_id, v_uid) then
      raise exception 'not_allowed';
    end if;
    select count(*) into v_n from app.round_players where round_id = p_round_id and left_at is null;
    if v_n < 2 then raise exception 'not_enough_players'; end if;
  end if;

  perform app._start_round(p_round_id);
  perform app._commit_session(v_session_id);
end $$;

-- End a game (early, or at time-up). Allowed for staff and for the players still in it. When the session ends games
-- automatically, anyone may report a game that is past its time (like start_round for a countdown); the clock is
-- checked here, so an early or repeated report does nothing. Idempotent. Any other game that has run out is ended in
-- the same breath, so courts expiring together are refilled and broadcast once.
create function api.finish_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := app._require_user();
  v_session_id uuid;
  v_session    app.open_play_sessions;
  v_round      app.rounds;
begin
  select session_id into v_session_id from app.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  v_session := app._lock_session(v_session_id);

  select * into v_round from app.rounds where id = p_round_id;
  if v_round.status = 'COMPLETED' then return; end if;  -- lost the race: no-op
  if v_round.status <> 'ACTIVE' then raise exception 'round_not_active'; end if;

  if app._staff_role() is null
     and not app._on_round(p_round_id, v_uid)
     and not (v_session.auto_finish and v_round.paused_at is null and v_round.ends_at <= clock_timestamp())
  then
    raise exception 'not_allowed';
  end if;

  perform app._finish_round(p_round_id);
  perform app._finish_overdue_in_session(v_session_id);
  perform app._allocate(v_session_id);
  perform app._commit_session(v_session_id);
end $$;

-- Stop or restart the clock of a running game. Same people who may end a game: officers and its players.
create function api.pause_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := app._require_user();
  v_session_id uuid;
  v_round      app.rounds;
begin
  select session_id into v_session_id from app.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  perform app._lock_session(v_session_id);

  select * into v_round from app.rounds where id = p_round_id;
  if v_round.status <> 'ACTIVE' then raise exception 'round_not_active'; end if;
  if app._staff_role() is null and not app._on_round(p_round_id, v_uid) then
    raise exception 'not_allowed';
  end if;

  update app.rounds set paused_at = coalesce(paused_at, clock_timestamp()) where id = p_round_id;
  perform app._commit_session(v_session_id);
end $$;

create function api.resume_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := app._require_user();
  v_session_id uuid;
  v_round      app.rounds;
begin
  select session_id into v_session_id from app.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  perform app._lock_session(v_session_id);

  select * into v_round from app.rounds where id = p_round_id;
  if v_round.status <> 'ACTIVE' then raise exception 'round_not_active'; end if;
  if app._staff_role() is null and not app._on_round(p_round_id, v_uid) then
    raise exception 'not_allowed';
  end if;

  -- Give back the time the clock stood still.
  update app.rounds set ends_at = ends_at + (clock_timestamp() - paused_at), paused_at = null
   where id = p_round_id and paused_at is not null;
  perform app._commit_session(v_session_id);
end $$;

------------------------------------------------------------------ push subscriptions

create function api.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app._require_user();
begin
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 2048
     or char_length(p_p256dh) > 256 or char_length(p_auth) > 256 then
    raise exception 'invalid_subscription';
  end if;
  if not exists (select 1 from app.profiles where id = v_uid) then
    raise exception 'profile_required';
  end if;
  -- A browser endpoint belongs to one person: whoever subscribes last owns it.
  insert into app.push_subscriptions (endpoint, player_id, p256dh, auth)
  values (p_endpoint, v_uid, p_p256dh, p_auth)
  on conflict (endpoint) do update
     set player_id = excluded.player_id, p256dh = excluded.p256dh, auth = excluded.auth;
  -- Cap what one player can hoard.
  delete from app.push_subscriptions
   where player_id = v_uid and endpoint not in (
     select endpoint from app.push_subscriptions where player_id = v_uid order by created_at desc limit 5);
end $$;

create function api.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app._require_user();
begin
  delete from app.push_subscriptions where endpoint = p_endpoint and player_id = v_uid;
end $$;

------------------------------------------------------------------ grants

grant execute on function api.get_active_session_code() to anon, authenticated;
grant execute on function
  api.current_staff_role(),
  api.set_display_name(text),
  api.get_snapshot(text),
  api.join_queue(uuid, uuid),
  api.leave_queue(uuid),
  api.start_round(uuid),
  api.finish_round(uuid),
  api.pause_round(uuid),
  api.resume_round(uuid),
  api.save_push_subscription(text, text, text),
  api.delete_push_subscription(text)
to authenticated;
