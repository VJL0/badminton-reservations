import { randomUUID } from "node:crypto";
import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import { e2eEnv } from "./env";

const env = e2eEnv();
export type Db = SupabaseClient<Database, "api">;

const options = { db: { schema: "api" as const }, auth: { autoRefreshToken: false, persistSession: false } };
export const PASSWORD = "E2e-Passw0rd-long1";

/** The secret key: creates logins and grants staff. Never a way around the database's own rules for anything else. */
export const privileged = (): Db => createClient<Database, "api">(env.url, env.secretKey, options);

async function signedIn(email: string, password: string): Promise<Db> {
  const db = createClient<Database, "api">(env.url, env.publishableKey, options);
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return db;
}

export type TestAdmin = { id: string; email: string; db: Db };

/** A fresh admin account, signed in. Removed with its staff row by `remove`. */
export async function createAdmin(): Promise<TestAdmin> {
  const email = `admin-${randomUUID()}@e2e.test`;
  const service = privileged();
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  const granted = await service.rpc("grant_staff", { p_user_id: data.user.id, p_role: "ADMIN" });
  if (granted.error) throw granted.error;
  const db = await signedIn(email, PASSWORD);
  // Like a real officer, they have given a name before they see a board.
  const named = await db.rpc("set_display_name", { p_name: "Officer" });
  if (named.error) throw new Error(named.error.message);
  return { id: data.user.id, email, db };
}

export const removeUser = (id: string) => privileged().auth.admin.deleteUser(id);

/** A player as the app makes one: an anonymous login with the publishable key, and a name. (No browser: for races.) */
export async function anonymousPlayer(name: string): Promise<{ id: string; db: Db }> {
  const db = createClient<Database, "api">(env.url, env.publishableKey, options);
  const { data, error } = await db.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error("no anonymous user");
  const named = await db.rpc("set_display_name", { p_name: name });
  if (named.error) throw new Error(named.error.message);
  return { id: data.user.id, db };
}

type SessionListRow = { id: string; status: string; code: string };

/** Refuses to run over a real session: end tonight's before running the tests. */
export async function requireNoLiveSession(admin: Db) {
  const { data } = await admin.rpc("list_sessions");
  const live = ((data ?? []) as SessionListRow[]).find((s) => s.status === "ACTIVE");
  if (live) throw new Error(`A session (${live.code}) is live. End it first: the tests need the one live slot.`);
}

export async function startSession(admin: Db, courts = 2) {
  const created = await admin.rpc("create_session", { p_name: "E2E open play", p_court_count: courts, p_game_duration_seconds: 600 });
  if (created.error) throw new Error(created.error.message);
  const { data: code } = await admin.rpc("get_active_session_code");
  return { id: created.data as string, code: code as string };
}

/** End and delete whatever the test started, live or not. */
export async function discardSession(admin: Db, id: string) {
  await admin.rpc("end_session", { p_session_id: id });
  await admin.rpc("delete_session", { p_session_id: id });
}

export type Phone = { context: BrowserContext; page: Page; name: string };

/** A new phone: its own cookies and storage, so its own anonymous login. */
export async function newPhone(browser: Browser, name: string): Promise<Phone> {
  const context = await browser.newContext();
  return { context, page: await context.newPage(), name };
}

/** Scan the QR (open the site), give a name, and wait until the board is live. */
export async function enter(phone: Phone) {
  await phone.page.goto("/");
  await phone.page.getByLabel("Your name").fill(phone.name);
  await phone.page.getByRole("button", { name: "Continue" }).click();
  await expect(phone.page.getByText("LIVE", { exact: true })).toBeVisible();
}

export const closeAll = (phones: Phone[]) => Promise.all(phones.map((p) => p.context.close()));
