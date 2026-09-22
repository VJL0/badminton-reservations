-- The staff-code auth (20260922000001) runs every staff action as `service_role`, but no migration ever
-- granted that role anything: it only worked locally because the local stack's default privileges give
-- service_role EXECUTE on every new function. Hosted projects don't, so in production every staff RPC
-- failed with "permission denied for function". Grant exactly what the app's admin client calls, and
-- revoke the rest so local and CI match production.

revoke execute on all functions in schema public from service_role;

grant execute on function
  -- callStaffOnlyRpc
  public.create_session(text, integer, integer, text, boolean),
  public.end_session(uuid),
  public.delete_session(uuid),
  public.update_session_settings(uuid, integer, boolean, boolean, integer, boolean),
  public.add_court(uuid, integer, integer),
  public.update_court(uuid, integer, integer),
  public.delete_court(uuid),
  public.remove_player(uuid, uuid),
  -- callStaffOrSelfRpc
  public.start_round(uuid),
  public.finish_round(uuid),
  public.pause_round(uuid),
  public.resume_round(uuid),
  -- staff pages and snapshot
  public.list_sessions(),
  public.get_session_summary(uuid),
  public.get_snapshot(text)
to service_role;

-- src/lib/push.ts reads subscriptions to send alerts and deletes the ones the push service reports gone.
grant select, delete on public.push_subscriptions to service_role;
