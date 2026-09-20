begin;
select plan(69);

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

-- ---------- choosing a court (queue for a specific court)
select tests.call(tests.uid(100), $$select public.create_session('Pick', 3, 600, 'PICK')$$);
create temp table t_pk as select id from public.open_play_sessions where code = 'PICK';
create temp table t_pkc as select id, court_number from public.courts where session_id = (select id from t_pk);
create function tests.pick(p_uid uuid, p_session uuid, p_court uuid) returns void language sql as $$
  select tests.call(p_uid, format('select public.join_queue(%L::uuid, %L::uuid)', p_session, p_court)) $$;
select tests.pick(tests.uid(1), (select id from t_pk), (select id from t_pkc where court_number = 3));
select is((select c.court_number from public.round_players rp join public.rounds r on r.id = rp.round_id
            join public.courts c on c.id = r.court_id where rp.player_id = tests.uid(1) and rp.left_at is null and r.session_id = (select id from t_pk)), 3,
          'a player can pick court 3 instead of the packed court 1');
select tests.pick(tests.uid(1), (select id from t_pk), (select id from t_pkc where court_number = 1));
select is((select count(*)::int from public.round_players rp join public.rounds r on r.id = rp.round_id
            where rp.player_id = tests.uid(1) and rp.left_at is null and r.session_id = (select id from t_pk)), 1,
          'picking again while placed is a no-op');
select tests.pick(tests.uid(n), (select id from t_pk), (select id from t_pkc where court_number = 3)) from generate_series(2, 4) n;
select ok((select ends_at - started_at = interval '10 minutes' from public.rounds r join public.courts c on c.id = r.court_id
            where c.court_number = 3 and c.session_id = (select id from t_pk) and r.status = 'ACTIVE'),
          'the 4th player on a picked court starts its timer');
select tests.call(tests.uid(5), $$select public.set_display_name('P5')$$);
select tests.pick(tests.uid(5), (select id from t_pk), (select id from t_pkc where court_number = 3));
select is((select state::text from public.session_players where player_id = tests.uid(5) and session_id = (select id from t_pk)), 'QUEUED',
          'a court that is in play makes the picker wait for it');
select is((select preferred_court_id from public.session_players where player_id = tests.uid(5) and session_id = (select id from t_pk)),
          (select id from t_pkc where court_number = 3), 'the wait is for that court');
-- a later player who does not care takes another court, the picker is skipped, not blocking
select tests.join(tests.uid(6), (select id from t_pk));
select is((select state::text from public.session_players where player_id = tests.uid(6) and session_id = (select id from t_pk)), 'PLAYING',
          'a player after the picker takes a free court');
select tests.call(tests.uid(100), format('select public.pause_court(%L)', (select id from t_pkc where court_number = 1)));
select throws_ok(format('select tests.pick(tests.uid(7), %L, %L)', (select id from t_pk), (select id from t_pkc where court_number = 1)),
  'court_paused', 'cannot pick a paused court');
select throws_ok(format('select tests.pick(tests.uid(7), %L, gen_random_uuid())', (select id from t_pk)),
  'court_not_found', 'unknown court');
-- finishing the game on court 3 seats the waiting picker on the same court
select tests.call(tests.uid(100), format('select public.finish_round(%L)', (select r.id from public.rounds r join public.courts c on c.id = r.court_id
   where c.court_number = 3 and c.session_id = (select id from t_pk) and r.status = 'ACTIVE')));
select is((select c.court_number from public.round_players rp join public.rounds r on r.id = rp.round_id
            join public.courts c on c.id = r.court_id where rp.player_id = tests.uid(5) and rp.left_at is null and r.session_id = (select id from t_pk)), 3,
          'the picker gets court 3 when it frees');

-- ---------- pausing freezes a running game
select tests.call(tests.uid(100), $$select public.create_session('Freeze', 1, 600, 'FREEZE')$$);
create temp table t_fz as select id from public.open_play_sessions where code = 'FREEZE';
create temp table t_fzc as select id from public.courts where session_id = (select id from t_fz);
select tests.join(tests.uid(n), (select id from t_fz)) from generate_series(1, 4) n;
update public.rounds set ends_at = now() + interval '5 minutes' where session_id = (select id from t_fz) and status = 'ACTIVE';
select tests.call(tests.uid(100), format('select public.pause_court(%L)', (select id from t_fzc)));
select ok((select paused_at is not null from public.rounds where session_id = (select id from t_fz) and status = 'ACTIVE'),
          'pausing a running game stops its clock');
