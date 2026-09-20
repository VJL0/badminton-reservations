-- Pausing is about the game clock, not the court: a court is never "paused" and always takes players.
-- A running game can be paused and played again; the court itself can be added or deleted.

drop function public.pause_court(uuid);
drop function public.resume_court(uuid);

-- Deleted courts are kept (soft delete) so past games still show which court they were on.
alter table public.courts add column removed_at timestamptz;
alter table public.courts drop column status;
drop type public.court_status;


create or replace function public._sync_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_round   public.rounds;
  v_court   public.courts;
  v_session public.open_play_sessions;
  v_n       integer;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if not found or v_round.status <> 'FILLING' then return; end if;
  select * into v_court from public.courts where id = v_round.court_id;
  select * into v_session from public.open_play_sessions where id = v_round.session_id;
  select count(*) into v_n from public.round_players where round_id = p_round_id and left_at is null;

  if v_n >= v_court.capacity and v_session.auto_start then
    if v_session.start_delay_seconds = 0 then
      perform public._start_round(p_round_id);
    else
      update public.rounds
         set start_at = coalesce(start_at, clock_timestamp() + make_interval(secs => v_session.start_delay_seconds))
       where id = p_round_id;
    end if;
  else
    update public.rounds set start_at = null where id = p_round_id and start_at is not null;
  end if;
end $$;

create or replace function public._allocate(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_q        record;
  v_court_id uuid;
  v_round_id uuid;
  v_slot     integer;
begin
  for v_q in
    select sp.player_id, sp.preferred_court_id
      from public.session_players sp
     where sp.session_id = p_session_id and sp.state = 'QUEUED'
     order by sp.queued_at, sp.player_id
  loop
    v_court_id := null; v_round_id := null;

    select c.id, r.id
      into v_court_id, v_round_id
      from public.courts c
      left join public.rounds r
        on r.court_id = c.id and r.status in ('FILLING', 'ACTIVE')
      left join lateral (
        select count(*) as n from public.round_players x
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
      insert into public.rounds (session_id, court_id) values (p_session_id, v_court_id)
      returning id into v_round_id;
    end if;

    select min(s) into v_slot
      from generate_series(1, (select capacity from public.courts where id = v_court_id)) s
     where not exists (
       select 1 from public.round_players
        where round_id = v_round_id and slot = s and left_at is null);

    insert into public.round_players (round_id, player_id, slot)
    values (v_round_id, v_q.player_id, v_slot);

    update public.session_players
       set state = 'PLAYING', current_round_id = v_round_id, preferred_court_id = null,
           updated_at = clock_timestamp()
     where session_id = p_session_id and player_id = v_q.player_id;

    perform public._sync_round(v_round_id);
  end loop;
end $$;

create or replace function public.join_queue(p_session_id uuid, p_court_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := public._require_user();
  v_session public.open_play_sessions := public._lock_session(p_session_id);
  v_court   public.courts;
  v_sp      public.session_players;
begin
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile_required';
  end if;
  if p_court_id is not null then
    select * into v_court from public.courts where id = p_court_id and session_id = p_session_id and removed_at is null;
    if not found then raise exception 'court_not_found'; end if;
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

create or replace function public.start_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := public._require_user();
  v_session_id uuid;
  v_round      public.rounds;
  v_n          integer;
begin
  select session_id into v_session_id from public.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  perform public._lock_session(v_session_id);

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.status = 'ACTIVE' then return; end if;  -- lost the race: no-op
  if v_round.status <> 'FILLING' then raise exception 'round_not_found'; end if;

  if v_round.start_at is null or v_round.start_at > clock_timestamp() then
    if public._staff_role() is null and not exists (
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
  v_uid        uuid := public._require_user();
  v_session_id uuid;
  v_session    public.open_play_sessions;
  v_round      public.rounds;
  v_requeue    uuid;
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

  perform public._allocate(v_session_id);
  perform public._broadcast(v_session_id);
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

create or replace function public.add_court(p_session_id uuid, p_side_a integer default 2, p_side_b integer default 2)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_session public.open_play_sessions;
begin
  perform public._require_staff(true);
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
  perform public._require_staff(true);
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

create or replace function public.list_sessions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'name', s.name, 'status', s.status,
      'created_at', s.created_at, 'ended_at', s.ended_at,
      'courts', (select count(*) from public.courts c where c.session_id = s.id and c.removed_at is null),
      'players', (select count(*) from public.session_players p where p.session_id = s.id)
    ) order by s.created_at desc)
    from public.open_play_sessions s), '[]'::jsonb);
