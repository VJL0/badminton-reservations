"use server";

import { z } from "zod";
import { pushConfigured, sendPush } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
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

/** "Send me a test": proves the whole path works on this phone. Only ever sent to the caller's own devices. */
export async function sendTestNotification(): Promise<ActionResult> {
  if (!pushConfigured()) return { ok: false, error: "Notifications aren't set up on this server." };
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return { ok: false, error: "Please enter your name first." };
  try {
    const { devices, sent } = await sendPush(data.user.id, {
      title: "Test notification",
      body: "You'll get alerts like this when it's your turn.",
      tag: "test",
      url: "/",
    });
    if (devices === 0) return { ok: false, error: "No device is subscribed yet. Turn notifications on first." };
    return sent > 0 ? { ok: true } : { ok: false, error: "Couldn't reach your device. Try turning notifications off and on again." };
  } catch (e) {
    console.error(`[push] test failed: ${(e as Error).message}`);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
