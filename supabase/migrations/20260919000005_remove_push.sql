-- Web Push was removed: no notifications are sent by the database any more.
-- (pg_net is left installed; other things may use it.)

create or replace function public._broadcast(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('session_id', p_session_id),
    'session_changed',
    'session:' || p_session_id::text,
    true
  );
end $$;

drop function public._notify(uuid);
drop function public.save_push_subscription(text, text, text);
drop function public.delete_push_subscription(text);
drop table public.push_subscriptions;
drop table public.push_config;

alter table public.session_players
  drop column notified_round_id,
  drop column notified_next;