end $$;

create or replace function public.get_session_details(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_session public.open_play_sessions;
begin
  perform public._require_staff();
  select * into v_session from public.open_play_sessions where id = p_session_id;
  if not found then return null; end if;

  return jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id, 'code', v_session.code, 'name', v_session.name, 'status', v_session.status,
      'game_duration_seconds', v_session.game_duration_seconds,
      'auto_requeue_on_finish', v_session.auto_requeue_on_finish,
      'auto_start', v_session.auto_start, 'start_delay_seconds', v_session.start_delay_seconds,
      'started_at', v_session.started_at, 'ended_at', v_session.ended_at,
      'courts', (select count(*) from public.courts c where c.session_id = v_session.id and c.removed_at is null)),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', sp.player_id, 'name', pr.display_name,
               'joined_at', sp.joined_at, 'state', sp.state,
               'games', (select count(distinct rp.round_id)
                           from public.round_players rp
                           join public.rounds r on r.id = rp.round_id
                          where rp.player_id = sp.player_id and r.session_id = v_session.id
                            and r.started_at is not null))
             order by sp.joined_at)
        from public.session_players sp
        join public.profiles pr on pr.id = sp.player_id
       where sp.session_id = v_session.id), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'court_number', c.court_number, 'status', r.status,
               'started_at', r.started_at, 'ended_at', r.ended_at,
               'players', coalesce((
                  select jsonb_agg(pr.display_name order by rp.slot)
                    from public.round_players rp
                    join public.profiles pr on pr.id = rp.player_id
                   where rp.round_id = r.id), '[]'::jsonb))
             order by r.started_at desc)
        from public.rounds r
        join public.courts c on c.id = r.court_id
       where r.session_id = v_session.id and r.started_at is not null), '[]'::jsonb)
  );
end $$;


-- Stop or restart the clock of a running game. Same people who may end a game: officers and its players.
create function public.pause_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := public._require_user();
  v_session_id uuid;
  v_round      public.rounds;
begin
  select session_id into v_session_id from public.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  perform public._lock_session(v_session_id);

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.status <> 'ACTIVE' then raise exception 'round_not_active'; end if;
  if public._staff_role() is null and not exists (
    select 1 from public.round_players where round_id = p_round_id and player_id = v_uid and left_at is null
  ) then
    raise exception 'not_allowed';
  end if;

  update public.rounds set paused_at = coalesce(paused_at, clock_timestamp()) where id = p_round_id;
  perform public._broadcast(v_session_id);
end $$;

create function public.resume_round(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := public._require_user();
  v_session_id uuid;
  v_round      public.rounds;
begin
  select session_id into v_session_id from public.rounds where id = p_round_id;
  if v_session_id is null then raise exception 'round_not_found'; end if;
  perform public._lock_session(v_session_id);

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.status <> 'ACTIVE' then raise exception 'round_not_active'; end if;
  if public._staff_role() is null and not exists (
    select 1 from public.round_players where round_id = p_round_id and player_id = v_uid and left_at is null
  ) then
    raise exception 'not_allowed';
  end if;

  -- Give back the time the clock stood still.
  update public.rounds set ends_at = ends_at + (clock_timestamp() - paused_at), paused_at = null
   where id = p_round_id and paused_at is not null;
  perform public._broadcast(v_session_id);
end $$;

-- Delete a court. Not while a game is running on it, and never the last one. Anyone waiting on it
-- goes back to the queue with their place.
create function public.delete_court(p_court_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_court   public.courts;
  v_session public.open_play_sessions;
  v_round   public.rounds;
begin
  perform public._require_staff(true);
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

revoke all on function public.pause_round(uuid), public.resume_round(uuid), public.delete_court(uuid) from public, anon;
grant execute on function public.pause_round(uuid), public.resume_round(uuid), public.delete_court(uuid) to authenticated;
