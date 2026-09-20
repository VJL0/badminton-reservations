import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Listen to one private Broadcast channel on the tab's shared Supabase client (so one WebSocket serves the lobby,
 * the session and everything else). A message is only a signal, never state: what to do about it is to ask the
 * database what is true now. Returns the function that stops listening.
 *
 * `onStatus` hears "SUBSCRIBED" and the ways a channel can fail; Realtime re-joins by itself, and each new
 * "SUBSCRIBED" is the moment to look again, since messages sent in the gap are gone.
 */
export function listen(topic: string, event: string, onMessage: (payload: unknown) => void, onStatus: (status: string) => void) {
  const supabase = getBrowserSupabase();
  let cancelled = false;
  const channel = supabase.channel(topic, { config: { private: true } });
  channel.on("broadcast", { event }, (message) => onMessage(message.payload));
  // A private channel is authorized with the login's JWT, so hand it over before joining.
  void supabase.realtime.setAuth().then(() => {
    if (!cancelled) channel.subscribe((status) => onStatus(status));
  });
  return () => {
    cancelled = true;
    void supabase.removeChannel(channel);
  };
}
