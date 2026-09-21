import { randomUUID } from "node:crypto";
import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import type { Database } from "../../src/lib/supabase/database.types";
import { e2eEnv } from "./env";

const env = e2eEnv();
export type Db = SupabaseClient<Database, "api">;

const options = { db: { schema: "api" as const }, auth: { autoRefreshToken: false, persistSession: false } };
export const APP_ORIGIN = "http://127.0.0.1:3100";

/** The secret key: creates logins. Never a way around the database's own rules for anything else. */
export const privileged = (): Db => createClient<Database, "api">(env.url, env.secretKey, options);

/** Straight SQL as the database owner: what the README tells the first admin to run, and test cleanup. */
export async function sql(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: env.dbUrl });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

type BrowserCookie = {
  name: string;
  value: string;
  url: string;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  expires?: number;
};

export type TestLogin = { id: string; email: string; db: Db; cookies: BrowserCookie[] };
export type TestAdmin = TestLogin;

/**
 * A person as Google would leave them in Auth: a user with a Google identity whose email Google verified, signed
 * in. There is no password anywhere: the session comes from a one-time sign-in link the secret key can mint, and
 * the same session is written as the cookies the app's server client reads, so a browser can be signed in as them.
 * (Google itself cannot be driven from a test.)
 */
export async function googleLogin(email: string): Promise<TestLogin> {
  const { data, error } = await privileged().auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  const id = data.user.id;
  await sql(
    `insert into auth.identities (provider_id, user_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
     values ($1, $2, 'google', jsonb_build_object('sub', $1::text, 'email', $3::text, 'email_verified', true), now(), now(), now())`,
    [`g-${id}`, id, email],
  );

  const link = await privileged().auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const jar = new Map<string, BrowserCookie>();
  const db = createServerClient<Database, "api">(env.url, env.publishableKey, {
    db: { schema: "api" },
    cookies: {
      getAll: () => [...jar.values()].map(({ name, value }) => ({ name, value })),
      setAll(list) {
        for (const { name, value, options: o } of list) {
          jar.set(name, {
            name,
            value,
            url: APP_ORIGIN,
            httpOnly: o?.httpOnly,
            sameSite: "Lax",
            expires: o?.maxAge ? Math.floor(Date.now() / 1000) + o.maxAge : undefined,
          });
        }
      },
    },
  });
  const verified = await db.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  if (verified.error) throw verified.error;
  await db.auth.getSession(); // let the cookie writes settle
  return { id, email, db, cookies: [...jar.values()] };
}

/** Sign a browser in as this person. */
export const signInBrowser = (context: BrowserContext, login: TestLogin) => context.addCookies(login.cookies);

/**
 * A fresh admin, made the way the README bootstraps the first one: their email is authorized in SQL, and their
 * first Google sign-in (the claim below) turns that into a staff row.
 */
export async function createAdmin(role: "ADMIN" | "OPERATOR" = "ADMIN"): Promise<TestAdmin> {
  const email = `admin-${randomUUID()}@e2e.test`;
  await sql("insert into app.staff_authorizations (email, role) values ($1, $2)", [email, role]);
  try {
    const login = await googleLogin(email);
    const claimed = await login.db.rpc("claim_staff_access");
    if (claimed.error || claimed.data !== role)
      throw new Error(`first sign-in did not grant ${role}: ${claimed.error?.message ?? claimed.data}`);
    // Like a real officer, they have given a name before they see a board.
    const named = await login.db.rpc("set_display_name", { p_name: "Officer" });
    if (named.error) throw new Error(named.error.message);
    return login;
  } catch (e) {
    await sql("delete from app.staff_authorizations where email = $1", [email]); // do not leave a half-made admin behind
    throw e;
  }
}

/** Delete a login and, if it was staff, the authorization behind it. */
export async function removeUser(id: string) {
  await sql("delete from app.staff_authorizations where user_id = $1", [id]);
  await privileged().auth.admin.deleteUser(id);
}

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
