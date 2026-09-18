-- Open-play queue: schema. PostgreSQL is the single source of truth.

create type public.session_status as enum ('ACTIVE', 'ENDED');
create type public.court_status   as enum ('OPEN', 'PAUSED');
create type public.player_state   as enum ('IDLE', 'QUEUED', 'PLAYING');
create type public.round_status   as enum ('FILLING', 'ACTIVE', 'COMPLETED', 'CANCELLED');
create type public.staff_role     as enum ('ADMIN', 'OPERATOR');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  created_at   timestamptz not null default now()
);

create table public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       public.staff_role not null,
  created_at timestamptz not null default now()
);

create table public.open_play_sessions (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  name                   text not null check (char_length(btrim(name)) between 1 and 80),
  status                 public.session_status not null default 'ACTIVE',
  game_duration_seconds  integer not null default 1200 check (game_duration_seconds > 0),
  auto_requeue_on_finish boolean not null default false,
  created_at             timestamptz not null default now(),
  started_at             timestamptz not null default now(),
  ended_at               timestamptz
);

create table public.courts (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.open_play_sessions (id) on delete cascade,
  court_number integer not null check (court_number > 0),
  status       public.court_status not null default 'OPEN',
  unique (session_id, court_number)
);

create table public.rounds (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.open_play_sessions (id) on delete cascade,
  court_id   uuid not null references public.courts (id) on delete cascade,
  status     public.round_status not null default 'FILLING',
  started_at timestamptz,
  ends_at    timestamptz,
  ended_at   timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'ACTIVE' or (started_at is not null and ends_at is not null))
);

-- A court has at most one live round.
create unique index one_open_round_per_court
  on public.rounds (court_id)
  where status in ('FILLING', 'ACTIVE');

create table public.session_players (
  session_id       uuid not null references public.open_play_sessions (id) on delete cascade,
  player_id        uuid not null references public.profiles (id) on delete cascade,
  state            public.player_state not null default 'IDLE',
  queued_at        timestamptz,
  current_round_id uuid references public.rounds (id) on delete set null,
  joined_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (session_id, player_id),
  check (state <> 'QUEUED' or queued_at is not null),
  check ((state = 'PLAYING') = (current_round_id is not null))
);

create index session_players_queue
  on public.session_players (session_id, queued_at, player_id)
  where state = 'QUEUED';

create table public.round_players (
  id        uuid primary key default gen_random_uuid(),
  round_id  uuid not null references public.rounds (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  slot      smallint not null check (slot between 1 and 4),
  joined_at timestamptz not null default now(),
  left_at   timestamptz
);

create unique index round_players_live_slot
  on public.round_players (round_id, slot) where left_at is null;
create unique index round_players_live_player
  on public.round_players (round_id, player_id) where left_at is null;
create index round_players_round on public.round_players (round_id);
