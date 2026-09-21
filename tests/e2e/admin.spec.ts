import { expect, test } from "@playwright/test";
import {
  APP_ORIGIN,
  anonymousPlayer,
  createAdmin,
  type Db,
  discardSession,
  googleLogin,
  newPhone,
  removeUser,
  requireNoLiveSession,
  signInBrowser,
  sql,
  startSession,
} from "./support";

test("two admins racing to start a session: exactly one wins", async () => {
  const [first, second] = await Promise.all([createAdmin(), createAdmin()]);
  try {
    await requireNoLiveSession(first.db);
    const results = await Promise.all(
      [first, second, first, second].map((a) =>
        a.db.rpc("create_session", { p_name: "Race", p_court_count: 2, p_game_duration_seconds: 600 }),
      ),
    );
    const won = results.filter((r) => !r.error);
    const lost = results.filter((r) => r.error);
    expect(won).toHaveLength(1);
    expect(lost.map((r) => r.error?.message)).toEqual(["already_active", "already_active", "already_active"]);
    await discardSession(first.db, won[0]?.data as string);
  } finally {
    await Promise.all([removeUser(first.id), removeUser(second.id)]);
  }
});

test("duplicate finishes and racing court edits leave a consistent board", async () => {
  const admin = await createAdmin();
  await requireNoLiveSession(admin.db);
  const { id, code } = await startSession(admin.db, 2);
  const players: { db: Db; id: string }[] = [];
  try {
    // Five anonymous players; four fill court 1 and its game starts.
    for (let i = 1; i <= 5; i++) {
      const player = await anonymousPlayer(`P${i}`);
      players.push(player);
      const joined = await player.db.rpc("join_queue", { p_session_id: id });
      if (joined.error) throw new Error(joined.error.message);
    }
    const snapshot = async () =>
      (await admin.db.rpc("get_snapshot", { p_code: code })).data as {
        courts: { id: string; court_number: number; round: { id: string; status: string } | null }[];
      };
    const running = (await snapshot()).courts.find((c) => c.round?.status === "ACTIVE")?.round;
    expect(running, "one game is running").toBeTruthy();

    // Five officers press End game together: the game ends once, everything after that is a no-op.
    const presses = await Promise.all(Array.from({ length: 5 }, () => admin.db.rpc("finish_round", { p_round_id: running?.id as string })));
    expect(
      presses.every((r) => !r.error),
      "duplicate presses are harmless",
    ).toBe(true);

    // Six court additions and a deletion at the same moment: every court keeps a distinct number.
    const edits = await Promise.all([
      ...Array.from({ length: 6 }, () => admin.db.rpc("add_court", { p_session_id: id, p_side_a: 2, p_side_b: 2 })),
      admin.db.rpc("delete_court", { p_court_id: (await snapshot()).courts[1]?.id as string }),
    ]);
    expect(edits.filter((r) => r.error).map((r) => r.error?.message)).toEqual([]);
    const numbers = (await snapshot()).courts.map((c) => c.court_number);
    expect(new Set(numbers).size, "no two courts share a number").toBe(numbers.length);
    expect(numbers).toHaveLength(7); // 2 + 6 added - 1 deleted
  } finally {
    await discardSession(admin.db, id);
    await Promise.all(players.map((p) => removeUser(p.id)));
    await removeUser(admin.id);
  }
});

test("staff sign-in is Continue with Google, nothing else", async ({ browser }) => {
  const phone = await newPhone(browser, "Staff");
  try {
    let authorize: URL | undefined;
    // Hold the browser at Supabase's authorize endpoint: what matters is the request it makes, not Google's page.
    await phone.page.route("**/auth/v1/authorize**", async (route) => {
      authorize = new URL(route.request().url());
      await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Google</title>" });
    });
    await phone.page.goto("/admin/login");
    await expect(phone.page.getByLabel("Password")).toHaveCount(0);
    await expect(phone.page.getByLabel("Email")).toHaveCount(0);
    await phone.page.getByRole("button", { name: "Continue with Google" }).click();
    await expect.poll(() => authorize?.searchParams.get("provider")).toBe("google");
    expect(authorize?.searchParams.get("code_challenge"), "PKCE").toBeTruthy();
    expect(authorize?.searchParams.get("code_challenge_method")).toBe("s256");
    expect(authorize?.searchParams.get("redirect_to")).toBe(`${APP_ORIGIN}/auth/callback?next=%2Fadmin`);
    expect(authorize?.searchParams.get("prompt")).toBe("select_account");
  } finally {
    await phone.context.close();
  }
});

