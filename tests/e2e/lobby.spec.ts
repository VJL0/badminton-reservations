import { expect, test } from "@playwright/test";
import { closeAll, createAdmin, discardSession, newPhone, removeUser, requireNoLiveSession, startSession } from "./support";

test("a waiting phone opens the queue by itself, without polling", async ({ browser }) => {
  const admin = await createAdmin();
  await requireNoLiveSession(admin.db);
  const phone = await newPhone(browser, "Waiter");
  let sessionId: string | undefined;
  try {
    // How often the page asks the database "is anything live?".
    const asks: string[] = [];
    phone.page.on("request", (r) => r.url().includes("/rpc/get_active_session_code") && asks.push(r.url()));

    await phone.page.goto("/");
    await expect(phone.page.getByText("Waiting for open play to start")).toBeVisible();
    // Signed in anonymously and joined the private lobby channel.
    await expect(phone.page.locator("[data-live-updates]")).toHaveAttribute("data-live-updates", "on", { timeout: 15_000 });

    // The old page asked every 5 seconds. Now nothing is asked while the channel is up: wait out more than two of those.
    await phone.page.waitForTimeout(1_000); // let the question asked on connecting finish
    const before = asks.length;
    await phone.page.waitForTimeout(11_000);
    expect(asks.length - before, "no polling while the lobby channel is connected").toBe(0);

    // A session starts: the database announces it, and the phone goes to the board on its own.
    const session = await startSession(admin.db);
    sessionId = session.id;
    await expect(phone.page).toHaveURL(new RegExp(`/play/${session.code}$`), { timeout: 10_000 });
    await expect(phone.page.getByLabel("Your name")).toBeVisible(); // already logged in, so no CAPTCHA to wait for, just a name
  } finally {
    if (sessionId) await discardSession(admin.db, sessionId);
    await closeAll([phone]);
    await removeUser(admin.id);
  }
});
