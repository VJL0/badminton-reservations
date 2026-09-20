"use server";

import { z } from "zod";
import { callRpc, type ActionResult } from "./rpc";

const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

export async function savePushSubscription(subscription: unknown): Promise<ActionResult> {
  const p = subscriptionSchema.safeParse(subscription);
  if (!p.success) return { ok: false, error: "This browser can't receive notifications." };
  return callRpc("save_push_subscription", { p_endpoint: p.data.endpoint, p_p256dh: p.data.keys.p256dh, p_auth: p.data.keys.auth });
}

export async function deletePushSubscription(endpoint: string): Promise<ActionResult> {
  const p = z.string().max(2048).safeParse(endpoint);
  return p.success ? callRpc("delete_push_subscription", { p_endpoint: p.data }) : { ok: false, error: "Invalid request." };
}
