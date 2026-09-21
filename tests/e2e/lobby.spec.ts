import { expect, test } from "@playwright/test";
import { closeAll, createAdmin, discardSession, newPhone, removeUser, requireNoLiveSession, startSession } from "./support";

test("a new player names themselves first, then waits and is taken to the session by the lobby, without polling", async ({ browser }) => {
  const admin = await createAdmin();
  await requireNoLiveSession(admin.db);
  const phone = await newPhone(browser, "Waiter");
  let sessionId: string | undefined;
  try {
    // How often the page asks the database "is anything live?", and whether a login was made before Continue.
    const asks: string[] = [];
    const signIns: string[] = [];
    phone.page.on("request", (r) => {
      if (r.url().includes("/rpc/get_active_session_code")) asks.push(r.url());
      if (r.url().includes("/auth/v1/signup")) signIns.push(r.url());
    });

    await phone.page.goto("/");
    await expect(phone.page.getByRole("heading", { name: "What's your name?" })).toBeVisible();
    expect(signIns, "no login is created before the player presses Continue").toHaveLength(0);
    expect(asks, "and nothing asks for a session yet").toHaveLength(0);

    await phone.page.getByLabel("Your name").fill(phone.name);
    await phone.page.getByRole("button", { name: "Continue" }).click();
    await expect(phone.page.getByText("Waiting for open play to start")).toBeVisible();
    expect(signIns, "Continue made one anonymous login").toHaveLength(1);
    // Joined the private lobby channel.
    await expect(phone.page.locator("[data-live-updates]")).toHaveAttribute("data-live-updates", "on", { timeout: 15_000 });

    // The old page asked every 5 seconds. Now nothing is asked while the channel is up: wait out more than two of those.
    await phone.page.waitForTimeout(1_000); // let the question asked on connecting finish
    const before = asks.length;
    await phone.page.waitForTimeout(11_000);
    expect(asks.length - before, "no polling while the lobby channel is connected").toBe(0);

    // A session starts: the database announces it, and the phone goes to the board on its own, already named.
    const session = await startSession(admin.db);
    sessionId = session.id;
    await expect(phone.page).toHaveURL(new RegExp(`/play/${session.code}$`), { timeout: 10_000 });
    await expect(phone.page.getByText("LIVE", { exact: true })).toBeVisible();
    await expect(phone.page.getByLabel("Your name")).toHaveCount(0);

    // Back at the permanent QR address later: a returning player skips the name and goes straight to the session.
    await phone.page.goto("/");
    await expect(phone.page).toHaveURL(new RegExp(`/play/${session.code}$`));
    expect(signIns, "still only the one login").toHaveLength(1);
  } finally {
    if (sessionId) await discardSession(admin.db, sessionId);
    await closeAll([phone]);
    await removeUser(admin.id);
  }
});

test("a new player who scans while a session is live still gives a name first, then lands on it", async ({ browser }) => {
  const admin = await createAdmin();
  await requireNoLiveSession(admin.db);
  const { id, code } = await startSession(admin.db);
  const phone = await newPhone(browser, "Early");
  try {
    await phone.page.goto("/");
    await expect(phone.page).toHaveURL(/\/$/); // not sent anywhere before a name is given
    await phone.page.getByLabel("Your name").fill(phone.name);
    await phone.page.getByRole("button", { name: "Continue" }).click();
    await expect(phone.page).toHaveURL(new RegExp(`/play/${code}$`));
    await expect(phone.page.getByText("LIVE", { exact: true })).toBeVisible();
  } finally {
    await discardSession(admin.db, id);
    await closeAll([phone]);
    await removeUser(admin.id);
  }
});
