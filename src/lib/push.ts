import "server-only";
import { createHash } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import { createPrivilegedSupabaseClient, privilegedClientConfigured } from "@/lib/supabase/privileged";

// The delivery half of the push outbox. The database queues a message in the same transaction as the change that
// caused it (see 20260921000006_push_outbox.sql); this worker claims messages, sends them, then acknowledges.

/** What a device is shown. */
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

const subscriptionSchema = z.object({ endpoint: z.string(), p256dh: z.string(), auth: z.string() });
type Subscription = z.infer<typeof subscriptionSchema>;

const claimSchema = z.array(
  z.object({
    msg_id: z.number(),
    read_ct: z.number(),
    enqueued_at: z.string(),
    payload: pushPayloadSchema.extend({ key: z.string() }),
    subscriptions: z.array(subscriptionSchema),
  }),
);

/** A "you're up" that arrives two minutes late is worse than none: Web Push drops it after this, and so do we. */
const TTL_SECONDS = 120;
const GIVE_UP_AFTER_TRIES = 5;

/** Push needs the VAPID pair and the secret key (to reach the queue). Without them it is simply off. */
export function pushConfigured() {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && privilegedClientConfigured());
}

type Outcome = { sent: number; gone: string[]; failed: number };

/** Send one notification to each device. `key` becomes the Web Push topic, so a duplicate still waiting at the push service collapses into one. */
async function sendToDevices(subs: Subscription[], payload: PushPayload, key?: string): Promise<Outcome> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("Web Push is not configured");
  const options = {
    // Apple's push service rejects a VAPID subject that is an https://localhost URL: use a mailto:.
    vapidDetails: { subject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", publicKey, privateKey },
    TTL: TTL_SECONDS,
    urgency: "high" as const,
    ...(key ? { topic: createHash("sha256").update(key).digest("base64url").slice(0, 32) } : {}),
  };
  const out: Outcome = { sent: 0, gone: [], failed: 0 };
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          options,
        );
        out.sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) out.gone.push(s.endpoint);
        else {
          out.failed++;
          console.error(`[push] send failed: ${status ?? ""} ${(e as Error).message}`);
        }
      }
    }),
  );
  return out;
}

async function forget(endpoints: string[]) {
  const db = createPrivilegedSupabaseClient();
  await Promise.all(endpoints.map((endpoint) => db.rpc("push_forget_subscription", { p_endpoint: endpoint })));
}

/** "Send me a test": straight to the caller's own devices, outside the queue. */
export async function sendPush(playerId: string, payload: PushPayload) {
  const db = createPrivilegedSupabaseClient();
  const { data, error } = await db.rpc("push_subscriptions_of", { p_user_id: playerId });
  if (error) throw new Error(`push lookup failed: ${error.message}`);
  const subs = z.array(subscriptionSchema).parse(data);
  const out = await sendToDevices(subs, payload);
  await forget(out.gone);
  return { devices: subs.length, sent: out.sent };
}

/**
 * Claim a batch from the outbox, deliver it, acknowledge what is done. Anything that fails for now stays queued
 * and comes back after a short delay; after a few tries, or once it is too old to matter, it is archived instead.
 */
export async function drainPushQueue(limit = 20) {
  const db = createPrivilegedSupabaseClient();
  const { data, error } = await db.rpc("push_claim", { p_limit: limit, p_visibility_seconds: 30 });
  if (error) throw new Error(`push_claim failed: ${error.message}`);
  const messages = claimSchema.parse(data);

  const tally = { claimed: messages.length, delivered: 0, retried: 0, dropped: 0 };
  await Promise.all(
    messages.map(async (m) => {
      const { key, ...notification } = m.payload;
      const stale = Date.now() - Date.parse(m.enqueued_at) > TTL_SECONDS * 1000;
      const out = stale || m.subscriptions.length === 0 ? null : await sendToDevices(m.subscriptions, notification, key);
      if (out) await forget(out.gone);

      if (out && out.sent === 0 && out.failed > 0 && m.read_ct < GIVE_UP_AFTER_TRIES) {
        await db.rpc("push_retry", { p_msg_id: m.msg_id, p_delay_seconds: Math.min(5 * m.read_ct, 30) });
        tally.retried++;
        return;
      }
      await db.rpc("push_ack", { p_msg_id: m.msg_id });
      if (out && out.sent > 0) tally.delivered++;
      else tally.dropped++;
    }),
  );
  return tally;
}
