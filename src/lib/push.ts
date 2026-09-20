import "server-only";
import webpush from "web-push";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export const pushPayloadSchema = z.object({
  title: z.string().max(120),
  body: z.string().max(240),
  tag: z.string().max(40).optional(),
  url: z
    .string()
    .regex(/^\/[A-Za-z0-9/_-]*$/)
    .max(80)
    .optional(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

/** Push needs the VAPID pair and the service-role key (to read subscriptions). Without them it is simply off. */
export function pushConfigured() {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Send one notification to every device the player has subscribed. Dead subscriptions are forgotten. */
export async function sendPush(playerId: string, payload: PushPayload) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("Web Push is not configured");
  const admin = createAdminClient();
  const { data: subs, error } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("player_id", playerId);
  if (error) throw new Error(`push lookup failed: ${error.message}`);

  const options = {
    // Apple's push service rejects a VAPID subject that is an https://localhost URL: use a mailto:.
    vapidDetails: {
      subject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
      publicKey,
      privateKey,
    },
    TTL: 120, // a "you're up" that arrives two minutes late is worse than none
    urgency: "high" as const,
  };
  const results = await Promise.allSettled(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          options,
        );
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        else console.error(`[push] send failed: ${status ?? ""} ${(e as Error).message}`);
        throw e;
      }
    }),
  );
  return {
    devices: results.length,
    sent: results.filter((r) => r.status === "fulfilled").length,
  };
}
