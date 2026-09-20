begin;
select plan(157);

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
  select tests.call(p_uid, format('select api.join_queue(%L)', p_session)) $$;
create function tests.snapshot(p_uid uuid, p_code text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v := api.get_snapshot(p_code);
  perform set_config('role', 'postgres', true);
  return v;
end $$;
create function tests.uid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
-- History rows used to be keyed by the login; they are keyed by participant now. These views keep the login's id
-- readable as player_id, so assertions can say which *person* a row is about.
create view tests.sp as select x.*, (select p.auth_user_id from app.session_participants p where p.id = x.participant_id) as player_id from app.session_players x;
create view tests.rp as select x.*, (select p.auth_user_id from app.session_participants p where p.id = x.participant_id) as player_id from app.round_players x;
create view tests.qe as select x.*, (select p.auth_user_id from app.session_participants p where p.id = x.participant_id) as player_id from app.queue_entries x;
create function tests.pid(p_uid uuid, p_session uuid) returns uuid language sql as $$
  select id from app.session_participants where session_id = p_session and auth_user_id = p_uid $$;

-- Only one session may be live: the sections below each start their own, so close whatever is live first.
create function tests.end_live() returns void language sql as $$
  update app.open_play_sessions set status = 'ENDED', ended_at = now() where status = 'ACTIVE' $$;

-- 24 players (1..24), admin (100), operator (101)
insert into auth.users (id) select tests.uid(n) from generate_series(1, 24) n;
insert into auth.users (id) values (tests.uid(100)), (tests.uid(101));
insert into app.staff (user_id, role) values (tests.uid(100), 'ADMIN'), (tests.uid(101), 'OPERATOR');

select tests.call(tests.uid(n), format('select api.set_display_name(%L)', 'P' || n)) from generate_series(1, 24) n;
select tests.call(tests.uid(100), $$select api.set_display_name('Admin')$$);

-- ---------- RLS / grants
select throws_ok($$ select tests.call(tests.uid(1), 'select * from app.session_players') $$, '42501', null, 'players cannot read tables directly');
select throws_ok($$ select tests.call(tests.uid(1), 'select app._allocate(gen_random_uuid())') $$, '42501', null, 'internal allocator not callable');
select throws_ok($$ select tests.call(tests.uid(1), $q$select api.create_session('x')$q$) $$, 'not_staff', 'players cannot create sessions');
select throws_ok($$ select tests.call(tests.uid(101), $q$select api.create_session('x')$q$) $$, 'not_staff', 'operators cannot create sessions');

-- ---------- session setup
select tests.call(tests.uid(100), $$select api.create_session('Friday', 3, 1200, 'FRIDAY')$$);
create temp table t_s as select id from app.open_play_sessions where code = 'FRIDAY';
select is((select count(*)::int from app.courts where session_id = (select id from t_s)), 3, 'three courts created');

-- ---------- packing + timer only on 4th player
select tests.join(tests.uid(n), (select id from t_s)) from generate_series(1, 3) n;
select is((select c.court_number from app.rounds r join app.courts c on c.id = r.court_id
            where r.session_id = (select id from t_s) and r.status = 'FILLING'), 1,
          'first three players are packed onto court 1');
select is((select ends_at from app.rounds where status = 'FILLING' and session_id = (select id from t_s)), null,
          'no timer while filling');
select tests.join(tests.uid(4), (select id from t_s));
select ok((select ends_at - started_at = interval '20 minutes' from app.rounds
            where status = 'ACTIVE' and session_id = (select id from t_s)),
          '4th player starts a 20 minute timer');

-- ---------- 20 players total → 12 playing, 8 queued
select tests.join(tests.uid(n), (select id from t_s)) from generate_series(5, 20) n;
select is((select count(*)::int from tests.sp where session_id = (select id from t_s) and state = 'PLAYING'), 12, '12 playing');
select is((select count(*)::int from tests.sp where session_id = (select id from t_s) and state = 'QUEUED'), 8, '8 queued');
select is((select count(distinct c.court_number)::int from tests.rp rp
            join app.rounds r on r.id = rp.round_id join app.courts c on c.id = r.court_id
           where rp.left_at is null and r.session_id = (select id from t_s)), 3, 'all three courts used');
select is((select max(n)::int from (select count(*) n from tests.rp rp join app.rounds r on r.id = rp.round_id
            where rp.left_at is null and r.session_id = (select id from t_s) group by rp.round_id) x), 4,
          'never more than 4 per court');
select is((select count(*)::int from (select rp.player_id from tests.rp rp join app.rounds r on r.id = rp.round_id
            where rp.left_at is null and r.session_id = (select id from t_s)
            group by rp.player_id having count(*) > 1) x), 0, 'no duplicate assignment');

-- ---------- join is idempotent
select tests.join(tests.uid(1), (select id from t_s));
select is((select count(*)::int from tests.sp where session_id = (select id from t_s) and state = 'PLAYING'), 12, 'double join is a no-op');

-- ---------- finish_round promotes the queue in FIFO order
create temp table t_c2 as
  select r.id from app.rounds r join app.courts c on c.id = r.court_id
   where c.session_id = (select id from t_s) and c.court_number = 2 and r.status = 'ACTIVE';
select throws_ok(format('select tests.call(tests.uid(24), %L)', format('select api.finish_round(%L)', (select id from t_c2))),
  'not_allowed', 'outsider cannot end a game');
select tests.call(tests.uid(101), format('select api.finish_round(%L)', (select id from t_c2)));
select tests.call(tests.uid(101), format('select api.finish_round(%L)', (select id from t_c2)));  -- second press: no-op
select is((select count(*)::int from app.rounds r join app.courts c on c.id = r.court_id
            where c.court_number = 2 and c.session_id = (select id from t_s) and r.status = 'ACTIVE'), 1,
          'exactly one replacement round despite double end');
select is((select count(*)::int from tests.sp where session_id = (select id from t_s) and state = 'QUEUED'), 4, 'queue shrank by 4');
select is((select count(*)::int from tests.sp where session_id = (select id from t_s) and state = 'IDLE' and queued_at is null), 4,
          'finished players are IDLE (no auto requeue)');
select is((select array_agg(p.display_name order by rp.slot) from tests.rp rp
            join app.profiles p on p.id = rp.player_id
           where rp.left_at is null and rp.round_id = (select r.id from app.rounds r
              join app.courts c on c.id = r.court_id where c.court_number = 2
               and c.session_id = (select id from t_s) and r.status = 'ACTIVE')),
          array['P13','P14','P15','P16'], 'oldest four queued players took the court');

-- ---------- snapshot
select is((tests.snapshot(tests.uid(17), 'friday') -> 'me' ->> 'queue_position')::int, 1, 'queue #5 becomes #1');
select is(jsonb_array_length(tests.snapshot(tests.uid(17), 'FRIDAY') -> 'queue'), 4, 'snapshot queue length');

-- ---------- leave
select tests.call(tests.uid(17), format('select api.leave_queue(%L)', (select id from t_s)));
select is((select state::text from tests.sp where player_id = tests.uid(17)), 'IDLE', 'leaving the queue → IDLE');

-- ---------- deleting a court
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Delete', 2, 600, 'DELETE')$$);
create temp table t_p as select id from app.open_play_sessions where code = 'DELETE';
create temp table t_pc as select id, court_number from app.courts where session_id = (select id from t_p);
select throws_ok(format('select tests.call(tests.uid(1), %L)', format('select api.delete_court(%L)', (select id from t_pc where court_number = 1))),
  'not_staff', 'players cannot delete courts');
select tests.join(tests.uid(21), (select id from t_p));
select tests.call(tests.uid(100), format('select api.delete_court(%L)', (select id from t_pc where court_number = 1)));
select is((select c.court_number from tests.rp rp join app.rounds r on r.id = rp.round_id
            join app.courts c on c.id = r.court_id where rp.left_at is null and r.session_id = (select id from t_p)), 2,
          'deleting a filling court moves its players to another court');
select is(jsonb_array_length(tests.snapshot(tests.uid(21), 'DELETE') -> 'courts'), 1, 'a deleted court leaves the board');
select throws_ok(format('select tests.call(tests.uid(100), %L)', format('select api.delete_court(%L)', (select id from t_pc where court_number = 2))),
  'last_court', 'the last court cannot be deleted');
select tests.call(tests.uid(100), format('select api.add_court(%L)', (select id from t_p)));
select is((select max(court_number)::int from app.courts where session_id = (select id from t_p)), 3, 'new courts never reuse a deleted number');
select tests.join(tests.uid(n), (select id from t_p)) from generate_series(22, 24) n;
select throws_ok(format('select tests.call(tests.uid(100), %L)', format('select api.delete_court(%L)', (select id from t_pc where court_number = 2))),
  'game_in_progress', 'cannot delete a court with a game running');

-- ---------- constraints
select throws_ok($$ insert into app.rounds (session_id, court_id)
    select session_id, court_id from app.rounds where status = 'ACTIVE' limit 1 $$,
  '23505', null, 'DB refuses a second live round on a court');

-- ---------- abuse limits
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Cap', 1, 600, 'CAPS')$$);
create temp table t_k as select id from app.open_play_sessions where code = 'CAPS';
update app.open_play_sessions set max_queue_size = 1 where id = (select id from t_k);
select tests.join(tests.uid(n), (select id from t_k)) from generate_series(1, 5) n;
select is((select count(*)::int from tests.sp where session_id = (select id from t_k) and state = 'QUEUED'), 1,
          'one court full, one player waiting');
select throws_ok(format('select tests.join(tests.uid(6), %L)', (select id from t_k)), 'queue_full', 'a full queue refuses more players');
select tests.call(tests.uid(5), format('select api.leave_queue(%L)', (select id from t_k)));
select is((select state::text from tests.sp where player_id = tests.uid(5) and session_id = (select id from t_k)), 'IDLE',
          'a waiting player can leave');
select throws_ok(format('select tests.join(tests.uid(5), %L)', (select id from t_k)), 'too_fast', 'instant leave/join churn is throttled');
select is((select count(*)::int from pg_policies where schemaname = 'app' and policyname = 'no direct client access'), 10,
          'every table has an explicit deny policy');

-- ---------- choosing a court (queue for a specific court)
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Pick', 3, 600, 'PICK')$$);
create temp table t_pk as select id from app.open_play_sessions where code = 'PICK';
create temp table t_pkc as select id, court_number from app.courts where session_id = (select id from t_pk);
create function tests.pick(p_uid uuid, p_session uuid, p_court uuid) returns void language sql as $$
  select tests.call(p_uid, format('select api.join_queue(%L::uuid, %L::uuid)', p_session, p_court)) $$;
select tests.pick(tests.uid(1), (select id from t_pk), (select id from t_pkc where court_number = 3));
select is((select c.court_number from tests.rp rp join app.rounds r on r.id = rp.round_id
            join app.courts c on c.id = r.court_id where rp.player_id = tests.uid(1) and rp.left_at is null and r.session_id = (select id from t_pk)), 3,
          'a player can pick court 3 instead of the packed court 1');
select tests.pick(tests.uid(1), (select id from t_pk), (select id from t_pkc where court_number = 1));
select is((select count(*)::int from tests.rp rp join app.rounds r on r.id = rp.round_id
            where rp.player_id = tests.uid(1) and rp.left_at is null and r.session_id = (select id from t_pk)), 1,
          'picking again while placed is a no-op');
select tests.pick(tests.uid(n), (select id from t_pk), (select id from t_pkc where court_number = 3)) from generate_series(2, 4) n;
select ok((select ends_at - started_at = interval '10 minutes' from app.rounds r join app.courts c on c.id = r.court_id
            where c.court_number = 3 and c.session_id = (select id from t_pk) and r.status = 'ACTIVE'),
          'the 4th player on a picked court starts its timer');
select tests.call(tests.uid(5), $$select api.set_display_name('P5')$$);
select tests.pick(tests.uid(5), (select id from t_pk), (select id from t_pkc where court_number = 3));
select is((select state::text from tests.sp where player_id = tests.uid(5) and session_id = (select id from t_pk)), 'QUEUED',
          'a court that is in play makes the picker wait for it');
select is((select preferred_court_id from tests.sp where player_id = tests.uid(5) and session_id = (select id from t_pk)),
          (select id from t_pkc where court_number = 3), 'the wait is for that court');
-- a later player who does not care takes another court, the picker is skipped, not blocking
select tests.join(tests.uid(6), (select id from t_pk));
select is((select state::text from tests.sp where player_id = tests.uid(6) and session_id = (select id from t_pk)), 'PLAYING',
          'a player after the picker takes a free court');
select throws_ok(format('select tests.pick(tests.uid(7), %L, gen_random_uuid())', (select id from t_pk)),
  'court_not_found', 'unknown court');
-- finishing the game on court 3 seats the waiting picker on the same court
select tests.call(tests.uid(100), format('select api.finish_round(%L)', (select r.id from app.rounds r join app.courts c on c.id = r.court_id
   where c.court_number = 3 and c.session_id = (select id from t_pk) and r.status = 'ACTIVE')));
select is((select c.court_number from tests.rp rp join app.rounds r on r.id = rp.round_id
            join app.courts c on c.id = r.court_id where rp.player_id = tests.uid(5) and rp.left_at is null and r.session_id = (select id from t_pk)), 3,
          'the picker gets court 3 when it frees');

-- ---------- pausing freezes a running game
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Freeze', 1, 600, 'FREEZE')$$);
create temp table t_fz as select id from app.open_play_sessions where code = 'FREEZE';

select tests.join(tests.uid(n), (select id from t_fz)) from generate_series(1, 4) n;
update app.rounds set ends_at = now() + interval '5 minutes' where session_id = (select id from t_fz) and status = 'ACTIVE';
select tests.call(tests.uid(100), format('select api.pause_round(%L)', (select id from app.rounds where session_id = (select id from t_fz) and status = 'ACTIVE')));
select ok((select paused_at is not null from app.rounds where session_id = (select id from t_fz) and status = 'ACTIVE'),
          'pausing a game stops its clock');
select is((select status::text from app.rounds where session_id = (select id from t_fz) and ended_at is null), 'ACTIVE',
          'the paused game is still on court');
update app.rounds set paused_at = now() - interval '2 minutes', ends_at = now() + interval '5 minutes' where session_id = (select id from t_fz) and status = 'ACTIVE';
select tests.call(tests.uid(100), format('select api.resume_round(%L)', (select id from app.rounds where session_id = (select id from t_fz) and status = 'ACTIVE')));
select ok((select ends_at > now() + interval '6 minutes 50 seconds' and paused_at is null from app.rounds where session_id = (select id from t_fz) and status = 'ACTIVE'),
          'resuming hands back the paused time');

-- ---------- leaving a running game does not stop it
select tests.call(tests.uid(1), format('select api.leave_queue(%L)', (select id from t_fz)));
select is((select state::text from tests.sp where player_id = tests.uid(1) and session_id = (select id from t_fz)), 'IDLE',
          'a player can walk off a running court');
select is((select status::text from app.rounds where session_id = (select id from t_fz) and ended_at is null), 'ACTIVE', 'the game keeps going');
select is((select count(*)::int from tests.rp rp join app.rounds r on r.id = rp.round_id
            where r.session_id = (select id from t_fz) and r.status = 'ACTIVE' and rp.left_at is null), 3, 'with the remaining three');
select throws_ok(format('select tests.call(tests.uid(1), %L)', format('select api.finish_round(%L)', (select id from app.rounds where session_id = (select id from t_fz) and status = 'ACTIVE'))),
  'not_allowed', 'someone who left cannot end the game');
select tests.call(tests.uid(n), format('select api.leave_queue(%L)', (select id from t_fz))) from generate_series(2, 4) n;
select is((select count(*)::int from app.rounds where session_id = (select id from t_fz) and status = 'ACTIVE'), 0,
          'the game closes once the last player leaves');

-- ---------- auto re-queue lines players up for the same court
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Again', 2, 600, 'AGAIN', true)$$);
create temp table t_ag as select id from app.open_play_sessions where code = 'AGAIN';
create temp table t_agc as select id, court_number from app.courts where session_id = (select id from t_ag);
select tests.pick(tests.uid(n), (select id from t_ag), (select id from t_agc where court_number = 2)) from generate_series(1, 4) n;
select tests.join(tests.uid(n), (select id from t_ag)) from generate_series(5, 8) n;  -- court 1
select tests.call(tests.uid(100), format('select api.finish_round(%L)', (select r.id from app.rounds r
   where r.court_id = (select id from t_agc where court_number = 2) and r.status = 'ACTIVE')));
select is((select c.court_number from tests.rp rp join app.rounds r on r.id = rp.round_id
            join app.courts c on c.id = r.court_id where rp.player_id = tests.uid(1) and rp.left_at is null and r.session_id = (select id from t_ag)), 2,
          'auto re-queue puts the four back on the same court');

-- ---------- court formats
select throws_ok(format('select tests.call(tests.uid(1), %L)', format('select api.add_court(%L)', (select id from t_ag))),
  'not_staff', 'players cannot add courts');
select tests.call(tests.uid(100), format('select api.add_court(%L, 1, 1)', (select id from t_ag)));
select is((select capacity::int from app.courts where session_id = (select id from t_ag) and court_number = 3), 2, 'a 1v1 court holds two');
select throws_ok(format('select tests.call(tests.uid(100), %L)', format('select api.add_court(%L, 0, 2)', (select id from t_ag))),
  'invalid_court_format', 'a side needs at least one player');
select tests.join(tests.uid(9), (select id from t_ag));
select tests.join(tests.uid(10), (select id from t_ag));
select ok((select ends_at is not null from app.rounds r join app.courts c on c.id = r.court_id
            where c.session_id = (select id from t_ag) and c.court_number = 3 and r.status = 'ACTIVE'),
          'a 1v1 game starts when two players are on it');
select throws_ok(format('select tests.call(tests.uid(100), %L)', format('select api.update_court(%L, 2, 2)', (select id from t_agc where court_number = 1))),
  'game_in_progress', 'cannot reformat a court mid-game');

-- ---------- manual start and countdown
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Manual', 1, 600, 'MANUAL')$$);
create temp table t_mn as select id from app.open_play_sessions where code = 'MANUAL';
select tests.call(tests.uid(100), format('select api.update_session_settings(%L, 600, false, false, 0, true)', (select id from t_mn)));
select tests.join(tests.uid(n), (select id from t_mn)) from generate_series(1, 4) n;
select is((select status::text from app.rounds where session_id = (select id from t_mn) and ended_at is null), 'FILLING',
          'with auto-start off a full court waits');
select throws_ok(format('select tests.call(tests.uid(20), %L)', format('select api.start_round(%L)', (select id from app.rounds where session_id = (select id from t_mn) and ended_at is null))),
  'not_allowed', 'an outsider cannot start a game');
select tests.call(tests.uid(1), format('select api.start_round(%L)', (select id from app.rounds where session_id = (select id from t_mn) and ended_at is null)));
select is((select status::text from app.rounds where session_id = (select id from t_mn) and ended_at is null), 'ACTIVE', 'a player on court starts it');
select tests.call(tests.uid(100), format('select api.finish_round(%L)', (select id from app.rounds where session_id = (select id from t_mn) and status = 'ACTIVE')));
select tests.call(tests.uid(100), format('select api.update_session_settings(%L, 600, false, true, 30, true)', (select id from t_mn)));
select tests.join(tests.uid(n), (select id from t_mn)) from generate_series(5, 8) n;
select ok((select start_at > now() + interval '25 seconds' and status = 'FILLING' from app.rounds where session_id = (select id from t_mn) and ended_at is null),
          'a full court counts down before it starts');
select throws_ok(format('select tests.call(tests.uid(20), %L)', format('select api.start_round(%L)', (select id from app.rounds where session_id = (select id from t_mn) and ended_at is null))),
  'not_allowed', 'nobody but the court can jump the countdown');
update app.rounds set start_at = now() - interval '1 second' where session_id = (select id from t_mn) and ended_at is null;
select tests.call(tests.uid(20), format('select api.start_round(%L)', (select id from app.rounds where session_id = (select id from t_mn) and ended_at is null)));
select is((select status::text from app.rounds where session_id = (select id from t_mn) and ended_at is null), 'ACTIVE', 'anyone may report the countdown finished');
select throws_ok(format('select tests.call(tests.uid(100), %L)', format('select api.update_session_settings(%L, 30, false, true, 0, true)', (select id from t_mn))),
  'invalid_duration', 'durations are bounded');
select throws_ok(format('select tests.call(tests.uid(101), %L)', format('select api.update_session_settings(%L, 600, false, true, 0, true)', (select id from t_mn))),
  'not_staff', 'only admins change settings');

-- ---------- reformatting a court that is still filling
select tests.call(tests.uid(100), format('select api.finish_round(%L)', (select id from app.rounds where session_id = (select id from t_mn) and status = 'ACTIVE')));
select tests.call(tests.uid(100), format('select api.update_session_settings(%L, 600, false, false, 0, true)', (select id from t_mn)));
select tests.join(tests.uid(n), (select id from t_mn)) from generate_series(11, 13) n;
create temp table t_mnc as select id from app.courts where session_id = (select id from t_mn);
select tests.call(tests.uid(100), format('select api.update_court(%L, 1, 1)', (select id from t_mnc)));
select is((select capacity::int from app.courts where id = (select id from t_mnc)), 2, 'a filling court can become 1v1');
select is((select state::text from tests.sp where player_id = tests.uid(13) and session_id = (select id from t_mn)), 'QUEUED',
          'the player who no longer fits goes back to the queue');
select tests.call(tests.uid(100), format('select api.update_court(%L, 2, 2)', (select id from t_mnc)));
select is((select state::text from tests.sp where player_id = tests.uid(13) and session_id = (select id from t_mn)), 'PLAYING',
          'growing the court seats the waiting player again');
select tests.call(tests.uid(100), format('select api.update_session_settings(%L, 600, false, true, 0, true)', (select id from t_mn)));
select tests.join(tests.uid(14), (select id from t_mn));
select is((select status::text from app.rounds where session_id = (select id from t_mn) and ended_at is null), 'ACTIVE',
          'with auto-start back on, the 4th arrival starts the game');

-- ---------- queue history is recorded by the database
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Track', 1, 600, 'TRACK')$$);
create temp table t_tr as select id from app.open_play_sessions where code = 'TRACK';
select tests.join(tests.uid(n), (select id from t_tr)) from generate_series(1, 4) n;
select is((select count(*)::int from tests.qe where session_id = (select id from t_tr) and outcome = 'ASSIGNED'), 4,
          'players seated at once still leave a wait record');
select tests.join(tests.uid(5), (select id from t_tr));
select tests.call(tests.uid(5), format('select api.leave_queue(%L)', (select id from t_tr)));
select is((select outcome::text from tests.qe where session_id = (select id from t_tr) and player_id = tests.uid(5)), 'LEFT',
          'leaving the queue is recorded as LEFT');
update tests.sp set updated_at = now() - interval '1 minute' where session_id = (select id from t_tr);
select tests.join(tests.uid(5), (select id from t_tr));
select tests.join(tests.uid(6), (select id from t_tr));
select tests.call(tests.uid(100), format('select api.remove_player(%L, %L)', (select id from t_tr), tests.pid(tests.uid(6), (select id from t_tr))));
select is((select outcome::text from tests.qe where session_id = (select id from t_tr) and player_id = tests.uid(6)), 'REMOVED',
          'an officer removing someone is recorded as REMOVED');
select tests.call(tests.uid(100), format('select api.finish_round(%L)', (select id from app.rounds where session_id = (select id from t_tr) and status = 'ACTIVE')));
select ok((select outcome = 'ASSIGNED' and round_id is not null from tests.qe
            where session_id = (select id from t_tr) and player_id = tests.uid(5) and outcome = 'ASSIGNED'),
          'getting a court is recorded with the game');
update tests.sp set updated_at = now() - interval '1 minute' where session_id = (select id from t_tr);
select tests.join(tests.uid(n), (select id from t_tr)) from generate_series(8, 10) n;  -- fill the court so the next player must wait
select tests.join(tests.uid(7), (select id from t_tr));
select tests.call(tests.uid(100), format('select api.end_session(%L)', (select id from t_tr)));
select is((select outcome::text from tests.qe where session_id = (select id from t_tr) and player_id = tests.uid(7)), 'SESSION_ENDED',
          'still waiting when the session ends is recorded as SESSION_ENDED');
select is((select count(*)::int from tests.qe where session_id = (select id from t_tr) and ended_at is null), 0, 'no wait is left open after the session ends');

-- ---------- session summary numbers (hand-built timeline so every figure is checkable)
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Summary', 1, 1200, 'SUMM')$$);
create temp table t_su as select id from app.open_play_sessions where code = 'SUMM';
update app.open_play_sessions set started_at = '2026-01-01 20:00+00', ended_at = '2026-01-01 22:00+00', status = 'ENDED'
 where id = (select id from t_su);
update app.courts set created_at = '2026-01-01 20:00+00' where session_id = (select id from t_su);
insert into app.session_participants (session_id, auth_user_id, display_name, joined_at)
select (select id from t_su), tests.uid(n), 'P' || n, '2026-01-01 20:05+00' from generate_series(1, 7) n;
insert into app.session_players (participant_id, session_id, state, updated_at)
select p.id, p.session_id, 'IDLE',
       case when p.display_name = 'P7' then '2026-01-01 22:00+00'::timestamptz else '2026-01-01 20:50+00'::timestamptz end
  from app.session_participants p where p.session_id = (select id from t_su);
insert into app.rounds (id, session_id, court_id, status, started_at, ends_at, ended_at) values
  ('11111111-1111-4111-8111-111111111111', (select id from t_su), (select id from app.courts where session_id = (select id from t_su)), 'COMPLETED', '2026-01-01 20:10+00', '2026-01-01 20:30+00', '2026-01-01 20:30+00'),
  ('22222222-2222-4222-8222-222222222222', (select id from t_su), (select id from app.courts where session_id = (select id from t_su)), 'COMPLETED', '2026-01-01 20:30+00', '2026-01-01 20:50+00', '2026-01-01 20:50+00');
insert into app.round_players (round_id, participant_id, slot, joined_at, left_at)
select '11111111-1111-4111-8111-111111111111', tests.pid(tests.uid(n), (select id from t_su)), n, '2026-01-01 20:10+00', '2026-01-01 20:30+00' from generate_series(1, 4) n;
insert into app.round_players (round_id, participant_id, slot, joined_at, left_at) values
  ('22222222-2222-4222-8222-222222222222', tests.pid(tests.uid(5), (select id from t_su)), 1, '2026-01-01 20:30+00', '2026-01-01 20:50+00'),
  ('22222222-2222-4222-8222-222222222222', tests.pid(tests.uid(6), (select id from t_su)), 2, '2026-01-01 20:30+00', '2026-01-01 20:50+00'),
  ('22222222-2222-4222-8222-222222222222', tests.pid(tests.uid(1), (select id from t_su)), 3, '2026-01-01 20:30+00', '2026-01-01 20:50+00'),
  ('22222222-2222-4222-8222-222222222222', tests.pid(tests.uid(2), (select id from t_su)), 4, '2026-01-01 20:30+00', '2026-01-01 20:50+00');
insert into app.queue_entries (session_id, participant_id, queued_at, ended_at, outcome) values
  ((select id from t_su), tests.pid(tests.uid(1), (select id from t_su)), '2026-01-01 20:05+00', '2026-01-01 20:10+00', 'ASSIGNED'),
  ((select id from t_su), tests.pid(tests.uid(2), (select id from t_su)), '2026-01-01 20:05+00', '2026-01-01 20:10+00', 'ASSIGNED'),
  ((select id from t_su), tests.pid(tests.uid(3), (select id from t_su)), '2026-01-01 20:05+00', '2026-01-01 20:10+00', 'ASSIGNED'),
  ((select id from t_su), tests.pid(tests.uid(4), (select id from t_su)), '2026-01-01 20:05+00', '2026-01-01 20:10+00', 'ASSIGNED'),
  ((select id from t_su), tests.pid(tests.uid(5), (select id from t_su)), '2026-01-01 20:15+00', '2026-01-01 20:30+00', 'ASSIGNED'),
  ((select id from t_su), tests.pid(tests.uid(6), (select id from t_su)), '2026-01-01 20:20+00', '2026-01-01 20:30+00', 'ASSIGNED'),
  ((select id from t_su), tests.pid(tests.uid(7), (select id from t_su)), '2026-01-01 20:05+00', '2026-01-01 22:00+00', 'SESSION_ENDED');
create function tests.summary(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid(100), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  perform set_config('role', 'postgres', true);
  return v;
end $$;
create temp table t_sum as select tests.summary(format('select api.get_session_summary(%L)', (select id from t_su))) as j;
select throws_ok(format('select tests.call(tests.uid(1), %L)', format('select api.get_session_summary(%L)', (select id from t_su))),
  'not_staff', 'players cannot open a summary');
select is((select (j -> 'totals' ->> 'players')::int from t_sum), 7, 'summary counts every player who joined');
select is((select (j -> 'totals' ->> 'games')::int from t_sum), 2, 'summary counts started games');
select is((select (j -> 'totals' ->> 'median_wait_s')::int from t_sum), 300, 'median wait is the typical wait, not thrown off by one long one');
select is((select (j -> 'totals' ->> 'longest_wait_s')::int from t_sum), 6900, 'longest wait includes someone who never got a court');
select is((select (j -> 'totals' ->> 'peak_queue')::int from t_sum), 5, 'peak queue is the most people waiting at once');
select is((select (j -> 'totals' ->> 'no_games')::int from t_sum), 1, 'one player never played');
select is((select (p ->> 'playing_s')::int from t_sum, jsonb_array_elements(j -> 'players') p where p ->> 'name' = 'P1'), 2400,
          'playing time adds up across games');
select is((select (p ->> 'waiting_s')::int from t_sum, jsonb_array_elements(j -> 'players') p where p ->> 'name' = 'P5'), 900,
          'waiting time is the queue time before a court');
select is((select p -> 'flags' from t_sum, jsonb_array_elements(j -> 'players') p where p ->> 'name' = 'P7'), '["no_games", "long_wait"]'::jsonb,
          'a player who waited the whole night is flagged');
select is((select (j -> 'court_use' ->> 'busy_s')::int from t_sum), 2400, 'court busy time');
select is((select (j -> 'court_use' ->> 'window_s')::int from t_sum), 7200, 'court available time');
select is((select (j -> 'court_use' ->> 'idle_backed_s')::int from t_sum), 300, 'idle court time only counts while a full game was waiting');

-- ---------- push notifications (a transactional outbox: the queue write commits with the state change)
delete from vault.secrets where name in ('push_url', 'push_secret');  -- a dev database may already be configured; this rolls back
delete from pgmq.q_push;  -- so does an outbox with messages in it: start from an empty one (rolled back with everything else)
delete from pgmq.a_push;
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Push', 1, 600, 'PUSHIT')$$);
create temp table t_ps as select id from app.open_play_sessions where code = 'PUSHIT';
select throws_ok(format('select tests.call(tests.uid(1), %L)', $$select api.save_push_subscription('http://insecure.example/x', 'k', 'a')$$),
  'invalid_subscription', 'only https push endpoints are stored');
select tests.call(tests.uid(1), $$select api.save_push_subscription('https://push.example/one', 'k', 'a')$$);
select tests.call(tests.uid(2), $$select api.save_push_subscription('https://push.example/two', 'k', 'a')$$);
select is((select count(*)::int from app.push_subscriptions where endpoint like 'https://push.example/%'), 2, 'subscriptions are stored');
select tests.join(tests.uid(n), (select id from t_ps)) from generate_series(5, 8) n;
select is((select count(*)::int from pgmq.q_push), 0, 'nothing is queued until push is configured');
select vault.create_secret('http://localhost:3000/api/push', 'push_url'), vault.create_secret('s3cret', 'push_secret');
create temp table t_q0 as select count(*)::int n from pgmq.q_push;
create temp table t_h0 as select coalesce(max(id), 0) n from net.http_request_queue;
select tests.join(tests.uid(1), (select id from t_ps));
select is((select count(*)::int from pgmq.q_push) - (select n from t_q0), 0, 'you are not notified about your own action');
select tests.call(tests.uid(100), format('select api.finish_round(%L)', (select id from app.rounds where session_id = (select id from t_ps) and status = 'ACTIVE')));
select is((select count(*)::int from pgmq.q_push) - (select n from t_q0), 1, 'a player seated by someone else is queued for a push');
select ok((select bool_and(message ->> 'title' = 'You''re on court 1'
                           and message ->> 'key' like 'court-assigned:%'
                           and (message ->> 'auth_user_id')::uuid = tests.uid(1)
                           and message ->> 'url' = '/play/PUSHIT')
             from pgmq.q_push where msg_id = (select max(msg_id) from pgmq.q_push)),
          'the message says which court, for whom, and carries a deterministic key');
select ok((select count(*) = 1 and bool_and(headers ->> 'x-push-secret' = 's3cret')
             from net.http_request_queue where id > (select n from t_h0)),
          'the worker gets one wake-up call with the shared secret');
select tests.join(tests.uid(n), (select id from t_ps)) from generate_series(9, 11) n;  -- court now full and running
select tests.join(tests.uid(n), (select id from t_ps)) from generate_series(13, 16) n;  -- queue #1-#4
select tests.join(tests.uid(2), (select id from t_ps));                                 -- queue #5
select tests.call(tests.uid(13), format('select api.leave_queue(%L)', (select id from t_ps)));
select ok(exists (select 1 from pgmq.q_push
                   where message ->> 'title' = 'You''re up next' and (message ->> 'auth_user_id')::uuid = tests.uid(2)),
          'moving into the next four is queued for a push');
select is((select count(*)::int from (select message ->> 'key' k from pgmq.q_push group by 1 having count(*) > 1) d), 0,
          'no news is queued twice');

-- The transaction that changes the state also writes the message: undo one and the other disappears.
create temp table t_q1 as select count(*)::int n from pgmq.q_push;
select throws_ok(format('select tests.call(tests.uid(24), %L)', format('select api.finish_round(%L)', gen_random_uuid())), 'round_not_found', 'a failed command');
select is((select count(*)::int from pgmq.q_push), (select n from t_q1), 'a failed command queues nothing');

-- The worker's interface: claim, acknowledge, retry. Nobody but the service role may use it.
select throws_ok($$ select tests.call(tests.uid(100), 'select api.push_claim()') $$, '42501', null, 'not even an admin can claim messages');
create function tests.as_service(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'service_role', true);
  execute p_sql into v;
  perform set_config('role', 'postgres', true);
  return v;
end $$;
create function tests.service_do(p_sql text) returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  execute p_sql;
  perform set_config('role', 'postgres', true);
end $$;
create temp table t_claimed as select tests.as_service('select api.push_claim(2, 30)') as j;
select is(jsonb_array_length((select j from t_claimed)), 2, 'a worker claims up to the limit');
select is(jsonb_array_length((select j -> 0 -> 'subscriptions' from t_claimed)), 1, 'each message comes with the devices to send it to');
select is(jsonb_array_length(tests.as_service('select api.push_claim(50, 30)')), (select count(*)::int from pgmq.q_push) - 2,
          'claimed messages are hidden from other workers');
select tests.service_do(format('select api.push_ack(%s)', (select (j -> 0 ->> 'msg_id') from t_claimed)));
select is((select count(*)::int from pgmq.a_push), 1, 'an acknowledged message moves to the archive');

-- ---------- games end by themselves
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Auto end', 1, 600, 'AUTOFIN')$$);
create temp table t_af as select id from app.open_play_sessions where code = 'AUTOFIN';
select tests.join(tests.uid(n), (select id from t_af)) from generate_series(1, 8) n;   -- 4 playing, 4 waiting
select throws_ok(format('select tests.call(tests.uid(20), %L)', format('select api.finish_round(%L)', (select id from app.rounds where session_id = (select id from t_af) and status = 'ACTIVE'))),
  'not_allowed', 'a game that still has time left cannot be ended by an outsider');
update app.rounds set ends_at = now() - interval '1 second' where session_id = (select id from t_af) and status = 'ACTIVE';
select tests.call(tests.uid(20), format('select api.finish_round(%L)', (select id from app.rounds where session_id = (select id from t_af) and status = 'COMPLETED' or (session_id = (select id from t_af) and status = 'ACTIVE') order by created_at limit 1)));
select is((select count(*)::int from app.rounds where session_id = (select id from t_af) and status = 'COMPLETED'), 1,
          'anyone may report a game that is past its time');
select is((select count(*)::int from app.rounds where session_id = (select id from t_af) and status = 'ACTIVE'), 1,
          'the next game starts on its own');
select is((select state::text from tests.sp where player_id = tests.uid(5) and session_id = (select id from t_af)), 'PLAYING',
          'the waiting players stepped on');
-- the server-side timer
update app.rounds set ends_at = now() - interval '1 second', paused_at = now() - interval '1 minute' where session_id = (select id from t_af) and status = 'ACTIVE';
select is(app._finish_overdue_rounds(), 0, 'a paused game is not ended by the timer');
update app.rounds set paused_at = null where session_id = (select id from t_af) and status = 'ACTIVE';
select is(app._finish_overdue_rounds(), 1, 'the timer ends a game that is past its time');
select is((select count(*)::int from app.rounds where session_id = (select id from t_af) and status = 'ACTIVE'), 0, 'and nobody is left to start another');
-- turning it off
select tests.join(tests.uid(n), (select id from t_af)) from generate_series(9, 12) n;
select tests.call(tests.uid(100), format('select api.update_session_settings(%L, 600, false, true, 0, false)', (select id from t_af)));
update app.rounds set ends_at = now() - interval '1 second' where session_id = (select id from t_af) and status = 'ACTIVE';
select is(app._finish_overdue_rounds(), 0, 'with automatic ending off the timer leaves games alone');
select throws_ok(format('select tests.call(tests.uid(20), %L)', format('select api.finish_round(%L)', (select id from app.rounds where session_id = (select id from t_af) and status = 'ACTIVE'))),
  'not_allowed', 'and outsiders cannot end it');
select tests.call(tests.uid(100), format('select api.update_session_settings(%L, 600, false, true, 0, true)', (select id from t_af)));
select is((select count(*)::int from app.rounds where session_id = (select id from t_af) and status = 'ACTIVE'), 0,
          'turning it on ends games that are already past their time');

-- ---------- ending a session
select tests.call(tests.uid(100), format('select api.end_session(%L)', (select id from t_s)));
select is((select count(*)::int from tests.sp where session_id = (select id from t_s) and state <> 'IDLE'), 0, 'ending a session idles everyone');
select throws_ok(format('select tests.join(tests.uid(1), %L)', (select id from t_s)), 'session_ended', 'cannot join an ended session');
select ok((select count(*) from realtime.messages where event = 'session_changed' and topic = 'session:' || (select id from t_s)::text) > 0,
          'mutations broadcast session_changed');

-- ---------- deleting a session
create temp table t_del as select id from app.open_play_sessions where code = 'FRIDAY';
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Doomed', 1, 1200, 'DOOMED')$$);
create temp table t_doomed as select id from app.open_play_sessions where code = 'DOOMED';
select throws_ok(format('select tests.call(tests.uid(100), $q$select api.delete_session(%L)$q$)', (select id from t_doomed)), 'session_active', 'a live session cannot be deleted');
select tests.call(tests.uid(100), format('select api.end_session(%L)', (select id from t_doomed)));
select throws_ok(format('select tests.call(tests.uid(101), $q$select api.delete_session(%L)$q$)', (select id from t_doomed)), 'not_staff', 'operators cannot delete sessions');
select tests.call(tests.uid(100), format('select api.delete_session(%L)', (select id from t_doomed)));
select is((select count(*)::int from app.open_play_sessions where code = 'DOOMED'), 0, 'an ended session can be deleted');
select is((select count(*)::int from app.courts where session_id = (select id from t_doomed)), 0, 'its courts go with it');

-- ---------- one live session at a time
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Live', 1, 600, 'LIVE1')$$);
select throws_ok($$ select tests.call(tests.uid(100), $q$select api.create_session('Second', 1, 600, 'LIVE2')$q$) $$,
  'already_active', 'a second live session is refused');
select is((select count(*)::int from app.open_play_sessions where status = 'ACTIVE'), 1, 'only one session is live');
select is((select count(*)::int from app.open_play_sessions where code = 'LIVE2'), 0, 'the refused session leaves nothing behind');
select throws_ok($$ insert into app.open_play_sessions (code, name) values ('LIVE3', 'Direct') $$,
  '23505', null, 'the DB refuses a second live session even without create_session');
select is((select tests.snapshot(tests.uid(1), 'LIVE1') -> 'session' ->> 'code'), 'LIVE1', 'the live session is readable by players');
select tests.call(tests.uid(100), format('select api.end_session(%L)', (select id from app.open_play_sessions where code = 'LIVE1')));
select lives_ok($$ select tests.call(tests.uid(100), $q$select api.create_session('Next', 1, 600, 'LIVE2')$q$) $$,
  'a new session can start once the last one ends');
select throws_ok($$ select tests.call(tests.uid(100), $q$select api.create_session('Clash', 1, 600, 'LIVE1')$q$) $$,
  'already_active', 'a live session blocks creating another, whatever the code');
select tests.end_live();
select throws_ok($$ select tests.call(tests.uid(100), $q$select api.create_session('Clash', 1, 600, 'LIVE1')$q$) $$,
  '23505', null, 'a code already in use is not reported as a live session');

-- ---------- revisions: one logical change is one bump and one broadcast
create function tests.value(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  perform set_config('role', 'postgres', true);
  return v;
end $$;
create function tests.broadcasts(p_topic text) returns int language sql as $$
  select count(*)::int from realtime.messages where event = 'session_changed' and topic = p_topic $$;
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Rev', 3, 600, 'REVS')$$);
create temp table t_rv as select id from app.open_play_sessions where code = 'REVS';
select is((select revision from app.open_play_sessions where id = (select id from t_rv)), 0::bigint, 'a new session starts at revision 0');
create temp table t_m0 as select tests.broadcasts('session:' || (select id from t_rv)) as n;
select tests.join(tests.uid(1), (select id from t_rv));
select is((select revision from app.open_play_sessions where id = (select id from t_rv)), 1::bigint, 'a change bumps the revision once');
select is((tests.snapshot(tests.uid(1), 'REVS') ->> 'revision')::bigint, 1::bigint, 'the snapshot carries the revision');
select is(tests.broadcasts('session:' || (select id from t_rv)) - (select n from t_m0), 1, 'and broadcasts once');
select is((select payload ->> 'revision' from realtime.messages where topic = 'session:' || (select id from t_rv) order by inserted_at desc limit 1), '1',
          'the broadcast says which revision it is');
select tests.join(tests.uid(1), (select id from t_rv));
select is((select revision from app.open_play_sessions where id = (select id from t_rv)), 1::bigint, 'a repeated command changes nothing, so nothing is bumped');
select tests.call(tests.uid(1), $$select api.set_display_name('Renamed')$$);
select is((select display_name from app.session_participants where session_id = (select id from t_rv) and auth_user_id = tests.uid(1)), 'Renamed',
          'a new name reaches the live board');
select is((select revision from app.open_play_sessions where id = (select id from t_rv)), 2::bigint, 'and counts as a change');
select tests.call(tests.uid(1), $$select api.set_display_name('P1')$$);

-- three courts running out together are refilled and announced once, not three times
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Batch', 3, 600, 'BATCH')$$);
create temp table t_bt as select id from app.open_play_sessions where code = 'BATCH';
select tests.join(tests.uid(n), (select id from t_bt)) from generate_series(1, 16) n;  -- 12 playing, 4 waiting
create temp table t_b0 as select (select revision from app.open_play_sessions where id = (select id from t_bt)) as rev,
                                 tests.broadcasts('session:' || (select id from t_bt)) as n;
update app.rounds set ends_at = now() - interval '1 second' where session_id = (select id from t_bt) and status = 'ACTIVE';
select is(app._finish_overdue_rounds(), 3, 'all three games that ran out are ended');
select is((select revision from app.open_play_sessions where id = (select id from t_bt)) - (select rev from t_b0), 1::bigint, 'with one revision bump');
select is(tests.broadcasts('session:' || (select id from t_bt)) - (select n from t_b0), 1, 'and one broadcast');
select is((select count(*)::int from tests.sp where session_id = (select id from t_bt) and state = 'PLAYING'), 4, 'the waiting four stepped on');
-- one phone reporting time-up also ends the other courts that ran out
update tests.sp set updated_at = now() - interval '1 minute' where session_id = (select id from t_bt);  -- past the join throttle
select tests.join(tests.uid(n), (select id from t_bt)) from generate_series(1, 12) n;  -- three games running again, four waiting
update app.rounds set ends_at = now() - interval '1 second' where session_id = (select id from t_bt) and status = 'ACTIVE';
create temp table t_b1 as select tests.broadcasts('session:' || (select id from t_bt)) as n;
select tests.call(tests.uid(20), format('select api.finish_round(%L)', (select id from app.rounds where session_id = (select id from t_bt) and status = 'ACTIVE' limit 1)));
select is(tests.broadcasts('session:' || (select id from t_bt)) - (select n from t_b1), 1, 'a single report ends every game that ran out, in one broadcast');

-- ---------- the lobby hears when the live session changes
create temp table t_l0 as select count(*)::int n from realtime.messages where topic = 'open-play:lobby' and event = 'active_session_changed';
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Lobby', 1, 600, 'LOBBY')$$);
select is((select count(*)::int from realtime.messages where topic = 'open-play:lobby' and event = 'active_session_changed') - (select n from t_l0), 1,
          'starting a session tells the lobby');
select tests.call(tests.uid(100), format('select api.end_session(%L)', (select id from app.open_play_sessions where code = 'LOBBY')));
select is((select count(*)::int from realtime.messages where topic = 'open-play:lobby' and event = 'active_session_changed') - (select n from t_l0), 2,
          'and so does ending it');
select is((select payload - 'id' from realtime.messages where topic = 'open-play:lobby' order by inserted_at desc limit 1), '{}'::jsonb,
          'the lobby message carries no state');
select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages'), 1, 'one policy governs who may receive broadcasts');

-- ---------- who is who, and who may call what
select is(tests.value(tests.uid(100), 'select api.current_staff_role()'), 'ADMIN', 'an admin is told they are an admin');
select is(tests.value(tests.uid(101), 'select api.current_staff_role()'), 'OPERATOR', 'an operator is told they are an operator');
select is(tests.value(tests.uid(1), 'select api.current_staff_role()'), null, 'a player has no staff role');
create function tests.as_anon(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  execute p_sql into v;
  perform set_config('role', 'postgres', true);
  return v;
end $$;
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Anon', 1, 600, 'ANON1')$$);
select is(tests.as_anon('select api.get_active_session_code()'), 'ANON1', 'anyone may ask which session is live');
select throws_ok($$ select tests.as_anon('select api.get_snapshot(''ANON1'')') $$, '42501', null, 'but a snapshot needs a login');
select throws_ok($$ select tests.value(tests.uid(1), 'select api.ops_health()') $$, 'not_staff', 'players cannot read operational metrics');
select ok(tests.value(tests.uid(100), 'select api.ops_health()')::jsonb ? 'push', 'admins can');

-- ---------- history outlives the login
select tests.end_live();
select tests.call(tests.uid(100), $$select api.create_session('Keep', 1, 600, 'KEEP1')$$);
create temp table t_kp as select id from app.open_play_sessions where code = 'KEEP1';
select tests.join(tests.uid(n), (select id from t_kp)) from generate_series(1, 4) n;
select tests.call(tests.uid(100), format('select api.end_session(%L)', (select id from t_kp)));
delete from auth.users where id in (tests.uid(1), tests.uid(2));
select is((select count(*)::int from app.session_participants where session_id = (select id from t_kp) and auth_user_id is null), 2,
          'deleting a login keeps its participants');
select is((select count(*)::int from app.round_players rp join app.rounds r on r.id = rp.round_id where r.session_id = (select id from t_kp)), 4,
          'and their games');
select is((select count(*)::int from app.queue_entries where session_id = (select id from t_kp)), 4, 'and their waits');
select is(jsonb_array_length(tests.summary(format('select api.get_session_summary(%L)', (select id from t_kp))) -> 'players'), 4,
          'the summary still counts everyone who played');
select ok((select bool_or(p ->> 'name' = 'P1') from jsonb_array_elements(tests.summary(format('select api.get_session_summary(%L)', (select id from t_kp))) -> 'players') p),
          'and knows their names');

select * from finish();
rollback;