select is((select status::text from public.rounds where session_id = (select id from t_fz) and court_id = (select id from t_fzc) and ended_at is null), 'ACTIVE',
          'the paused game is still on court');
update public.rounds set paused_at = now() - interval '2 minutes', ends_at = now() + interval '5 minutes' where session_id = (select id from t_fz) and status = 'ACTIVE';
select tests.call(tests.uid(100), format('select public.resume_court(%L)', (select id from t_fzc)));
select ok((select ends_at > now() + interval '6 minutes 50 seconds' and paused_at is null from public.rounds where session_id = (select id from t_fz) and status = 'ACTIVE'),
          'resuming hands back the paused time');

-- ---------- leaving a running game does not stop it
select tests.call(tests.uid(1), format('select public.leave_queue(%L)', (select id from t_fz)));
select is((select state::text from public.session_players where player_id = tests.uid(1) and session_id = (select id from t_fz)), 'IDLE',
          'a player can walk off a running court');
select is((select status::text from public.rounds where session_id = (select id from t_fz) and ended_at is null), 'ACTIVE', 'the game keeps going');
select is((select count(*)::int from public.round_players rp join public.rounds r on r.id = rp.round_id
            where r.session_id = (select id from t_fz) and r.status = 'ACTIVE' and rp.left_at is null), 3, 'with the remaining three');
select throws_ok(format('select tests.call(tests.uid(1), %L)', format('select public.finish_round(%L)', (select id from public.rounds where session_id = (select id from t_fz) and status = 'ACTIVE'))),
  'not_allowed', 'someone who left cannot end the game');
select tests.call(tests.uid(n), format('select public.leave_queue(%L)', (select id from t_fz))) from generate_series(2, 4) n;
select is((select count(*)::int from public.rounds where session_id = (select id from t_fz) and status = 'ACTIVE'), 0,
          'the game closes once the last player leaves');

-- ---------- auto re-queue lines players up for the same court
select tests.call(tests.uid(100), $$select public.create_session('Again', 2, 600, 'AGAIN', true)$$);
create temp table t_ag as select id from public.open_play_sessions where code = 'AGAIN';
create temp table t_agc as select id, court_number from public.courts where session_id = (select id from t_ag);
select tests.pick(tests.uid(n), (select id from t_ag), (select id from t_agc where court_number = 2)) from generate_series(1, 4) n;
select tests.join(tests.uid(n), (select id from t_ag)) from generate_series(5, 8) n;  -- court 1
select tests.call(tests.uid(100), format('select public.finish_round(%L)', (select r.id from public.rounds r
   where r.court_id = (select id from t_agc where court_number = 2) and r.status = 'ACTIVE')));
select is((select c.court_number from public.round_players rp join public.rounds r on r.id = rp.round_id
            join public.courts c on c.id = r.court_id where rp.player_id = tests.uid(1) and rp.left_at is null and r.session_id = (select id from t_ag)), 2,
          'auto re-queue puts the four back on the same court');

-- ---------- court formats
select throws_ok(format('select tests.call(tests.uid(1), %L)', format('select public.add_court(%L)', (select id from t_ag))),
  'not_staff', 'players cannot add courts');
select tests.call(tests.uid(100), format('select public.add_court(%L, 1, 1)', (select id from t_ag)));
select is((select capacity::int from public.courts where session_id = (select id from t_ag) and court_number = 3), 2, 'a 1v1 court holds two');
select throws_ok(format('select tests.call(tests.uid(100), %L)', format('select public.add_court(%L, 0, 2)', (select id from t_ag))),
  'invalid_court_format', 'a side needs at least one player');
select tests.join(tests.uid(9), (select id from t_ag));
select tests.join(tests.uid(10), (select id from t_ag));
select ok((select ends_at is not null from public.rounds r join public.courts c on c.id = r.court_id
            where c.session_id = (select id from t_ag) and c.court_number = 3 and r.status = 'ACTIVE'),
          'a 1v1 game starts when two players are on it');
select throws_ok(format('select tests.call(tests.uid(100), %L)', format('select public.update_court(%L, 2, 2)', (select id from t_agc where court_number = 1))),
  'game_in_progress', 'cannot reformat a court mid-game');

-- ---------- manual start and countdown
select tests.call(tests.uid(100), $$select public.create_session('Manual', 1, 600, 'MANUAL')$$);
create temp table t_mn as select id from public.open_play_sessions where code = 'MANUAL';
select tests.call(tests.uid(100), format('select public.update_session_settings(%L, 600, false, false, 0)', (select id from t_mn)));
select tests.join(tests.uid(n), (select id from t_mn)) from generate_series(1, 4) n;
select is((select status::text from public.rounds where session_id = (select id from t_mn) and ended_at is null), 'FILLING',
          'with auto-start off a full court waits');
