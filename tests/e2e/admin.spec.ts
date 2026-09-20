import { expect, test } from "@playwright/test";
import {
  anonymousPlayer,
  createAdmin,
  type Db,
  discardSession,
  newPhone,
  PASSWORD,
  privileged,
  removeUser,
  requireNoLiveSession,
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

test("an invited officer chooses a password, then signs in with it", async ({ browser }) => {
  const service = privileged();
  const email = `invited-${crypto.randomUUID()}@e2e.test`;
  const origin = "http://127.0.0.1:3100";
  // The link Supabase would email: the same one, handed to us instead of a mailbox.
  const { data, error } = await service.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo: `${origin}/admin/onboarding` },
  });
  if (error || !data.user) throw error ?? new Error("no invite link");
  await service.rpc("grant_staff", { p_user_id: data.user.id, p_role: "ADMIN" });
  const phone = await newPhone(browser, "Invited");
  try {
    await phone.page.goto(data.properties.action_link);
    await expect(phone.page.getByRole("heading", { name: "Choose a password" })).toBeVisible();

    await phone.page.getByLabel("New password").fill("short");
    await phone.page.getByRole("button", { name: "Save password" }).click();
    await expect(phone.page.getByText("at least 10 characters", { exact: false }).first()).toBeVisible();

    await phone.page.getByLabel("New password").fill(PASSWORD);
    await phone.page.getByRole("button", { name: "Save password" }).click();
    await expect(phone.page).toHaveURL(/\/admin$/);
    await expect(phone.page.getByText("Officer console").first()).toBeVisible();

    // A brand-new browser signs in with the password they just chose.
    const again = await newPhone(browser, "Again");
    try {
      await again.page.goto("/admin/login");
      await again.page.getByLabel("Email").fill(email);
      await again.page.getByLabel("Password").fill(PASSWORD);
      await again.page.getByRole("button", { name: "Sign in" }).click();
      await expect(again.page).toHaveURL(/\/admin$/);
    } finally {
      await again.context.close();
    }
  } finally {
    await phone.context.close();
    await removeUser(data.user.id);
  }
});

test("an expired or reused link says so instead of failing silently", async ({ browser }) => {
  const phone = await newPhone(browser, "Nobody");
  try {
    await phone.page.goto("/admin/onboarding");
    await expect(phone.page.getByText("expired or was already used")).toBeVisible();
  } finally {
    await phone.context.close();
  }
});

test("system health is for admins only", async ({ browser }) => {
  const admin = await createAdmin();
  const phone = await newPhone(browser, "Admin");
  const player = await newPhone(browser, "Player");
  try {
    await phone.page.goto("/admin/login");
    await phone.page.getByLabel("Email").fill(admin.email);
    await phone.page.getByLabel("Password").fill(PASSWORD);
    await phone.page.getByRole("button", { name: "Sign in" }).click();
    await expect(phone.page).toHaveURL(/\/admin$/);
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
