import { timingSafeEqual } from "node:crypto";
import { drainPushQueue, pushConfigured } from "@/lib/push";

// The push worker. The database calls this (pg_net, right after it queues a notification, and pg_cron every 30
// seconds for anything still waiting) to say "there is work"; the body is ignored. Not a public endpoint: every
// request must carry the shared secret the database was given. Delivering is idempotent, so a duplicate wake-up is harmless.

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
  if (!pushConfigured()) return new Response(null, { status: 503 });

  try {
    return Response.json(await drainPushQueue());
  } catch (e) {
    console.error(`[push] ${(e as Error).message}`);
    return new Response(null, { status: 500 });
  }
}
