-- Staff-only history of one session. Nothing new is stored: session_players keeps every player who
-- ever joined, and rounds / round_players keep every game with its start, end and four players.
create function public.get_session_details(p_session_id uuid) returns jsonb
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
      'started_at', v_session.started_at, 'ended_at', v_session.ended_at,
      'courts', (select count(*) from public.courts c where c.session_id = v_session.id)),
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

revoke all on function public.get_session_details(uuid) from public, anon;
grant execute on function public.get_session_details(uuid) to authenticated;
