-- Push notifications through a transactional outbox instead of a fire-and-forget HTTP call.
--
-- Before: the state change decided "Victor needs a court notification", handed an HTTP request to pg_net, and
-- recorded him as notified. If the request was then lost, the database still believed he had been told.
-- Now: the same transaction that seats him also writes a message to a durable queue (pgmq). The message commits
-- with the change or not at all, and stays until a worker has delivered it. pg_net is only a wake-up call
-- ("there is work") and pg_cron repeats it every 30 s, so a lost wake-up costs seconds, not the notification.
--
-- The worker is POST /api/push in the Next.js app: it claims messages, sends them, then acknowledges them. A
-- send that succeeds but is not acknowledged is delivered again, so each message carries a deterministic key
-- (court-assigned:<round>:<participant>) that the worker uses as the Web Push topic to collapse the duplicate.
--
-- The URL of the worker and the shared secret still live in Vault (see .env.example); until both exist nothing
-- is queued and no notification is sent.

create extension if not exists pgmq;
select pgmq.create('push');
-- Nothing but our own functions (running as the owner) may touch the queue tables.
alter table pgmq.q_push enable row level security;
alter table pgmq.a_push enable row level security;

create function app._push_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'push_url' and nullif(decrypted_secret, '') is not null)
     and exists (select 1 from vault.decrypted_secrets where name = 'push_secret' and nullif(decrypted_secret, '') is not null)
$$;

-- Tell the worker there is something to deliver. Best effort: pg_net sends it after the transaction commits, and
-- the sweep below repeats it, so nothing depends on this call arriving.
create function app._kick_push_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text := (select nullif(decrypted_secret, '') from vault.decrypted_secrets where name = 'push_url');
  v_secret text := (select nullif(decrypted_secret, '') from vault.decrypted_secrets where name = 'push_secret');
begin
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := '{}'::jsonb);
end $$;

-- Tell players about changes that concern them. The person who caused a change is not told about it.
-- notified_round_id / notified_next record what has been *queued* for a player (in the same transaction as the
-- queue write), so the same news is never queued twice; delivery is the queue's business.
create function app._notify(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_code   text;
  v_actor  uuid := auth.uid();
  v_queued integer := 0;
  r        record;
begin
  if not app._push_enabled() then return; end if;
  select code into v_code from app.open_play_sessions where id = p_session_id;

  -- Seated on a court.
  for r in
    select sp.participant_id, p.auth_user_id, sp.current_round_id, c.court_number, rd.status
      from app.session_players sp
      join app.session_participants p on p.id = sp.participant_id
      join app.rounds rd on rd.id = sp.current_round_id
      join app.courts c on c.id = rd.court_id
     where sp.session_id = p_session_id and sp.state = 'PLAYING'
       and sp.notified_round_id is distinct from sp.current_round_id
       and p.auth_user_id is distinct from v_actor
       and exists (select 1 from app.push_subscriptions ps where ps.player_id = p.auth_user_id)
  loop
    perform pgmq.send('push', jsonb_build_object(
      'key', 'court-assigned:' || r.current_round_id || ':' || r.participant_id,
      'auth_user_id', r.auth_user_id,
      'title', 'You''re on court ' || r.court_number,
      'body', case when r.status = 'ACTIVE' then 'Your game has started. Head to the court now.'
                   else 'Head to the court. The game starts when it is full.' end,
      'tag', 'court',
      'url', '/play/' || v_code));
    v_queued := v_queued + 1;
  end loop;
  update app.session_players
     set notified_round_id = current_round_id
   where session_id = p_session_id and state = 'PLAYING'
     and notified_round_id is distinct from current_round_id;

  -- Moved into the next four in line.
  for r in
    select q.participant_id, q.auth_user_id, q.queued_at, q.pos
      from (select sp.participant_id, p.auth_user_id, sp.queued_at, sp.notified_next,
                   row_number() over (order by sp.queued_at, sp.participant_id) as pos
              from app.session_players sp
              join app.session_participants p on p.id = sp.participant_id
             where sp.session_id = p_session_id and sp.state = 'QUEUED') q
     where q.pos <= 4 and not q.notified_next
       and q.auth_user_id is distinct from v_actor
       and exists (select 1 from app.push_subscriptions ps where ps.player_id = q.auth_user_id)
  loop
    perform pgmq.send('push', jsonb_build_object(
      'key', 'up-next:' || r.participant_id || ':' || (extract(epoch from r.queued_at) * 1000)::bigint,
      'auth_user_id', r.auth_user_id,
      'title', 'You''re up next',
      'body', 'You''re #' || r.pos || ' in line. Stay close to the courts.',
      'tag', 'next',
      'url', '/play/' || v_code));
    v_queued := v_queued + 1;
  end loop;
  with q as (
    select sp.participant_id, sp.state,
           row_number() over (partition by sp.state order by sp.queued_at, sp.participant_id) as pos
      from app.session_players sp where sp.session_id = p_session_id)
  update app.session_players sp
     set notified_next = (q.state = 'QUEUED' and q.pos <= 4)
    from q
   where sp.participant_id = q.participant_id
     and sp.notified_next is distinct from (q.state = 'QUEUED' and q.pos <= 4);

  if v_queued > 0 then perform app._kick_push_worker(); end if;
end $$;

-- pg_cron, every 30 s: whatever is still queued (a lost wake-up, a worker that was down) gets another nudge.
create function app._push_sweep() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if app._push_enabled() and (select queue_length from pgmq.metrics('push')) > 0 then
    perform app._kick_push_worker();
  end if;
end $$;

do $$
begin
  perform cron.schedule('push-outbox-sweep', '30 seconds', 'select app._push_sweep()');
exception when others then
  raise notice 'pg_cron unavailable (%): queued notifications wait for the next state change to wake the worker', sqlerrm;
end $$;

------------------------------------------------------------------ the worker's interface (service role only)

-- Claim up to p_limit messages, each hidden from other workers for p_visibility_seconds, with the devices to send
-- it to. A message that is neither acknowledged nor retried reappears after that time.
create function api.push_claim(p_limit integer default 20, p_visibility_seconds integer default 30) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'msg_id', m.msg_id, 'read_ct', m.read_ct, 'enqueued_at', m.enqueued_at, 'payload', m.message,
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
          from app.push_subscriptions ps where ps.player_id = (m.message ->> 'auth_user_id')::uuid), '[]'::jsonb)))
      from pgmq.read('push', p_visibility_seconds, p_limit) m), '[]'::jsonb);
end $$;

-- Delivered (or given up on): move it to the archive, which keeps it for inspection.
create function api.push_ack(p_msg_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.archive('push', p_msg_id);
end $$;

-- Delivery failed for now: make it visible again after p_delay_seconds.
create function api.push_retry(p_msg_id bigint, p_delay_seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.set_vt('push', p_msg_id, p_delay_seconds);
end $$;

create function api.push_subscriptions_of(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::jsonb)
    from app.push_subscriptions where player_id = p_user_id
$$;

-- The push service said the device is gone (404/410).
create function api.push_forget_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from app.push_subscriptions where endpoint = p_endpoint
$$;

grant execute on function
  api.push_claim(integer, integer),
  api.push_ack(bigint),
  api.push_retry(bigint, integer),
  api.push_subscriptions_of(uuid),
  api.push_forget_subscription(text)
to service_role;
