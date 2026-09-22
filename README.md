# Badminton Queue

Real-time open-play queue for a badminton club: players scan a QR code, enter a name, and join one
shared queue that feeds every court. Not a reservation system — a state machine.

- **PostgreSQL is the source of truth.** Every queue/court transition is a PL/pgSQL function
  (`supabase/migrations`). Each locks the session row first, so mutations are serialized.
- **Next.js (App Router)** renders the board; Server Actions are thin wrappers over those functions.
- **Supabase Realtime Broadcast** (private channel `session:<uuid>`) sends `session_changed`; clients
  refetch the snapshot. The message carries no state.
- **Timers derive from timestamps** (`ends_at`, `start_at`). A `pg_cron` job (every 30 s) ends overdue games; open boards report
  time-up instantly, and the database checks the clock.
- **UI:** shadcn/ui (Base UI, `maia` preset) + Tailwind v4, designed phone-first.

## How it works

- **One session at a time.** The poster's QR points at `/`, which sends players to whichever session is live. The database
  refuses a second live session (`already_active`); end tonight's before starting the next.
  When nothing is live, `/` waits and opens the queue by itself the moment a session starts; an ended board has a **Back to home** button.
- **One FIFO queue.** Joining always enqueues first; the allocator then places players. A player can pick a specific court
  (they only take that one) and can switch while queued without losing their place.
- **Courts have formats** (1v1, 2v2, 1v2 ... up to 4 a side) and staff can add, delete or reformat them during a session.
  Otherwise courts are packed: partially filled first, then fullest, then lowest number.
- **Games start** when the court is full: immediately, after a countdown, or when someone on the court (or staff) presses
  Start, per session setting. Two players are enough to start early.
- **Games end by themselves** when time is up (session setting, on by default) and the next players step on. Otherwise a player
  or staff presses **End game**. Double presses are a no-op.
- **Pause / Play** stops and restarts a running game's clock. Leaving a running game lets it carry on without you.
- Finished players go idle; `auto_requeue_on_finish` sends them back to the queue for the same court instead.
- **Staff** (one shared access code, no individual accounts) start/end sessions, change settings and courts, remove players and pause games.
- **Session summary** (`/admin/sessions/<id>`): waits, fairness flags, court use, per-player breakdowns, game history, CSV export.
  Every wait is recorded by a trigger (`queue_entries`); nothing calculated is stored.
- Abuse limits: queue capped per session (`max_queue_size`, default 100); 2 s join throttle.

## Run locally

```bash
pnpm install
pnpm supabase start            # needs Docker; applies supabase/migrations
cp .env.example .env.local     # URL + publishable key from `pnpm supabase status`
pnpm dev                       # use http://127.0.0.1:3000 (matches Supabase's local site URL)
```

### Staff access

Staff sign in at `/admin/login` with one shared code — no individual accounts, no email/password,
no roles. Everyone who has the code has the same permissions.

1. Pick a code.
2. `node scripts/hash-staff-code.mjs "<code>"` and put the output in `STAFF_ACCESS_CODE_HASH` (see
   `.env.example`). The plaintext code is never stored anywhere, including in this repo.
3. Set `STAFF_SESSION_SECRET` to a long random value (e.g. `openssl rand -hex 32`) — it signs the
   staff session cookie.
4. `SUPABASE_SECRET_KEY` is required too: staff-privileged actions run as the database's
   `service_role`, since there's no longer a Supabase-auth identity for the database to check.