select throws_ok(format('select tests.call(tests.uid(20), %L)', format('select public.start_round(%L)', (select id from public.rounds where session_id = (select id from t_mn) and ended_at is null))),
  'not_allowed', 'an outsider cannot start a game');
select tests.call(tests.uid(1), format('select public.start_round(%L)', (select id from public.rounds where session_id = (select id from t_mn) and ended_at is null)));
select is((select status::text from public.rounds where session_id = (select id from t_mn) and ended_at is null), 'ACTIVE', 'a player on court starts it');
select tests.call(tests.uid(100), format('select public.finish_round(%L)', (select id from public.rounds where session_id = (select id from t_mn) and status = 'ACTIVE')));
select tests.call(tests.uid(100), format('select public.update_session_settings(%L, 600, false, true, 30)', (select id from t_mn)));
select tests.join(tests.uid(n), (select id from t_mn)) from generate_series(5, 8) n;
select ok((select start_at > now() + interval '25 seconds' and status = 'FILLING' from public.rounds where session_id = (select id from t_mn) and ended_at is null),
          'a full court counts down before it starts');
select throws_ok(format('select tests.call(tests.uid(20), %L)', format('select public.start_round(%L)', (select id from public.rounds where session_id = (select id from t_mn) and ended_at is null))),
  'not_allowed', 'nobody but the court can jump the countdown');
update public.rounds set start_at = now() - interval '1 second' where session_id = (select id from t_mn) and ended_at is null;
select tests.call(tests.uid(20), format('select public.start_round(%L)', (select id from public.rounds where session_id = (select id from t_mn) and ended_at is null)));
select is((select status::text from public.rounds where session_id = (select id from t_mn) and ended_at is null), 'ACTIVE', 'anyone may report the countdown finished');
select throws_ok(format('select tests.call(tests.uid(100), %L)', format('select public.update_session_settings(%L, 30, false, true, 0)', (select id from t_mn))),
  'invalid_duration', 'durations are bounded');
select throws_ok(format('select tests.call(tests.uid(101), %L)', format('select public.update_session_settings(%L, 600, false, true, 0)', (select id from t_mn))),
  'not_staff', 'only admins change settings');

-- ---------- reformatting a court that is still filling
select tests.call(tests.uid(100), format('select public.finish_round(%L)', (select id from public.rounds where session_id = (select id from t_mn) and status = 'ACTIVE')));
select tests.call(tests.uid(100), format('select public.update_session_settings(%L, 600, false, false, 0)', (select id from t_mn)));
select tests.join(tests.uid(n), (select id from t_mn)) from generate_series(11, 13) n;
create temp table t_mnc as select id from public.courts where session_id = (select id from t_mn);
select tests.call(tests.uid(100), format('select public.update_court(%L, 1, 1)', (select id from t_mnc)));
select is((select capacity::int from public.courts where id = (select id from t_mnc)), 2, 'a filling court can become 1v1');
select is((select state::text from public.session_players where player_id = tests.uid(13) and session_id = (select id from t_mn)), 'QUEUED',
          'the player who no longer fits goes back to the queue');
select tests.call(tests.uid(100), format('select public.update_court(%L, 2, 2)', (select id from t_mnc)));
select is((select state::text from public.session_players where player_id = tests.uid(13) and session_id = (select id from t_mn)), 'PLAYING',
          'growing the court seats the waiting player again');
select tests.call(tests.uid(100), format('select public.update_session_settings(%L, 600, false, true, 0)', (select id from t_mn)));
select tests.join(tests.uid(14), (select id from t_mn));
select is((select status::text from public.rounds where session_id = (select id from t_mn) and ended_at is null), 'ACTIVE',
          'with auto-start back on, the 4th arrival starts the game');

-- ---------- ending a session
select tests.call(tests.uid(100), format('select public.end_session(%L)', (select id from t_s)));
select is((select count(*)::int from public.session_players where session_id = (select id from t_s) and state <> 'IDLE'), 0, 'ending a session idles everyone');
select throws_ok(format('select tests.join(tests.uid(1), %L)', (select id from t_s)), 'session_ended', 'cannot join an ended session');
select ok((select count(*) from realtime.messages where event = 'session_changed' and topic = 'session:' || (select id from t_s)::text) > 0,
          'mutations broadcast session_changed');

select * from finish();
rollback;
