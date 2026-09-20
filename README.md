# Badminton Queue

Real-time open-play queue for a badminton club: players scan a QR code, enter a name, and join one
shared queue that feeds every court. Not a reservation system — a state machine.

- **PostgreSQL is the source of truth.** Every queue/court transition is a PL/pgSQL function
  (`supabase/migrations`). Each locks the session row first, so mutations are serialized, and each ends by
  bumping the session's **revision** once.
- **Two schemas.** Tables and internal helpers live in a private `app` schema the Data API cannot reach; the only
  thing exposed is `api`, a set of RPC functions. A new function starts closed and is granted on purpose.
- **Next.js (App Router)** renders the board. Server Actions validate input (Zod) and call a small data access
  layer (`src/features/open-play/server`), which calls those functions and checks every JSON answer against a schema.
- **Supabase Realtime Broadcast** carries signals, never state. A private channel `session:<uuid>` says "revision N
  exists"; clients that have not seen N refetch the snapshot. A private `open-play:lobby` channel tells waiting
  phones the live session changed. PostgreSQL = truth, Realtime = wake-up, snapshot = reconstruction.
- **Timers derive from timestamps** (`ends_at`, `start_at`). A `pg_cron` job (every 30 s) ends overdue games; open boards report
  time-up instantly, and the database checks the clock. Courts that run out together are refilled and announced once.
- **Push notifications go through a durable outbox** (pgmq), written in the same transaction as the change that caused them.
- **UI:** shadcn/ui (Base UI, `maia` preset) + Tailwind v4, designed phone-first.

```text
QR (permanent)                                         a change
      │                                                    │
      ▼                                                    ▼
      /  ── live? ─ yes ─▶ /play/CODE          browser ▶ Server Action ▶ api.* RPC
      │                       │                                            │  lock session, check, change rows,
      no                      │                                            │  allocate, revision++, broadcast
      ▼                       ▼                                            ▼
 sign in (Turnstile)   get_snapshot() ◀── "revision N" ◀── Realtime ◀── COMMIT ──▶ pgmq push queue
 join open-play:lobby         ▲                                                          │
      │                       └─ refetch only if N is newer than what is on screen       ▼
 "live session changed" ─▶ ask the database ─▶ /play/CODE                     /api/push worker ▶ Web Push
```

## How it works

- **One session at a time.** The poster's QR points at `/`, which sends players to whichever session is live. The database
  refuses a second live session (`already_active`); end tonight's before starting the next. When nothing is live, `/`
  signs the phone in anonymously (behind Turnstile), joins the lobby channel and opens the queue the moment a session
  starts. There is no polling interval; a slow check runs only while Realtime is disconnected. An ended board has a **Back to home** button.
- **One FIFO queue.** Joining always enqueues first; the allocator then places players. A player can pick a specific court
  (they only take that one) and can switch while queued without losing their place.
- **Courts have formats** (1v1, 2v2, 1v2 ... up to 4 a side) and admins can add, delete or reformat them during a session.
  Otherwise courts are packed: partially filled first, then fullest, then lowest number.
- **Games start** when the court is full: immediately, after a countdown, or when someone on the court (or an officer) presses
  Start, per session setting. Two players are enough to start early.
- **Games end by themselves** when time is up (session setting, on by default) and the next players step on. Otherwise a player
  or officer presses **End game**. Double presses are a no-op.
- **Pause / Play** stops and restarts a running game's clock. Leaving a running game lets it carry on without you.
- Finished players go idle; `auto_requeue_on_finish` sends them back to the queue for the same court instead.
- **Officers** remove players and pause games; **admins** also start/end sessions, change settings and courts, and invite other admins.
- **People outlive their logins.** Everyone who joins a session becomes a *participant* of it (`session_participants`); waits,
  games and the summary hang off that, not off the anonymous Auth user. Deleting old anonymous users cannot erase history.
- **Session summary** (`/admin/sessions/<id>`): waits, fairness flags, court use, per-player breakdowns, game history, CSV export.
  Every wait is recorded by a trigger (`queue_entries`); nothing calculated is stored.
