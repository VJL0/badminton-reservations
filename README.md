# Badminton Queue

Real-time open-play queue for a badminton club: players scan a QR code, enter a name, and join one
shared queue that feeds every court. Not a reservation system — a state machine.

- **PostgreSQL is the source of truth.** Every queue/court transition is a PL/pgSQL function
  (`supabase/migrations`). Each locks the session row first, so mutations are serialized.
- **Next.js (App Router)** renders the board; Server Actions are thin wrappers over those functions.
- **Supabase Realtime Broadcast** (private channel `session:<uuid>`) sends `session_changed`; clients
  refetch the snapshot. The message carries no state.
- **Timers derive from `ends_at`.** Nothing ticks in the DB; "TIME'S UP" is `now >= ends_at`.
- **UI:** shadcn/ui (Base UI, `maia` preset) + Tailwind v4.

## Rules implemented

- One global FIFO queue. Joining always enqueues first; the allocator then places players.
- Courts are packed: partially filled first, then fullest, then lowest number.
- The 20-minute (configurable) timer starts when the 4th player arrives.
- Nothing moves at 00:00. A player on the court, or an officer, presses **End game**; that completes
  the round and refills the court from the queue in one transaction. Double presses are a no-op.
- Finished players go idle (`auto_requeue_on_finish` per session requeues them instead).
- Officers: end game, remove players, pause/resume courts, create/end sessions (admins only).
- Abuse limits: queue capped per session (`max_queue_size`, default 100); 2 s join throttle.

## Run locally

```bash
pnpm install
pnpm supabase start            # needs Docker; applies supabase/migrations
cp .env.example .env.local     # URL + publishable key from `pnpm supabase status`
pnpm dev                       # use http://127.0.0.1:3000 (matches Supabase's local site URL)
```

### Officer accounts

Officers sign in at `/admin/login` with email + password. There is no in-app sign-up.

1. Create the user: Supabase Dashboard (or local Studio, http://127.0.0.1:54323) → Authentication →
   Users → Add user, with **Auto Confirm User** ticked.
2. Grant access in the SQL editor (`ADMIN` can create/end sessions; `OPERATOR` can only run games):

```sql
insert into public.staff (user_id, role)
select id, 'ADMIN' from auth.users where email = 'you@example.com';
```

Once one admin exists, more can be added from the **Admins** section of `/admin` (email only; the
password starts as the shared default and the new admin is made to change it). This needs the
server-only `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`); set it in Vercel too, **without** the
`NEXT_PUBLIC_` prefix. Admins can also reset another admin's password to the default there.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Static checks and production build |
| `pnpm db:test` | pgTAP: allocator, timer, RLS/grants, abuse limits |
| `pnpm db:concurrency` | 20 simultaneous joins / 5 simultaneous End Game (cleans up after itself) |
| `pnpm db:advisors` | Supabase security + performance linter; fails on warnings |
| `pnpm db:lint` | `plpgsql_check` over every database function (unused variables, wrong volatility, bad SQL); fails on warnings |
| `pnpm db:types` | Regenerates `src/lib/supabase/database.types.ts` from the schema. Run after changing a migration; CI fails if it is stale |

CI (`.github/workflows/ci.yml`) runs all of these.

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
| Auth → Sign In / Providers | **Anonymous sign-ins: on.** Email stays on (officer login). |
| Auth → Attack Protection | **CAPTCHA on**, provider Turnstile, paste the Turnstile **secret**. |
| Auth → Rate Limits | **Anonymous sign-ins per hour per IP → 300+.** Default 30; a gym shares one public IP. |
| Auth → Providers → Email | Confirm email **on**; minimum password length 10, require letters + digits. |
| Auth → SMTP | Your own SMTP provider (built-in mailer allows ~2 emails/hour). |
| Auth → URL Configuration | Site URL = your production domain. |
| Auth → JWT Keys | Use asymmetric signing keys (default on new projects) so `getClaims()` verifies locally. |
| Realtime → Settings | **Disable "Allow public access"** so only authorized private channels connect. |
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
if the first two are missing. Never expose the service-role / secret key.

### Optional: push notifications ("You're up next", "You're on court N")

Skipped by default; the app works without it, and the sound/vibration alert on the page still works.

1. `npx web-push generate-vapid-keys`. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   and a long random `PUSH_WEBHOOK_SECRET` in Vercel (plus `SUPABASE_SERVICE_ROLE_KEY`, already needed for admins). Redeploy.
2. Tell the database where to call, in the Supabase SQL editor (same secret as above):
   ```sql
   select vault.create_secret('https://<your-domain>/api/push', 'push_url');
   select vault.create_secret('<PUSH_WEBHOOK_SECRET>', 'push_secret');
   ```
3. iPhones only allow web push for an app added to the Home Screen (iOS 16.4+): Share, then Add to Home Screen.

### 4. First officer, then smoke test

Create the officer (see above), sign in at `/admin/login`, create a session, print the QR.
Then on two phones: enter a name, join, End game, rejoin.

### Housekeeping

Anonymous users are never cleaned up automatically. Run occasionally in the SQL editor:

```sql
delete from auth.users
where is_anonymous is true and created_at < now() - interval '30 days';
```

### Security notes

- All tables have RLS on with an explicit deny-all policy; clients only reach data through the
  functions in `20260918000002_queue_functions.sql` / `…005_hardening.sql`. New SQL functions get
  `EXECUTE` for `anon`/`authenticated` by default in Supabase: revoke and grant explicitly, as in
  `20260918000003_rls_grants.sql`.
- Anonymous sign-in and officer sign-in run **in the browser**, not in Server Actions, so Supabase's
  per-IP rate limits count each person rather than Vercel's shared egress IP.
- A strict nonce-based CSP is set per request in `src/proxy.ts` (`src/lib/csp.ts`); other security
  headers are in `next.config.ts`. Adding a new third-party origin means adding it to the CSP.
