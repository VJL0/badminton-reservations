-- Private Broadcast channel per session ("session:<uuid>").
-- Clients may receive; only the database (realtime.send) may publish.

create policy "authenticated can receive session broadcasts"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'session:%'
  );