- **No offline queue.** A tap made without a connection fails at once with a message and is never replayed later, when the
  board may have moved on. (Next's experimental `useOffline` replay is off for that reason.)
- Abuse limits: queue capped per session (`max_queue_size`, default 100); 2 s join throttle.

## Run locally

```bash
pnpm install
pnpm supabase start            # needs Docker; applies supabase/migrations
cp .env.example .env.local     # URL + publishable key from `pnpm supabase status`
pnpm dev                       # use http://127.0.0.1:3000 (matches Supabase's local site URL and APP_URL)
```

### Officer accounts

Officers sign in at `/admin/login` with email + password. There is no in-app sign-up and no shared or default password.

1. **The first admin.** Create the user in the Supabase Dashboard (or local Studio, http://127.0.0.1:54323) → Authentication →
   Users → Add user, with **Auto Confirm User** ticked and a password you choose, then grant access in the SQL editor
   (`ADMIN` can create/end sessions; `OPERATOR` can only run games):

   ```sql
   insert into app.staff (user_id, role)
   select id, 'ADMIN' from auth.users where email = 'you@example.com';
   ```

2. **More admins** are invited from the **Admins** section of `/admin` (email only). Supabase emails a link to
   `/admin/onboarding`, where they choose their own password. A pending invitation can be re-sent from the same list.
   This needs `SUPABASE_SECRET_KEY` (see `.env.example`; set it in Vercel too, without a `NEXT_PUBLIC_` prefix) and a
   working SMTP provider.
3. **Forgot a password?** "Forgot your password?" on the sign-in page emails a reset link (behind Turnstile, like sign-in).

Not done here: TOTP multi-factor for admins. Supabase supports it (`auth.mfa.*`); turning it on also means enforcing the
`aal2` level inside the database's staff checks.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm lint` | [Biome](https://biomejs.dev): formatting, lint rules (incl. React Compiler, accessibility, Next.js) and import order; Prettier for Tailwind class order. CI runs `biome ci` |
| `pnpm lint:fix` / `pnpm format` | Apply Biome's and Prettier's safe fixes |
| `pnpm typecheck` / `pnpm build` | TypeScript 7 type check and production build |
| `pnpm db:test` | pgTAP: allocator, timer, revisions, batching, lobby, outbox, RLS/grants, abuse limits, and the **API contract** (the exact set of functions each role may execute) |
| `pnpm db:concurrency` | 20 simultaneous joins / 5 simultaneous end-game presses / 6 simultaneous time-up reports (cleans up after itself) |
| `pnpm db:advisors` | Supabase security + performance linter; fails on warnings |
| `pnpm db:lint` | `plpgsql_check` over every database function (unused variables, wrong volatility, bad SQL); fails on warnings |
| `pnpm db:types` | Regenerates `src/lib/supabase/database.types.ts` from the `api` schema. Run after changing a migration; CI fails if it is stale |
| `pnpm e2e` | [Playwright](https://playwright.dev): real browsers, one per player, against the production build and the local stack. Needs `pnpm supabase start` and refuses to run over a live session. First time: `pnpm exec playwright install chromium` |

CI (`.github/workflows/ci.yml`) runs all of these. Around it: CodeQL code scanning, a dependency review on every PR
(blocks new high-severity vulnerabilities), and a lint of the workflows themselves (zizmor + actionlint). Every action
is pinned to a full commit SHA and every job runs with read-only permissions.

## Deploying

### 1. Supabase (hosted project, `us-east-1`)

```bash
pnpm supabase login
pnpm supabase link --project-ref <ref>
pnpm supabase db push
```

Dashboard settings — these are not in the migrations:

| Where | Setting |
| --- | --- |
| Settings → API → **Exposed schemas** | **`api` only.** Remove `public` and `graphql_public`. The tables are in the private `app` schema and are unreachable through the API whatever their grants say |
| Auth → Sign In / Providers | **Anonymous sign-ins: on.** Email stays on (officer login). |
| Auth → Attack Protection | **CAPTCHA on**, provider Turnstile, paste the Turnstile **secret**. |
| Auth → Rate Limits | **Anonymous sign-ins per hour per IP → 300+.** Default 30; a gym shares one public IP. |
| Auth → Providers → Email | Confirm email **on**; minimum password length 10, require letters + digits. |
| Auth → SMTP | Your own SMTP provider (built-in mailer allows ~2 emails/hour): invitations and password resets are emails. |
| Auth → URL Configuration | Site URL = your production domain. Redirect URLs include `https://<your-domain>/admin/onboarding` |
| Auth → JWT Keys | Use asymmetric signing keys (default on new projects) so `getClaims()` verifies locally. |
| Realtime → Settings | **Disable "Allow public access"** so only authorized private channels connect. |
| Database → Extensions | **`pg_cron`** (the 30-second timers) and, if you use push, **`pg_net`** (wakes the worker). `pgmq` (the push queue) and Vault come from the migrations. |
| Database → Settings | Enforce SSL; network restrictions if you can. Enable PITR once data matters. |
| Account | MFA on your Supabase account. |

`supabase/config.toml` mirrors the auth and API values for local dev; `pnpm supabase config push` applies them.

Realtime quotas: Free = 200 connections and 100 messages/s; **every state change is delivered to every connected
phone**, and Supabase counts each delivery. That is why one logical change is one broadcast (three courts running out at
once cost one message per phone, not three). 60 phones × 1 change/s is 60 messages/s; a full night with 60+ phones is comfortable on Pro.

### Upgrading an existing project to this version

The database layout changed (private `app` schema, participants, revisions, push outbox), so the old app and the new
database do not talk to each other. Do it in one sitting, in this order:

1. `pnpm supabase db push` (the old app now errors until step 3).
2. Dashboard → Settings → API → Exposed schemas: `api` only.
3. Deploy the new app (set `APP_URL`, and `SUPABASE_SECRET_KEY` if you use invitations or push).
4. Admins whose password was never changed from the old shared default have had it invalidated (and their sessions ended):
   they choose a new one with "Forgot your password?".
5. If push is on, nothing to redo: the Vault secrets and `PUSH_WEBHOOK_SECRET` are read as before.

### 2. Cloudflare Turnstile

Create a widget for your production domain. The **site key** goes in Vercel; the **secret** goes in Supabase.

### 3. Vercel

Import the repo (`vercel.json` pins functions to `iad1`, next to Supabase `us-east-1`). Set:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>
APP_URL=https://<your-domain>
SUPABASE_SECRET_KEY=<secret key>          # invitations and the push worker; optional
```

The `NEXT_PUBLIC_*` values are inlined at build time: redeploy after changing them. The build fails with a clear message
if the first two are missing. `APP_URL` is the one canonical address (printed QR, emailed links); it is never read from
request headers. Never expose the secret key.

### Optional: push notifications ("You're up next", "You're on court N")

Skipped by default; the app works without it, and the sound/vibration alert on the page still works.

How it is delivered: when a change concerns a player, the same transaction writes a message to a durable queue (pgmq).
`pg_net` then wakes the worker (`POST /api/push`) and `pg_cron` wakes it again every 30 s while anything is still queued,
so a lost wake-up costs seconds, not the notification. The worker claims messages, sends them, and only then
acknowledges them; failures are retried (up to five times, and never after two minutes, when the news is stale). Each
message has a deterministic key (`court-assigned:<round>:<participant>`) used as the Web Push topic, so a duplicate collapses.

1. `npx web-push generate-vapid-keys`. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   and a long random `PUSH_WEBHOOK_SECRET` in Vercel (plus `SUPABASE_SECRET_KEY`). Redeploy.
2. Tell the database where to call, in the Supabase SQL editor (same secret as above):
   ```sql
   select vault.create_secret('https://<your-domain>/api/push', 'push_url');
   select vault.create_secret('<PUSH_WEBHOOK_SECRET>', 'push_secret');
   ```
3. iPhones only allow web push for an app added to the Home Screen (iOS 16.4+): Share, then Add to Home Screen.

The service worker (`public/sw.js`) only shows notifications and never caches board data. `next.config.ts` serves it
with its own headers: never cached, `application/javascript`, and a CSP that allows nothing but its own origin.

### 4. First officer, then smoke test

Create the officer (see above), sign in at `/admin/login`, start a session, print the QR (it stays valid for every future session).
Then on two phones: enter a name, join, let the game run out (or press End game), rejoin.

### Observability

Before deciding the database "isn't scaling", look:

- **`/admin/health`** (admins): the push queue and its oldest message (worry above 30 s), whether the 30-second timers
  ran and how often they failed, the number of anonymous logins, and `get_snapshot`'s average and worst timing.
- **Postgres logs**: a session whose row lock was held for over 100 ms leaves a `session_lock_wait` line.
- **Supabase Dashboard**: Reports → Realtime (connections, delivered messages, reconnects), Reports → Database, and Database →
  Query Performance (`pg_stat_statements`). Cron history is `cron.job_run_details`.
- **Vercel logs**: the server logs one structured JSON line for every failing or slow (≥ 250 ms) database call
  (`event: "rpc_failed"` / `"slow_rpc"`), and one per unhandled error (`digest` on the error page).

Do not optimize `get_snapshot` before those numbers say so. If it ever matters, the next step is a shared board projection
per revision plus a small per-player part, not new infrastructure.

### Housekeeping

Anonymous users are never cleaned up automatically. Because history hangs off participants, not logins, clearing old ones
is safe: the sessions, games and waits stay, the participants just lose their link to the deleted login. Run occasionally
in the SQL editor:

```sql
delete from auth.users
where is_anonymous is true and created_at < now() - interval '30 days';
```

or schedule it (this is not switched on for you):

```sql
select cron.schedule('purge-anonymous-users', '17 4 * * *',
  $$delete from auth.users where is_anonymous is true and created_at < now() - interval '30 days'$$);
```

### Security notes

- **Two schemas.** Tables live in `app`, which no client role can even see. Clients reach data only through the functions in
  `api`. All tables also have RLS on with an explicit deny-all policy (belt and braces).
- **Functions start closed.** A migration sets `alter default privileges for role postgres revoke execute on functions from public`
  (per-schema revokes do not undo the built-in PUBLIC default), so a new function is executable by nobody until it is granted.
  `supabase/tests/database/api_contract.test.sql` lists exactly which functions `authenticated`, `anon` and `service_role`
  may execute; adding one is a visible edit of that list in review.
- **Roles are checked twice**: in the app (`requireStaff` / `requireAdmin`, which ask `api.current_staff_role()`) and again inside every
  staff-only database function.
- **The secret key never touches a table.** It only calls the few `api` functions granted to `service_role` (grant staff,
  claim/ack push messages). Its client is `createPrivilegedSupabaseClient()`; the browser only ever has the publishable key.
- Anonymous sign-in and officer sign-in run **in the browser**, not in Server Actions, so Supabase's
  per-IP rate limits count each person rather than Vercel's shared egress IP.
- A strict nonce-based CSP is set per request in `src/proxy.ts` (`src/lib/csp.ts`); other security
  headers are in `next.config.ts`. Adding a new third-party origin means adding it to the CSP.
