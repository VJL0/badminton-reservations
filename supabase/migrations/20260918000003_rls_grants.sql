-- Tables are never touched directly by clients: RLS on, no policies, no grants.
-- All reads and writes go through the SECURITY DEFINER functions above.

alter table public.profiles           enable row level security;
alter table public.staff              enable row level security;
alter table public.open_play_sessions enable row level security;
alter table public.courts             enable row level security;
alter table public.rounds             enable row level security;
alter table public.session_players    enable row level security;
alter table public.round_players      enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Functions default to EXECUTE for PUBLIC; close that, then grant explicitly.
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.get_snapshot(text),
  public.set_display_name(text),
  public.join_queue(uuid),
  public.leave_queue(uuid),
  public.finish_round(uuid),
  public.remove_player(uuid, uuid),
  public.pause_court(uuid),
  public.resume_court(uuid),
  public.create_session(text, integer, integer, text, boolean),
  public.end_session(uuid),
  public.list_sessions()
to authenticated;
-- Staff-only functions re-check public.staff internally.
