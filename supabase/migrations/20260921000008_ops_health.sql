-- What an admin (or a monitor) needs to see before guessing that "Postgres isn't scaling": the durable push queue,
-- whether the 30-second timers are actually running, and how big the database's own bookkeeping has grown.
-- Slow session locks are logged by app._lock_session as `session_lock_wait` (search the Postgres logs for it).

create function api.ops_health() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_push     jsonb;
  v_timers   jsonb;
  v_snapshot jsonb;
begin
  perform app._require_staff(true);

  select jsonb_build_object(
           'enabled', app._push_enabled(),
           'queued', m.queue_length,
           'oldest_age_s', m.oldest_msg_age_sec,
           'delivered_or_dropped', m.total_messages - m.queue_length)
    into v_push
    from pgmq.metrics('push') m;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
           'last_run_at', l.start_time, 'last_status', l.status,
           'failures_24h', (select count(*) from cron.job_run_details d
                             where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours'))
           order by j.jobname), '[]'::jsonb)
    into v_timers
    from cron.job j
    left join lateral (
      select d.start_time, d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1
    ) l on true;

  -- Cumulative timings of get_snapshot, the query every phone runs after every change (pg_stat_statements).
  begin
    execute $q$
      select jsonb_build_object('calls', sum(calls), 'mean_ms', round((sum(total_exec_time) / nullif(sum(calls), 0))::numeric, 2),
                                'max_ms', round(max(max_exec_time)::numeric, 2))
        from extensions.pg_stat_statements
       where query ilike '%get_snapshot%' and query not ilike '%pg_stat_statements%'
    $q$ into v_snapshot;
  exception when others then
    v_snapshot := null;
  end;

  return jsonb_build_object(
    'now', clock_timestamp(),
    'live_sessions', (select count(*) from app.open_play_sessions where status = 'ACTIVE'),
    'participants', (select count(*) from app.session_participants),
    'anonymous_users', (select count(*) from auth.users where is_anonymous),
    'push', v_push,
    'timers', v_timers,
    'get_snapshot', v_snapshot);
end $$;

grant execute on function api.ops_health() to authenticated;
