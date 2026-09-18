-- Production hardening, driven by `supabase db advisors` and the auth-abuse review.

-- 1. Index every foreign key (advisor 0001). Cascades and per-player lookups scan these otherwise.
create index rounds_session_id         on public.rounds (session_id);
create index session_players_player    on public.session_players (player_id);
create index session_players_round     on public.session_players (current_round_id) where current_round_id is not null;
create index round_players_player      on public.round_players (player_id);

-- 2. Say "no direct access" out loud (advisor 0008). RLS is already on with no permissive
--    policy, so this changes nothing at runtime; it documents intent and quiets the linter.
--    SECURITY DEFINER functions run as the table owner and are unaffected.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'staff', 'open_play_sessions', 'courts', 'rounds', 'session_players', 'round_players']
  loop
    execute format('create policy "no direct client access" on public.%I for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

-- 3. Abuse limits. Anonymous players are free to create, so bound what one can do.
alter table public.open_play_sessions
  add column max_queue_size integer not null default 100 check (max_queue_size between 1 and 1000);

create or replace function public.join_queue(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := public._require_user();
  v_session public.open_play_sessions := public._lock_session(p_session_id);
begin
  if v_session.status <> 'ACTIVE' then raise exception 'session_ended'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile_required';
  end if;

  -- Throttle leave/join churn: every state change fans out a broadcast to the whole room.
  if exists (
    select 1 from public.session_players
     where session_id = p_session_id and player_id = v_uid and state = 'IDLE'
       and updated_at > clock_timestamp() - interval '2 seconds'
  ) then
    raise exception 'too_fast';
  end if;

  if (select count(*) from public.session_players
       where session_id = p_session_id and state = 'QUEUED') >= v_session.max_queue_size
     and not exists (select 1 from public.session_players
                      where session_id = p_session_id and player_id = v_uid and state <> 'IDLE') then
    -- Only refuse if they'd actually add to the queue; a free court would place them immediately.
    if not exists (
      select 1 from public.courts c
       where c.session_id = p_session_id and c.status = 'OPEN'
         and not exists (select 1 from public.rounds r where r.court_id = c.id and r.status = 'ACTIVE')
         and (select count(*) from public.round_players rp
                join public.rounds r on r.id = rp.round_id
               where r.court_id = c.id and r.status = 'FILLING' and rp.left_at is null) < 4
    ) then
      raise exception 'queue_full';
    end if;
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
