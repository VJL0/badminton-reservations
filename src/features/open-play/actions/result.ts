/** What a Server Action hands back to the browser: it worked, or here is a sentence to show. */
export type ActionResult = { ok: true } | { ok: false; error: string };
