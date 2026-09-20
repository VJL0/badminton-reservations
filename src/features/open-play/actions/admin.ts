"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createSessionSchema, firstIssue, idSchema } from "../schemas";
import * as commands from "../server/commands";
import { invalid } from "../server/errors";
import type { FormState } from "./form-state";
import type { ActionResult } from "./result";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

export async function endSession(sessionId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  if (!id.success) return invalid;
  const res = await commands.endSession(id.data);
  refresh(); // the page updates in the same round trip
  return res;
}

export async function deleteSession(sessionId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  if (!id.success) return invalid;
  const res = await commands.deleteSession(id.data);
  refresh();
  return res;
}

/** The "New session" form: works before JavaScript loads, and keeps what was typed if something is wrong. */
export async function createSessionForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    courts: String(formData.get("courts") ?? ""),
    minutes: String(formData.get("minutes") ?? ""),
    autoRequeue: formData.get("autoRequeue") === "on",
  };
  const p = createSessionSchema.safeParse(values);
  if (!p.success) return { ok: false, error: firstIssue(p.error), values };
  const res = await commands.createSession(p.data);
  refresh();
  return res.ok ? { ok: true, message: "Session created." } : { ok: false, error: res.error, values };
}
