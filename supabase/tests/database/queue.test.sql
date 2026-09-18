begin;
select plan(34);

create schema tests;
-- Run SQL as an authenticated user, then hand the role back (so pgTAP itself
-- always runs as the test owner).
create function tests.call(p_uid uuid, p_sql text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'postgres', true);
end $$;
create function tests.join(p_uid uuid, p_session uuid) returns void language sql as $$
  select tests.call(p_uid, format('select public.join_queue(%L)', p_session)) $$;
create function tests.snapshot(p_uid uuid, p_code text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v := public.get_snapshot(p_code);
  perform set_config('role', 'postgres', true);
  return v;
end $$;
create function tests.uid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- 24 players (1..24), admin (100), operator (101)
insert into auth.users (id) select tests.uid(n) from generate_series(1, 24) n;
insert into auth.users (id) values (tests.uid(100)), (tests.uid(101));
insert into public.staff (user_id, role) values (tests.uid(100), 'ADMIN'), (tests.uid(101), 'OPERATOR');

select tests.call(tests.uid(n), format('select public.set_display_name(%L)', 'P' || n)) from generate_series(1, 24) n;
select tests.call(tests.uid(100), $$select public.set_display_name('Admin')$$);

-- ---------- RLS / grants
select throws_ok($$ select tests.call(tests.uid(1), 'select * from public.session_players') $$, '42501', null, 'players cannot read tables directly');
select throws_ok($$ select tests.call(tests.uid(1), 'select public._allocate(gen_random_uuid())') $$, '42501', null, 'internal allocator not callable');
select throws_ok($$ select tests.call(tests.uid(1), $q$select public.create_session('x')$q$) $$, 'not_staff', 'players cannot create sessions');
select throws_ok($$ select tests.call(tests.uid(101), $q$select public.create_session('x')$q$) $$, 'not_staff', 'operators cannot create sessions');

-- ---------- session setup
select tests.call(tests.uid(100), $$select public.create_session('Friday', 3, 1200, 'FRIDAY')$$);
create temp table t_s as select id from public.open_play_sessions where code = 'FRIDAY';
select is((select count(*)::int from public.courts where session_id = (select id from t_s)), 3, 'three courts created');

-- ---------- packing + timer only on 4th player
select tests.join(tests.uid(n), (select id from t_s)) from generate_series(1, 3) n;
select is((select c.court_number from public.rounds r join public.courts c on c.id = r.court_id
            where r.session_id = (select id from t_s) and r.status = 'FILLING'), 1,
          'first three players are packed onto court 1');
select is((select ends_at from public.rounds where status = 'FILLING' and session_id = (select id from t_s)), null,
          'no timer while filling');
select tests.join(tests.uid(4), (select id from t_s));
select ok((select ends_at - started_at = interval '20 minutes' from public.rounds
            where status = 'ACTIVE' and session_id = (select id from t_s)),
          '4th player starts a 20 minute timer');

-- ---------- 20 players total → 12 playing, 8 queued
select tests.join(tests.uid(n), (select id from t_s)) from generate_series(5, 20) n;
select is((select count(*)::int from public.session_players where session_id = (select id from t_s) and state = 'PLAYING'), 12, '12 playing');
select is((select count(*)::int from public.session_players where session_id = (select id from t_s) and state = 'QUEUED'), 8, '8 queued');
select is((select count(distinct c.court_number)::int from public.round_players rp
            join public.rounds r on r.id = rp.round_id join public.courts c on c.id = r.court_id
           where rp.left_at is null and r.session_id = (select id from t_s)), 3, 'all three courts used');
select is((select max(n)::int from (select count(*) n from public.round_players rp join public.rounds r on r.id = rp.round_id
            where rp.left_at is null and r.session_id = (select id from t_s) group by rp.round_id) x), 4,
          'never more than 4 per court');
select is((select count(*)::int from (select rp.player_id from public.round_players rp join public.rounds r on r.id = rp.round_id
            where rp.left_at is null and r.session_id = (select id from t_s)
            group by rp.player_id having count(*) > 1) x), 0, 'no duplicate assignment');

-- ---------- join is idempotent
select tests.join(tests.uid(1), (select id from t_s));
select is((select count(*)::int from public.session_players where session_id = (select id from t_s) and state = 'PLAYING'), 12, 'double join is a no-op');

-- ---------- finish_round promotes the queue in FIFO order
create temp table t_c2 as
  select r.id from public.rounds r join public.courts c on c.id = r.court_id
   where c.session_id = (select id from t_s) and c.court_number = 2 and r.status = 'ACTIVE';
select throws_ok(format('select tests.call(tests.uid(24), %L)', format('select public.finish_round(%L)', (select id from t_c2))),
  'not_allowed', 'outsider cannot end a game');
select tests.call(tests.uid(101), format('select public.finish_round(%L)', (select id from t_c2)));
select tests.call(tests.uid(101), format('select public.finish_round(%L)', (select id from t_c2)));  -- second press: no-op
select is((select count(*)::int from public.rounds r join public.courts c on c.id = r.court_id
            where c.court_number = 2 and c.session_id = (select id from t_s) and r.status = 'ACTIVE'), 1,
          'exactly one replacement round despite double end');
select is((select count(*)::int from public.session_players where session_id = (select id from t_s) and state = 'QUEUED'), 4, 'queue shrank by 4');
select is((select count(*)::int from public.session_players where session_id = (select id from t_s) and state = 'IDLE' and queued_at is null), 4,
          'finished players are IDLE (no auto requeue)');
select is((select array_agg(p.display_name order by rp.slot) from public.round_players rp
            join public.profiles p on p.id = rp.player_id
           where rp.left_at is null and rp.round_id = (select r.id from public.rounds r
              join public.courts c on c.id = r.court_id where c.court_number = 2
               and c.session_id = (select id from t_s) and r.status = 'ACTIVE')),
          array['P13','P14','P15','P16'], 'oldest four queued players took the court');

-- ---------- snapshot
select is((tests.snapshot(tests.uid(17), 'friday') -> 'me' ->> 'queue_position')::int, 1, 'queue #5 becomes #1');
select is(jsonb_array_length(tests.snapshot(tests.uid(17), 'FRIDAY') -> 'queue'), 4, 'snapshot queue length');

-- ---------- leave
select tests.call(tests.uid(17), format('select public.leave_queue(%L)', (select id from t_s)));
select is((select state::text from public.session_players where player_id = tests.uid(17)), 'IDLE', 'leaving the queue → IDLE');

-- ---------- pause: skipped by allocator; pausing a filling court requeues; resume refills
select tests.call(tests.uid(100), $$select public.create_session('Pause', 2, 600, 'PAUSE')$$);
create temp table t_p as select id from public.open_play_sessions where code = 'PAUSE';
create temp table t_pc as select id, court_number from public.courts where session_id = (select id from t_p);
select tests.call(tests.uid(100), format('select public.pause_court(%L)', (select id from t_pc where court_number = 1)));
select tests.join(tests.uid(21), (select id from t_p));
select is((select c.court_number from public.round_players rp join public.rounds r on r.id = rp.round_id
            join public.courts c on c.id = r.court_id where rp.left_at is null and r.session_id = (select id from t_p)), 2,
          'paused court is skipped');
select tests.call(tests.uid(100), format('select public.pause_court(%L)', (select id from t_pc where court_number = 2)));
select is((select state::text from public.session_players where player_id = tests.uid(21) and session_id = (select id from t_p)), 'QUEUED',
          'pausing a filling court requeues its players');
select tests.call(tests.uid(100), format('select public.resume_court(%L)', (select id from t_pc where court_number = 1)));
select is((select state::text from public.session_players where player_id = tests.uid(21) and session_id = (select id from t_p)), 'PLAYING',
          'resuming a court refills it from the queue');

-- ---------- constraints
select throws_ok($$ insert into public.rounds (session_id, court_id)
    select session_id, court_id from public.rounds where status = 'ACTIVE' limit 1 $$,
  '23505', null, 'DB refuses a second live round on a court');

-- ---------- abuse limits
select tests.call(tests.uid(100), $$select public.create_session('Cap', 1, 600, 'CAPS')$$);
create temp table t_k as select id from public.open_play_sessions where code = 'CAPS';
update public.open_play_sessions set max_queue_size = 1 where id = (select id from t_k);
select tests.join(tests.uid(n), (select id from t_k)) from generate_series(1, 5) n;
select is((select count(*)::int from public.session_players where session_id = (select id from t_k) and state = 'QUEUED'), 1,
          'one court full, one player waiting');
select throws_ok(format('select tests.join(tests.uid(6), %L)', (select id from t_k)), 'queue_full', 'a full queue refuses more players');
select tests.call(tests.uid(5), format('select public.leave_queue(%L)', (select id from t_k)));
select is((select state::text from public.session_players where player_id = tests.uid(5) and session_id = (select id from t_k)), 'IDLE',
          'a waiting player can leave');
select throws_ok(format('select tests.join(tests.uid(5), %L)', (select id from t_k)), 'too_fast', 'instant leave/join churn is throttled');
select is((select count(*)::int from pg_policies where schemaname = 'public' and policyname = 'no direct client access'), 7,
          'every table has an explicit deny policy');

-- ---------- ending a session
select tests.call(tests.uid(100), format('select public.end_session(%L)', (select id from t_s)));
select is((select count(*)::int from public.session_players where session_id = (select id from t_s) and state <> 'IDLE'), 0, 'ending a session idles everyone');
select throws_ok(format('select tests.join(tests.uid(1), %L)', (select id from t_s)), 'session_ended', 'cannot join an ended session');
select ok((select count(*) from realtime.messages where event = 'session_changed' and topic = 'session:' || (select id from t_s)::text) > 0,
          'mutations broadcast session_changed');

select * from finish();
rollback;
