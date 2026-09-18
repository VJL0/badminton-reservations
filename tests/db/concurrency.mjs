// Fires simultaneous join_queue / finish_round calls from separate connections
// and checks the invariants. Needs committed data, so it can't live in pgTAP.
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node tests/db/concurrency.mjs
import pg from "pg";
import assert from "node:assert/strict";

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
const code = "C" + Math.random().toString(36).slice(2, 7).toUpperCase();
let sessionId;
try {
  await pool.query("insert into auth.users (id) select unnest($1::uuid[]) on conflict do nothing", [users]);
  await pool.query("insert into public.staff (user_id, role) values ($1, 'ADMIN') on conflict do nothing", [ADMIN]);
  await Promise.all(Array.from({ length: PLAYERS }, (_, i) =>
    asUser(uid(i + 1), "select public.set_display_name($1)", [`P${i + 1}`])));
  await asUser(ADMIN, "select public.set_display_name('Admin')");
  sessionId = (await asUser(ADMIN, "select public.create_session('Concurrency', 3, 1200, $1) as id", [code])).rows[0].id;

  // 20 simultaneous joins
  await Promise.all(Array.from({ length: PLAYERS }, (_, i) =>
    asUser(uid(i + 1), "select public.join_queue($1)", [sessionId])));
  let counts = await one(`select count(*) filter (where state='PLAYING')::int playing, count(*) filter (where state='QUEUED')::int queued
                            from public.session_players where session_id=$1`, [sessionId]);
  assert.deepEqual(counts, { playing: 12, queued: 8 });
  const perCourt = (await pool.query(`select count(*)::int n from public.round_players rp join public.rounds r on r.id=rp.round_id
                                       where r.session_id=$1 and rp.left_at is null group by rp.round_id`, [sessionId])).rows;
  assert.deepEqual(perCourt.map((r) => r.n), [4, 4, 4]);
  assert.equal((await one(`select count(*)::int n from (select player_id from public.round_players where left_at is null
                            group by player_id having count(*)>1) x`)).n, 0);

  // 5 simultaneous "End Game" presses on the same court → one replacement round
  const round = await one(`select r.id from public.rounds r join public.courts c on c.id=r.court_id
                            where r.session_id=$1 and c.court_number=2 and r.status='ACTIVE'`, [sessionId]);
  await Promise.all(Array.from({ length: 5 }, () => asUser(ADMIN, "select public.finish_round($1)", [round.id])));
  const live = await one(`select count(*)::int n from public.rounds r join public.courts c on c.id=r.court_id
                           where r.session_id=$1 and c.court_number=2 and r.status='ACTIVE'`, [sessionId]);
  assert.equal(live.n, 1);
  counts = await one(`select count(*) filter (where state='PLAYING')::int playing, count(*) filter (where state='QUEUED')::int queued,
                             count(*) filter (where state='IDLE')::int idle from public.session_players where session_id=$1`, [sessionId]);
  assert.deepEqual(counts, { playing: 12, queued: 4, idle: 4 });

  console.log("concurrency invariants hold ✔");
} finally {
  // Leave the database as we found it: the session cascades, then the fake users.
  if (sessionId) await pool.query("delete from public.open_play_sessions where id = $1", [sessionId]);
  await pool.query("delete from public.staff where user_id = $1", [ADMIN]);
  await pool.query("delete from auth.users where id = any($1::uuid[])", [users]);
  await pool.end();
}