Set all three in Vercel as well, **without** the `NEXT_PUBLIC_` prefix. Share the code with staff
directly (not through this repo); rotating it is just hashing a new one and redeploying.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm lint` | [Biome](https://biomejs.dev): formatting, lint rules (incl. React Compiler, accessibility, Next.js) and import order. CI runs `biome ci` |
| `pnpm lint:fix` / `pnpm format` | Apply Biome's safe fixes / just format |
| `pnpm typecheck` / `pnpm build` | TypeScript 7 type check and production build |
| `pnpm db:test` | pgTAP: allocator, timer, RLS/grants, abuse limits |
| `pnpm db:concurrency` | 20 simultaneous joins / 5 simultaneous end-game presses (cleans up after itself) |
| `pnpm db:advisors` | Supabase security + performance linter; fails on warnings |
| `pnpm db:lint` | `plpgsql_check` over every database function (unused variables, wrong volatility, bad SQL); fails on warnings |
| `pnpm db:types` | Regenerates `src/lib/supabase/database.types.ts` from the schema. Run after changing a migration; CI fails if it is stale |

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
| Auth → Sign In / Providers | **Anonymous sign-ins: on** (players only — staff sign-in doesn't use Supabase Auth at all). |
| Auth → Attack Protection | **CAPTCHA on**, provider Turnstile, paste the Turnstile **secret**. |
| Auth → Rate Limits | **Anonymous sign-ins per hour per IP → 300+.** Default 30; a gym shares one public IP. |
| Auth → URL Configuration | Site URL = your production domain. |
| Auth → JWT Keys | Use asymmetric signing keys (default on new projects) so `getClaims()` verifies locally. |
| Realtime → Settings | **Disable "Allow public access"** so only authorized private channels connect. |
| Database → Extensions | **Enable `pg_cron`** (the 30-second timer that ends games) and `pg_net` if you use push. |
| Database → Settings | Enforce SSL; network restrictions if you can. Enable PITR once data matters. |
| Account | MFA on your Supabase account. |

`supabase/config.toml` mirrors the auth values for local dev; `pnpm supabase config push` applies them.

Realtime quotas: Free = 200 connections and 100 messages/s; every state change is delivered to every
connected phone. A full night with 60+ phones is comfortable on Pro.

### 2. Cloudflare Turnstile

Create a widget for your production domain. The **site key** goes in Vercel; the **secret** goes in Supabase.

### 3. Vercel

Import the repo (`vercel.json` pins functions to `iad1`, next to Supabase `us-east-1`). Set:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>
```

These are inlined at build time: redeploy after changing them. The build fails with a clear message
if the first two are missing. Never expose the secret key.

### Optional: push notifications ("You're up next", "You're on court N")

Skipped by default; the app works without it, and the sound/vibration alert on the page still works.

1. `npx web-push generate-vapid-keys`. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   and a long random `PUSH_WEBHOOK_SECRET` in Vercel (`SUPABASE_SECRET_KEY` is already required — see Staff access above). Redeploy.
2. Tell the database where to call, in the Supabase SQL editor (same secret as above):
   ```sql
   select vault.create_secret('https://<your-domain>/api/push', 'push_url');
   select vault.create_secret('<PUSH_WEBHOOK_SECRET>', 'push_secret');
   ```
3. iPhones only allow web push for an app added to the Home Screen (iOS 16.4+): Share, then Add to Home Screen.

### 4. First smoke test

Set up staff access (see above), sign in at `/admin/login`, start a session, print the QR (it stays valid for every future session).
Then on two phones: enter a name, join, let the game run out (or press End game), rejoin.

### Housekeeping

Anonymous users are never cleaned up automatically. Run occasionally in the SQL editor:

```sql
delete from auth.users
where is_anonymous is true and created_at < now() - interval '30 days';
```

### Security notes

- All tables have RLS on with an explicit deny-all policy; clients only reach data through the
  functions in `supabase/migrations` (start with `…0002_queue_functions.sql`). New SQL functions get
  `EXECUTE` for `anon`/`authenticated` by default in Supabase: revoke and grant explicitly, as in
  `20260918000003_rls_grants.sql`.
- Anonymous (player) sign-in runs **in the browser**, not in Server Actions, so Supabase's per-IP
  rate limits count each person rather than Vercel's shared egress IP. Staff sign-in doesn't use
  Supabase Auth: the shared code is checked in a Server Action, throttled by a best-effort in-memory
  per-IP limiter (`src/lib/rate-limit.ts`) since there's no per-account rate limit to lean on.
- A strict nonce-based CSP is set per request in `src/proxy.ts` (`src/lib/csp.ts`); other security
  headers are in `next.config.ts`. Adding a new third-party origin means adding it to the CSP.
