-- Two structural changes, made together because every function has to be re-declared for both:
--
--  1. Who played is no longer welded to a disposable login. A session_participants row belongs to one session and
--     survives its Auth user being deleted (auth_user_id goes null), so cleaning up anonymous accounts can no
--     longer erase the history a session summary is built from.
--  2. Tables and internal helpers move to a private `app` schema. Only `api` (the RPC surface) is exposed to the
--     Data API, so a new table or helper is unreachable from the internet until someone deliberately publishes it.
--
-- The functions come in the next migrations; until they land the old public.* functions do not match these tables.

create schema app;
create schema api;
revoke all on schema app from public, anon, authenticated, service_role;
grant usage on schema api to anon, authenticated, service_role;

-- From here on every function created by postgres starts closed: nobody may execute it until it is granted
-- explicitly. (Per-schema `alter default privileges ... revoke ... from public` does not undo the built-in PUBLIC
-- default, so this one is global. Supabase's own per-schema grants on `public` are revoked the same way.)
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, service_role;

------------------------------------------------------------------ move everything into `app`

alter type public.session_status set schema app;
alter type public.player_state   set schema app;
alter type public.round_status   set schema app;
alter type public.staff_role     set schema app;
alter type public.queue_outcome  set schema app;

alter table public.profiles           set schema app;
alter table public.staff              set schema app;
alter table public.open_play_sessions set schema app;
alter table public.courts             set schema app;
alter table public.rounds             set schema app;
alter table public.session_players    set schema app;
alter table public.round_players      set schema app;
alter table public.queue_entries      set schema app;
alter table public.push_subscriptions set schema app;

------------------------------------------------------------------ participants

-- One row per person per session. display_name is what the board showed; profiles keeps the login's current name.
create table app.session_participants (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references app.open_play_sessions (id) on delete cascade,
  auth_user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  joined_at    timestamptz not null default now(),
  unique (session_id, auth_user_id),
  unique (id, session_id)
);
create index session_participants_auth_user on app.session_participants (auth_user_id) where auth_user_id is not null;

alter table app.session_participants enable row level security;
revoke all on app.session_participants from anon, authenticated;
create policy "no direct client access" on app.session_participants
  for all to anon, authenticated using (false) with check (false);

-- Everyone who ever queued, played or was recorded in a session becomes a participant of it.
insert into app.session_participants (session_id, auth_user_id, display_name, joined_at)
select x.session_id, x.player_id, pr.display_name, min(x.at)
  from (
    select session_id, player_id, joined_at as at from app.session_players
    union all
    select r.session_id, rp.player_id, rp.joined_at from app.round_players rp join app.rounds r on r.id = rp.round_id
    union all
    select session_id, player_id, queued_at from app.queue_entries
  ) x
  join app.profiles pr on pr.id = x.player_id
 group by x.session_id, x.player_id, pr.display_name;

------------------------------------------------------------------ re-point the history at participants

alter table app.session_players add column participant_id uuid;
update app.session_players sp set participant_id = p.id
  from app.session_participants p where p.session_id = sp.session_id and p.auth_user_id = sp.player_id;

alter table app.round_players add column participant_id uuid;
update app.round_players rp set participant_id = p.id
  from app.rounds r, app.session_participants p
 where r.id = rp.round_id and p.session_id = r.session_id and p.auth_user_id = rp.player_id;

alter table app.queue_entries add column participant_id uuid;
update app.queue_entries e set participant_id = p.id
  from app.session_participants p where p.session_id = e.session_id and p.auth_user_id = e.player_id;

-- Dropping player_id takes its key, foreign key and indexes with it.
alter table app.session_players drop column player_id, drop column joined_at;
alter table app.round_players   drop column player_id;
alter table app.queue_entries   drop column player_id;

alter table app.session_players
  alter column participant_id set not null,
  add primary key (participant_id),
  add constraint session_players_participant_fk foreign key (participant_id, session_id)
    references app.session_participants (id, session_id) on delete cascade;
create index session_players_queue on app.session_players (session_id, queued_at, participant_id) where state = 'QUEUED';

alter table app.round_players
  alter column participant_id set not null,
  add constraint round_players_participant_fk foreign key (participant_id)
    references app.session_participants (id) on delete cascade;
create unique index round_players_live_participant on app.round_players (round_id, participant_id) where left_at is null;
create index round_players_participant on app.round_players (participant_id);

alter table app.queue_entries
  alter column participant_id set not null,
  add constraint queue_entries_participant_fk foreign key (participant_id)
    references app.session_participants (id) on delete cascade;
create index queue_entries_participant on app.queue_entries (participant_id);
create index queue_entries_session_participant on app.queue_entries (session_id, participant_id);

------------------------------------------------------------------ session revision

-- Every logical state change bumps it once (in the same transaction as the change). Snapshots carry it and so do
-- the broadcasts, which lets a client ignore a signal for something it has already seen.
alter table app.open_play_sessions add column revision bigint not null default 0;
