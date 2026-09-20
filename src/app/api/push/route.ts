import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { pushConfigured, pushPayloadSchema, sendPush } from "@/lib/push";

// Called by the database (pg_net) when a player should hear about a change. It is not a public
// endpoint: every request must carry the shared secret the database was given.
const bodySchema = pushPayloadSchema.extend({ player_id: z.uuid() });

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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const { player_id, ...payload } = parsed.data;

  try {
    const { devices, sent } = await sendPush(player_id, payload);
    return Response.json({ sent, failed: devices - sent });
  } catch (e) {
    console.error(`[push] ${(e as Error).message}`);
    return new Response(null, { status: 500 });
  }
}
