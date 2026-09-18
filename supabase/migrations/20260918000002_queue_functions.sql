-- Business operations. Every state-changing function locks the session row
-- first, so all queue/court mutations for one session are serialized.

------------------------------------------------------------------ helpers

create function public._require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return v_uid;
end $$;

create function public._staff_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select role from public.staff where user_id = auth.uid();
$$;

create function public._require_staff(p_admin_only boolean default false) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.staff_role := public._staff_role();
begin
  if v_role is null or (p_admin_only and v_role <> 'ADMIN') then
    raise exception 'not_staff';
  end if;
end $$;

create function public._lock_session(p_session_id uuid) returns public.open_play_sessions
language plpgsql security definer set search_path = '' as $$
declare v_session public.open_play_sessions;
begin
  select * into v_session from public.open_play_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  return v_session;
end $$;

create function public._broadcast(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('session_id', p_session_id),
    'session_changed',
    'session:' || p_session_id::text,
    true
  );
end $$;

-- Take a player out of a FILLING round. Cancels the round if it empties.
-- p_requeue keeps the player's original queued_at, so they keep their place.
create function public._release_from_filling(p_round_id uuid, p_player_id uuid, p_requeue boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_session_id uuid;
begin
  update public.round_players set left_at = clock_timestamp()
   where round_id = p_round_id and player_id = p_player_id and left_at is null;

  select session_id into v_session_id from public.rounds where id = p_round_id;

  update public.session_players
     set state = case when p_requeue then 'QUEUED'::public.player_state else 'IDLE'::public.player_state end,
         queued_at = case when p_requeue then coalesce(queued_at, clock_timestamp()) else null end,
         current_round_id = null,
         updated_at = clock_timestamp()
   where session_id = v_session_id and player_id = p_player_id;

  if not exists (select 1 from public.round_players where round_id = p_round_id and left_at is null) then
    update public.rounds set status = 'CANCELLED', ended_at = clock_timestamp() where id = p_round_id;
  end if;
end $$;

------------------------------------------------------------------ allocator

-- Assign queued players (oldest first) to courts until the queue or the free
-- slots run out. Courts are packed: partially filled courts first, then the
-- fullest, then the lowest court number. The 4th player starts the timer.
create function public._allocate(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session   public.open_play_sessions;
  v_player    uuid;
  v_court_id  uuid;
  v_round_id  uuid;
  v_filled    integer;
  v_slot      integer;
begin
  select * into v_session from public.open_play_sessions where id = p_session_id;

  loop
    select sp.player_id into v_player
      from public.session_players sp
     where sp.session_id = p_session_id and sp.state = 'QUEUED'
     order by sp.queued_at, sp.player_id
     limit 1;
    exit when v_player is null;

    select c.id, r.id, coalesce(rp.n, 0)
      into v_court_id, v_round_id, v_filled
      from public.courts c
      left join public.rounds r
        on r.court_id = c.id and r.status in ('FILLING', 'ACTIVE')
      left join lateral (
        select count(*) as n from public.round_players x
         where x.round_id = r.id and x.left_at is null
      ) rp on true
     where c.session_id = p_session_id
       and c.status = 'OPEN'
       and (r.id is null or r.status = 'FILLING')
       and coalesce(rp.n, 0) < 4
     order by coalesce(rp.n, 0) desc, c.court_number
     limit 1;
    exit when v_court_id is null;

    if v_round_id is null then
      insert into public.rounds (session_id, court_id) values (p_session_id, v_court_id)
      returning id into v_round_id;
    end if;

    select min(s) into v_slot
      from generate_series(1, 4) s
     where not exists (
       select 1 from public.round_players
        where round_id = v_round_id and slot = s and left_at is null);

    insert into public.round_players (round_id, player_id, slot)
    values (v_round_id, v_player, v_slot);

    update public.session_players
       set state = 'PLAYING', current_round_id = v_round_id, updated_at = clock_timestamp()
     where session_id = p_session_id and player_id = v_player;

    if v_filled + 1 = 4 then
      update public.rounds
         set status = 'ACTIVE',
             started_at = clock_timestamp(),
             ends_at = clock_timestamp() + make_interval(secs => v_session.game_duration_seconds)
       where id = v_round_id;
    end if;
  end loop;
end $$;

------------------------------------------------------------------ player API

create function public.set_display_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._require_user(); v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 40 then raise exception 'invalid_name'; end if;
  insert into public.profiles (id, display_name) values (v_uid, v_name)
  on conflict (id) do update set display_name = excluded.display_name;
end $$;

create function public.join_queue(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := public._require_user();
  v_session public.open_play_sessions := public._lock_session(p_session_id);
begin
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile_required';
  end if;

  -- Everyone enters the queue first; the allocator then places them.
  insert into public.session_players (session_id, player_id, state, queued_at)
  values (p_session_id, v_uid, 'QUEUED', clock_timestamp())
  on conflict (session_id, player_id) do update
     set state = 'QUEUED', queued_at = clock_timestamp(), updated_at = clock_timestamp()
   where public.session_players.state = 'IDLE';
  if not found then return; end if;  -- already queued or playing: idempotent

  perform public._allocate(p_session_id);
  perform public._broadcast(p_session_id);
end $$;

create function public.leave_queue(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_user();
  v_sp  public.session_players;
  v_round_status public.round_status;
begin
  perform public._lock_session(p_session_id);
  select * into v_sp from public.session_players
   where session_id = p_session_id and player_id = v_uid;
  if not found or v_sp.state = 'IDLE' then return; end if;

  if v_sp.state = 'QUEUED' then
    update public.session_players
       set state = 'IDLE', queued_at = null, updated_at = clock_timestamp()
     where session_id = p_session_id and player_id = v_uid;
  else
    select status into v_round_status from public.rounds where id = v_sp.current_round_id;
    if v_round_status <> 'FILLING' then raise exception 'game_in_progress'; end if;
    perform public._release_from_filling(v_sp.current_round_id, v_uid, false);
  end if;

  perform public._allocate(p_session_id);
  perform public._broadcast(p_session_id);
end $$;

-- End a game (early or at time-up), then immediately refill the court.
-- Allowed for staff and for the four players in the round. Idempotent.
create function public.finish_round(p_round_id uuid) returns void
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

  if public._staff_role() is null and not exists (
    select 1 from public.round_players
     where round_id = p_round_id and player_id = v_uid and left_at is null
  ) then
    raise exception 'not_allowed';
  end if;

  update public.rounds set status = 'COMPLETED', ended_at = clock_timestamp()
   where id = p_round_id;
  update public.round_players set left_at = clock_timestamp()
   where round_id = p_round_id and left_at is null;
  update public.session_players
     set state = case when v_session.auto_requeue_on_finish
                      then 'QUEUED'::public.player_state else 'IDLE'::public.player_state end,
         queued_at = case when v_session.auto_requeue_on_finish then clock_timestamp() end,
         current_round_id = null,
         updated_at = clock_timestamp()
   where current_round_id = p_round_id;

  perform public._allocate(v_session_id);
  perform public._broadcast(v_session_id);
end $$;

------------------------------------------------------------------ staff API

-- Remove a queued player or a player standing in a not-yet-started round.
create function public.remove_player(p_session_id uuid, p_player_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_sp public.session_players;
  v_round_status public.round_status;
begin
  perform public._require_staff();
  perform public._lock_session(p_session_id);
  select * into v_sp from public.session_players
   where session_id = p_session_id and player_id = p_player_id;
  if not found or v_sp.state = 'IDLE' then return; end if;

  if v_sp.state = 'QUEUED' then
    update public.session_players
       set state = 'IDLE', queued_at = null, updated_at = clock_timestamp()
     where session_id = p_session_id and player_id = p_player_id;
  else
    select status into v_round_status from public.rounds where id = v_sp.current_round_id;
    if v_round_status <> 'FILLING' then raise exception 'game_in_progress'; end if;
    perform public._release_from_filling(v_sp.current_round_id, p_player_id, false);
  end if;

  perform public._allocate(p_session_id);
  perform public._broadcast(p_session_id);
end $$;

-- A paused court takes no new players. Anyone waiting on it goes back to the
-- queue with their original place; a game already in progress plays out.
create function public.pause_court(p_court_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_round      public.rounds;
  v_pid        uuid;
begin
  perform public._require_staff();
  select session_id into v_session_id from public.courts where id = p_court_id;
  if v_session_id is null then raise exception 'court_not_found'; end if;
  perform public._lock_session(v_session_id);

  update public.courts set status = 'PAUSED' where id = p_court_id;
  select * into v_round from public.rounds where court_id = p_court_id and status = 'FILLING';
  if found then
    for v_pid in select player_id from public.round_players
                  where round_id = v_round.id and left_at is null order by slot
    loop
      perform public._release_from_filling(v_round.id, v_pid, true);
    end loop;
  end if;

  perform public._allocate(v_session_id);
  perform public._broadcast(v_session_id);
end $$;

create function public.resume_court(p_court_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_session_id uuid;
begin
  perform public._require_staff();
  select session_id into v_session_id from public.courts where id = p_court_id;
  if v_session_id is null then raise exception 'court_not_found'; end if;
  perform public._lock_session(v_session_id);

  update public.courts set status = 'OPEN' where id = p_court_id;
  perform public._allocate(v_session_id);
  perform public._broadcast(v_session_id);
end $$;

------------------------------------------------------------------ admin API

create function public.create_session(
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

  insert into public.open_play_sessions (code, name, game_duration_seconds, auto_requeue_on_finish)
  values (v_code, btrim(p_name), p_game_duration_seconds, p_auto_requeue)
  returning id into v_id;

  insert into public.courts (session_id, court_number)
  select v_id, n from generate_series(1, p_court_count) n;
  return v_id;
end $$;

create function public.end_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_staff(true);
  perform public._lock_session(p_session_id);

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
  update public.open_play_sessions set status = 'ENDED', ended_at = clock_timestamp()
   where id = p_session_id;

  perform public._broadcast(p_session_id);
end $$;

create function public.list_sessions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'name', s.name, 'status', s.status,
      'created_at', s.created_at, 'ended_at', s.ended_at,
      'courts', (select count(*) from public.courts c where c.session_id = s.id),
      'players', (select count(*) from public.session_players p where p.session_id = s.id)
    ) order by s.created_at desc)
    from public.open_play_sessions s), '[]'::jsonb);
end $$;

------------------------------------------------------------------ read API

-- One authoritative snapshot of a session, looked up by its QR code.
create function public.get_snapshot(p_code text) returns jsonb
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
      'game_duration_seconds', v_session.game_duration_seconds),
    'me', v_me,
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'court_number', c.court_number, 'status', c.status,
        'round', (
          select jsonb_build_object(
            'id', r.id, 'status', r.status, 'started_at', r.started_at, 'ends_at', r.ends_at,
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
      from public.courts c where c.session_id = v_session.id), '[]'::jsonb),
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', q.player_id, 'name', p.display_name, 'position', q.pos)
             order by q.pos)
        from (select sp.player_id,
                     row_number() over (order by sp.queued_at, sp.player_id) as pos
                from public.session_players sp
               where sp.session_id = v_session.id and sp.state = 'QUEUED') q
        join public.profiles p on p.id = q.player_id), '[]'::jsonb)
  );
end $$;
