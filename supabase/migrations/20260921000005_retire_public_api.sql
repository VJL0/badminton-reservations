-- The public.* functions are replaced by api.* (what clients call) and app.* (what they call internally).
-- Nothing else in `public` belongs to this app, so it is left empty and is no longer exposed to the Data API.

drop function public._allocate(uuid);
drop function public._broadcast(uuid);
drop function public._end_session(uuid);
drop function public._finish_overdue_rounds();
drop function public._finish_round(uuid);
drop function public._leave(uuid, uuid, boolean);
drop function public._lock_session(uuid);
drop function public._notify(uuid);
drop function public._release_from_filling(uuid, uuid, boolean);
drop function public._require_staff(boolean);
drop function public._require_user();
drop function public._staff_role();
drop function public._start_round(uuid);
drop function public._sync_round(uuid);
drop function public._track_queue();
drop function public.add_court(uuid, integer, integer);
drop function public.create_session(text, integer, integer, text, boolean);
drop function public.delete_court(uuid);
drop function public.delete_push_subscription(text);
drop function public.delete_session(uuid);
drop function public.end_session(uuid);
drop function public.finish_round(uuid);
drop function public.get_active_session_code();
drop function public.get_session_summary(uuid);
drop function public.get_snapshot(text);
drop function public.join_queue(uuid, uuid);
drop function public.leave_queue(uuid);
drop function public.list_sessions();
drop function public.list_staff();
drop function public.pause_round(uuid);
drop function public.remove_player(uuid, uuid);
drop function public.resume_round(uuid);
drop function public.save_push_subscription(text, text, text);
drop function public.set_display_name(text);
drop function public.start_round(uuid);
drop function public.update_court(uuid, integer, integer);
drop function public.update_session_settings(uuid, integer, boolean, boolean, integer, boolean);

-- Private Broadcast channels: one per session ("session:<uuid>") and one lobby ("open-play:lobby") that tells
-- waiting phones the live session changed. Clients may receive; only the database (realtime.send) may publish.
drop policy "authenticated can receive session broadcasts" on realtime.messages;
create policy "authenticated can receive session and lobby broadcasts"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and ((select realtime.topic()) like 'session:%' or (select realtime.topic()) = 'open-play:lobby')
  );

-- The 30-second server timer now runs the app.* function (scheduling under an existing name replaces the job).
do $$
begin
  perform cron.schedule('finish-overdue-rounds', '30 seconds', 'select app._finish_overdue_rounds()');
exception when others then
  raise notice 'pg_cron unavailable (%): overdue games will be ended by open boards instead', sqlerrm;
end $$;
