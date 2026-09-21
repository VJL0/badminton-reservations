import { type Browser, expect, test } from "@playwright/test";
import {
  closeAll,
  createAdmin,
  discardSession,
  enter,
  newPhone,
  type Phone,
  removeUser,
  requireNoLiveSession,
  signInBrowser,
  startSession,
  type TestAdmin,
} from "./support";

// Each test runs one live session with real phones (browser contexts); an admin drives the rest through the API.
let admin: TestAdmin;
let session: { id: string; code: string };
const phones: Phone[] = [];

async function phoneAt(browser: Browser, name: string) {
  const p = await newPhone(browser, name);
  phones.push(p);
  await enter(p);
  return p;
}

const heading = (p: Phone) => p.page.getByRole("heading", { level: 1 });

test.beforeEach(async () => {
  admin = await createAdmin();
  await requireNoLiveSession(admin.db);
  session = await startSession(admin.db, 2);
});

test.afterEach(async () => {
  await closeAll(phones.splice(0));
  await discardSession(admin.db, session.id);
  await removeUser(admin.id);
});

test("simultaneous joins converge on every screen", async ({ browser }) => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
  const all = await Promise.all(names.map((n) => phoneAt(browser, n)));

  // Everyone taps Join at the same moment.
  await Promise.all(all.map((p) => p.page.getByRole("button", { name: "Join queue" }).click()));

  // Four fill court 1 (and start), the fifth waits on court 2. Every phone ends up showing all five names...
  for (const viewer of all) {
    for (const name of names) await expect(viewer.page.getByRole("main")).toContainText(name);
  }
  // ...and exactly one seat each: no double booking, nobody lost.
  await expect
    .poll(async () => (await Promise.all(all.map((p) => heading(p).innerText()))).sort().join("|"), { timeout: 10_000 })
    .toBe(["YOU'RE ON COURT 1", "YOU'RE ON COURT 1", "YOU'RE ON COURT 1", "YOU'RE ON COURT 1", "YOU'RE ON COURT 2"].join("|"));
});

test("a phone that was offline catches up when it reconnects", async ({ browser }) => {
  const away = await phoneAt(browser, "Zoe-Away");
  const here = await phoneAt(browser, "Yan-Here");

  await away.context.setOffline(true);
  await here.page.getByRole("button", { name: "Join queue" }).click();
  await expect(heading(here)).toContainText(/You're on court/i);

  // Nothing reached the offline phone. When the connection returns it asks the database and shows the truth.
  await expect(away.page.getByRole("main")).not.toContainText("Yan-Here");
  await away.context.setOffline(false);
  await expect(away.page.getByRole("main")).toContainText("Yan-Here", { timeout: 15_000 });
});

test("a tap made offline fails at once and is never replayed", async ({ browser }) => {
  const flaky = await phoneAt(browser, "Flaky");
  await flaky.context.setOffline(true);
  await expect(flaky.page.getByText("You're offline")).toBeVisible();

  await flaky.page.getByRole("button", { name: "Join queue" }).click();
  await expect(flaky.page.getByRole("alert").filter({ hasText: "Couldn't reach the server" })).toBeVisible(); // told straight away, not held back
  await expect(heading(flaky)).toContainText(/not in the queue/i); // and the board did not break

  // Back online: the tap that failed must not run later, when the board may have moved on.
  await flaky.context.setOffline(false);
  await expect(flaky.page.getByText("You're offline")).toBeHidden();
  await flaky.page.waitForTimeout(4_000);
  await expect(heading(flaky)).toContainText(/not in the queue/i);
  const { data } = await admin.db.rpc("list_sessions");
  const row = (data as { id: string; players: number }[]).find((s) => s.id === session.id);
  expect(row?.players, "the database never saw a join from this phone").toBe(0);
});

test("ending a game, then the session, reaches every screen", async ({ browser }) => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
  const all = await Promise.all(names.map((n) => phoneAt(browser, n)));
  await Promise.all(all.map((p) => p.page.getByRole("button", { name: "Join queue" }).click()));
  for (const p of all) await expect(heading(p)).toContainText(/You're on court/i);

  // An officer opens the board and ends court 1's game.
  const officer = await newPhone(browser, "Officer");
  phones.push(officer);
  await signInBrowser(officer.context, admin);
  await officer.page.goto(`/play/${session.code}`);
  await expect(officer.page.getByText("LIVE", { exact: true })).toBeVisible();
  await officer.page.getByRole("button", { name: "End game early" }).first().click();
  await officer.page.getByRole("button", { name: "Tap again to confirm" }).click();

  // The four who were playing step off, on their own phones; the one still waiting on court 2 is untouched.
  await expect
    .poll(async () => (await Promise.all(all.map((p) => heading(p).innerText()))).filter((t) => /not in the queue/i.test(t)).length, {
      timeout: 10_000,
    })
    .toBe(4);

  // Then the session ends, and everyone is told.
  await admin.db.rpc("end_session", { p_session_id: session.id });
  for (const p of all) await expect(heading(p)).toContainText(/session has ended/i, { timeout: 10_000 });
});
