// Fires simultaneous join_queue / finish_round calls from separate connections
// and checks the invariants. Needs committed data, so it can't live in pgTAP.
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node tests/db/concurrency.mjs

import assert from "node:assert/strict";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PLAYERS = 20;
const uid = (n) => `00000000-0000-0000-0001-${String(n).padStart(12, "0")}`;
const ADMIN = uid(999);
const pool = new pg.Pool({ connectionString: url, max: PLAYERS + 5 });

async function asUser(id, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const r = await c.query(sql, params);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const one = async (sql, params) => (await pool.query(sql, params)).rows[0];

const users = [ADMIN, ...Array.from({ length: PLAYERS }, (_, i) => uid(i + 1))];
const code = `C${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
let sessionId;
try {
  await pool.query("insert into auth.users (id) select unnest($1::uuid[]) on conflict do nothing", [users]);
  await pool.query("insert into app.staff (user_id, role) values ($1, 'ADMIN') on conflict do nothing", [ADMIN]);
  await Promise.all(Array.from({ length: PLAYERS }, (_, i) => asUser(uid(i + 1), "select api.set_display_name($1)", [`P${i + 1}`])));
  await asUser(ADMIN, "select api.set_display_name('Admin')");
  assert.equal(
    (await one("select count(*)::int n from app.open_play_sessions where status = 'ACTIVE'")).n,
    0,
    "a session is live: end it first, only one can run at a time",
  );

  // 5 simultaneous "create session" calls -> exactly one wins, the rest are told a session is already live
  const created = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      asUser(ADMIN, "select api.create_session('Concurrency', 3, 1200, $1) as id", [i === 0 ? code : `${code}${i}`]),
    ),
  );
  const won = created.filter((r) => r.status === "fulfilled");
  assert.equal(won.length, 1);
  assert.ok(created.filter((r) => r.status === "rejected").every((r) => r.reason.message === "already_active"));
  sessionId = won[0].value.rows[0].id;

  // 20 simultaneous joins
  await Promise.all(Array.from({ length: PLAYERS }, (_, i) => asUser(uid(i + 1), "select api.join_queue($1)", [sessionId])));
  let counts = await one(
    `select count(*) filter (where state='PLAYING')::int playing, count(*) filter (where state='QUEUED')::int queued
                            from app.session_players where session_id=$1`,
    [sessionId],
  );
  assert.deepEqual(counts, { playing: 12, queued: 8 });
  const perCourt = (
    await pool.query(
      `select count(*)::int n from app.round_players rp join app.rounds r on r.id=rp.round_id
                                       where r.session_id=$1 and rp.left_at is null group by rp.round_id`,
      [sessionId],
    )
  ).rows;
  assert.deepEqual(
    perCourt.map((r) => r.n),
    [4, 4, 4],
  );
  assert.equal(
    (
      await one(`select count(*)::int n from (select participant_id from app.round_players where left_at is null
                            group by participant_id having count(*)>1) x`)
    ).n,
    0,
  );

  // 5 simultaneous "End Game" presses on the same court → one replacement round
  const round = await one(
    `select r.id from app.rounds r join app.courts c on c.id=r.court_id
                            where r.session_id=$1 and c.court_number=2 and r.status='ACTIVE'`,
    [sessionId],
  );
  await Promise.all(Array.from({ length: 5 }, () => asUser(ADMIN, "select api.finish_round($1)", [round.id])));
  const live = await one(
    `select count(*)::int n from app.rounds r join app.courts c on c.id=r.court_id
                           where r.session_id=$1 and c.court_number=2 and r.status='ACTIVE'`,
    [sessionId],
  );
  assert.equal(live.n, 1);
  counts = await one(
    `select count(*) filter (where state='PLAYING')::int playing, count(*) filter (where state='QUEUED')::int queued,
                             count(*) filter (where state='IDLE')::int idle from app.session_players where session_id=$1`,
    [sessionId],
  );
  assert.deepEqual(counts, { playing: 12, queued: 4, idle: 4 });

  // Three games run out together and six phones report it at once (each reporting one of the three games):
  // the first report ends all three and refills the courts; the rest find nothing left to do. One change, not three.
  await pool.query("update app.rounds set ends_at = now() - interval '1 second' where session_id = $1 and status = 'ACTIVE'", [sessionId]);
  const running = (await pool.query("select id from app.rounds where session_id = $1 and status = 'ACTIVE'", [sessionId])).rows;
  assert.equal(running.length, 3);
  const before = await one("select revision::int r from app.open_play_sessions where id = $1", [sessionId]);
  // Players 19 and 20 are not on court: anyone may report a game that is past its time.
  await Promise.all(
    Array.from({ length: 6 }, (_, i) => asUser(uid(19 + (i % 2)), "select api.finish_round($1)", [running[i % running.length].id])),
  );
  const after = await one("select revision::int r from app.open_play_sessions where id = $1", [sessionId]);
  assert.equal(after.r - before.r, 1, "simultaneous time-up reports collapse into one change");
  assert.equal(
    (await one("select count(*)::int n from app.rounds where session_id = $1 and status = 'ACTIVE' and ends_at < now()", [sessionId])).n,
    0,
    "no game is left past its time",
  );

  console.log("concurrency invariants hold ✔");
} finally {
  // Leave the database as we found it: the session cascades, then the fake users.
  if (sessionId) await pool.query("delete from app.open_play_sessions where id = $1", [sessionId]);
  await pool.query("delete from app.staff where user_id = $1", [ADMIN]);
  await pool.query("delete from auth.users where id = any($1::uuid[])", [users]);
  await pool.end();
}
