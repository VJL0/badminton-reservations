-- The API surface is a contract. This fails when a function becomes callable by a role that should not have it,
-- so exposing something new is a deliberate edit of the lists below, visible in review, never an accident of
-- a missing REVOKE. Only schemas this app owns are inspected (api, app, public).
begin;
select plan(18);

create function pg_temp.executable_by(p_role text) returns text[] language sql as $$
  select coalesce(array_agg(f order by f), '{}')
    from (select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as f
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('api', 'app', 'public') and has_function_privilege(p_role, p.oid, 'execute')) x
$$;

select is(pg_temp.executable_by('authenticated'), array[
  'api.add_court(uuid, integer, integer)',
  'api.create_session(text, integer, integer, text, boolean)',
  'api.current_staff_role()',
  'api.delete_court(uuid)',
  'api.delete_push_subscription(text)',
  'api.delete_session(uuid)',
  'api.end_session(uuid)',
  'api.finish_round(uuid)',
  'api.get_active_session_code()',
  'api.get_session_summary(uuid)',
  'api.get_snapshot(text)',
  'api.join_queue(uuid, uuid)',
  'api.leave_queue(uuid)',
  'api.list_sessions()',
  'api.list_staff()',
  'api.ops_health()',
  'api.pause_round(uuid)',
  'api.remove_player(uuid, uuid)',
  'api.resume_round(uuid)',
  'api.save_push_subscription(text, text, text)',
  'api.set_display_name(text)',
  'api.start_round(uuid)',
  'api.update_court(uuid, integer, integer)',
  'api.update_session_settings(uuid, integer, boolean, boolean, integer, boolean)'
], 'signed-in users can call exactly these functions (staff-only ones re-check the role inside)');

select is(pg_temp.executable_by('anon'), array['api.get_active_session_code()'],
  'signed-out visitors can only ask which session is live');

select is(pg_temp.executable_by('service_role'), array[
  'api.grant_staff(uuid, text)',
  'api.push_ack(bigint)',
  'api.push_claim(integer, integer)',
  'api.push_forget_subscription(text)',
  'api.push_retry(bigint, integer)',
  'api.push_subscriptions_of(uuid)'
], 'the server-side secret key can call exactly the worker and invite functions');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('api', 'app', 'public')
              and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')), 0,
  'PUBLIC can execute nothing');

-- The tables are unreachable, in depth: no schema access, no grants, RLS on everywhere.
select ok(not has_schema_privilege('anon', 'app', 'usage'), 'anon has no access to the private schema');
select ok(not has_schema_privilege('authenticated', 'app', 'usage'), 'signed-in users have no access to the private schema');
select ok(has_schema_privilege('authenticated', 'api', 'usage'), 'but they can reach the api schema');
select is((select count(*)::int from pg_class c
            where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
              and (has_table_privilege('anon', c.oid, 'select,insert,update,delete')
                   or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))), 0,
  'no table in the private schema is granted to a client role');
select is((select count(*)::int from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind = 'r' and not c.relrowsecurity), 0,
  'row level security is on for every table');
select is((select count(*)::int from pg_class where relnamespace = 'api'::regnamespace and relkind in ('r', 'v', 'm', 'p')), 0,
  'the api schema holds functions only, never tables');
select is((select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'm', 'p', 'S')), 0,
  'nothing of ours is left in public');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace), 0, 'and no functions');

-- A function nobody remembered to lock down starts closed.
create function api.zz_probe() returns int language sql as 'select 1';
create function app.zz_probe() returns int language sql as 'select 1';
create function public.zz_probe() returns int language sql as 'select 1';
select ok(not has_function_privilege('anon', 'api.zz_probe()', 'execute'), 'a new api function is closed to anon');
select ok(not has_function_privilege('authenticated', 'api.zz_probe()', 'execute'), 'and to signed-in users');
select ok(not has_function_privilege('service_role', 'api.zz_probe()', 'execute'), 'and to the service role');
select ok(not has_function_privilege('authenticated', 'app.zz_probe()', 'execute'), 'a new private function is closed too');
select ok(not has_function_privilege('anon', 'public.zz_probe()', 'execute'), 'and one dropped into public, where Supabase used to open everything');
select ok(not has_function_privilege('authenticated', 'public.zz_probe()', 'execute'), 'for signed-in users as well');

select * from finish();
rollback;
