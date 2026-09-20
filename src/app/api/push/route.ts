import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

// Called by the database (pg_net) when a player should hear about a change. It is not a public
// endpoint: every request must carry the shared secret the database was given.
const bodySchema = z.object({
  player_id: z.uuid(),
  title: z.string().max(120),
  body: z.string().max(240),
  tag: z.string().max(40).optional(),
  url: z.string().regex(/^\/[A-Za-z0-9/_-]*$/).max(80).optional(),
});

function authorized(request: Request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  const given = request.headers.get("x-push-secret");
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401 });

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response(null, { status: 503 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const { player_id, ...payload } = parsed.data;

  const admin = createAdminClient();
  const { data: subs, error } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("player_id", player_id);
  if (error) {
    console.error(`[push] lookup failed: ${error.message}`);
    return new Response(null, { status: 500 });
  }

  const options = {
    vapidDetails: { subject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", publicKey, privateKey },
    TTL: 120, // a "you're up" that arrives two minutes late is worse than none
    urgency: "high" as const,
  };
  const results = await Promise.allSettled(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), options);
      } catch (e) {
        // 404/410: the phone unsubscribed or uninstalled. Forget it.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        else console.error(`[push] send failed: ${status ?? ""} ${(e as Error).message}`);
        throw e;
      }
    }),
  );
  return Response.json({ sent: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length });
}