test("a cancelled or invalid Google callback returns to sign-in with a message", async ({ browser }) => {
  const phone = await newPhone(browser, "Nobody");
  try {
    await phone.page.goto("/auth/callback?error=access_denied");
    await expect(phone.page).toHaveURL(/\/admin\/login\?error=cancelled$/);
    await expect(phone.page.getByText("Google sign-in was cancelled.")).toBeVisible();

    // A code nobody issued (or one replayed from another browser: there is no verifier cookie here) exchanges for nothing.
    await phone.page.goto("/auth/callback?code=not-a-real-code&next=https://evil.example");
    await expect(phone.page).toHaveURL(/\/admin\/login\?error=failed$/);
    await expect(phone.page.getByText("didn't complete")).toBeVisible();
  } finally {
    await phone.context.close();
  }
});

test("Google alone grants nothing; an authorized email is linked on first sign-in and can be removed", async ({ browser }) => {
  const admin = await createAdmin();
  const adminPhone = await newPhone(browser, "Admin");
  const staffPhone = await newPhone(browser, "Staff");
  // A Workspace address: access follows the staff list, not the domain.
  const email = `new-${crypto.randomUUID()}@temple.edu`;
  let staffId: string | undefined;
  try {
    await signInBrowser(adminPhone.context, admin);
    await adminPhone.page.goto("/admin");
    await adminPhone.page.getByLabel("Google account email").fill(email);
    await adminPhone.page.getByLabel("Role").selectOption("OPERATOR");
    await adminPhone.page.getByRole("button", { name: "Authorize" }).click();
    await expect(adminPhone.page.getByText(`${email} can now sign in with Google.`)).toBeVisible();
    const card = adminPhone.page.locator('[data-slot="card"]', { hasText: email });
    await expect(card.getByText("waiting for their first sign-in")).toBeVisible();

    // Their first Google sign-in: a verified identity for that email. The database links it to the authorization.
    const staff = await googleLogin(email);
    staffId = staff.id;
    await signInBrowser(staffPhone.context, staff);
    await staffPhone.page.goto("/admin");
    await expect(staffPhone.page.getByText("Officer console").first()).toBeVisible();
    await expect(staffPhone.page.getByText("Authorize someone")).toHaveCount(0); // an officer, not an admin
    expect((await staff.db.rpc("current_staff_role")).data).toBe("OPERATOR");
    expect((await staff.db.rpc("list_staff")).error?.message).toBe("not_staff"); // and the roster stays admin-only

    await adminPhone.page.reload();
    await expect(card.getByText("signed in with Google")).toBeVisible();

    // Removing them ends access on their very next request.
    await card.getByRole("button", { name: "Remove" }).click();
    await card.getByRole("button", { name: "Confirm remove" }).click();
    await expect(adminPhone.page.getByText(email)).toHaveCount(0);
    await staffPhone.page.goto("/admin");
    await expect(staffPhone.page.getByRole("heading", { name: "Not authorized" })).toBeVisible();
    expect((await staff.db.rpc("current_staff_role")).data).toBeNull();
  } finally {
    await Promise.all([adminPhone.context.close(), staffPhone.context.close()]);
    await sql("delete from app.staff_authorizations where email = $1", [email]);
    if (staffId) await removeUser(staffId);
    await removeUser(admin.id);
  }
});

test("a Google account nobody authorized gets no access", async ({ browser }) => {
  const stranger = await googleLogin(`stranger-${crypto.randomUUID()}@temple.edu`);
  const phone = await newPhone(browser, "Stranger");
  try {
    await signInBrowser(phone.context, stranger);
    await phone.page.goto("/admin");
    await expect(phone.page.getByRole("heading", { name: "Not authorized" })).toBeVisible();
    await expect(phone.page.getByText(stranger.email)).toBeVisible();
    expect((await stranger.db.rpc("list_sessions")).error?.message).toBe("not_staff");
    expect((await stranger.db.rpc("claim_staff_access")).data).toBeNull();
  } finally {
    await phone.context.close();
    await removeUser(stranger.id);
  }
});

test("system health is for admins only", async ({ browser }) => {
  const admin = await createAdmin();
  const phone = await newPhone(browser, "Admin");
  const player = await newPhone(browser, "Player");
  try {
    await signInBrowser(phone.context, admin);
    await phone.page.goto("/admin/health");
    await expect(phone.page.getByRole("heading", { name: "System health" })).toBeVisible();
    await expect(phone.page.getByText("Timer: finish-overdue-rounds")).toBeVisible();

    await player.page.goto("/admin/health"); // not signed in: sent to the sign-in page
    await expect(player.page).toHaveURL(/\/admin\/login/);
  } finally {
    await Promise.all([phone.context.close(), player.context.close()]);
    await removeUser(admin.id);
  }
});

test.afterAll(async () => {
  // Nothing should be left live for the next run.
  const admin = await createAdmin();
  try {
    await requireNoLiveSession(admin.db);
  } finally {
    await removeUser(admin.id);
  }
});
