-- Where to send notifications. `app.push_url` cannot be set on hosted Supabase (`alter database ... set` is
-- not allowed for the postgres role), so the URL and shared secret live in a table nothing else can read.
-- Set them once, in the SQL editor (see .env.example). Until then no notifications are sent.
create table public.push_config (
  key   text primary key check (key in ('url', 'secret')),
  value text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
create policy "no direct client access" on public.push_config
  for all to anon, authenticated using (false) with check (false);

-- Tell players about changes that concern them. The person who caused a change is not told about it.
create or replace function public._notify(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text := (select nullif(value, '') from public.push_config where key = 'url');
  v_secret text := (select nullif(value, '') from public.push_config where key = 'secret');
  v_code   text;
  v_actor  uuid := auth.uid();
  r        record;
begin
  if v_url is null or v_secret is null then return; end if;
  select code into v_code from public.open_play_sessions where id = p_session_id;

  -- Seated on a court.
  for r in
    select sp.player_id, c.court_number, rd.status
      from public.session_players sp
      join public.rounds rd on rd.id = sp.current_round_id
      join public.courts c on c.id = rd.court_id
     where sp.session_id = p_session_id and sp.state = 'PLAYING'
       and sp.notified_round_id is distinct from sp.current_round_id
       and sp.player_id is distinct from v_actor
       and exists (select 1 from public.push_subscriptions ps where ps.player_id = sp.player_id)
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      body := jsonb_build_object(
        'player_id', r.player_id,
        'title', 'You''re on court ' || r.court_number,
        'body', case when r.status = 'ACTIVE' then 'Your game has started. Head to the court now.'
                     else 'Head to the court. The game starts when it is full.' end,
        'tag', 'court',
        'url', '/play/' || v_code));
  end loop;
  update public.session_players
     set notified_round_id = current_round_id
   where session_id = p_session_id and state = 'PLAYING'
     and notified_round_id is distinct from current_round_id;

  -- Moved into the next four in line.
  for r in
    select q.player_id, q.pos
      from (select sp.player_id, sp.notified_next,
                   row_number() over (order by sp.queued_at, sp.player_id) as pos
              from public.session_players sp
             where sp.session_id = p_session_id and sp.state = 'QUEUED') q
     where q.pos <= 4 and not q.notified_next
       and q.player_id is distinct from v_actor
       and exists (select 1 from public.push_subscriptions ps where ps.player_id = q.player_id)
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      body := jsonb_build_object(
        'player_id', r.player_id,
        'title', 'You''re up next',
        'body', 'You''re #' || r.pos || ' in line. Stay close to the courts.',
        'tag', 'next',
        'url', '/play/' || v_code));
  end loop;
  with q as (
    select sp.player_id, sp.state,
           row_number() over (partition by sp.state order by sp.queued_at, sp.player_id) as pos
      from public.session_players sp where sp.session_id = p_session_id)
  update public.session_players sp
     set notified_next = (q.state = 'QUEUED' and q.pos <= 4)
    from q
   where sp.session_id = p_session_id and sp.player_id = q.player_id
     and sp.notified_next is distinct from (q.state = 'QUEUED' and q.pos <= 4);
end $$;

