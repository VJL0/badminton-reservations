import { defineConfig, devices } from "@playwright/test";
import { e2eEnv } from "./tests/e2e/env";

// End-to-end tests: real browsers against the real app and the local Supabase stack (`pnpm supabase start`).
// Every player is its own browser context, i.e. its own phone with its own login and its own connection.
const PORT = 3100; // not 3000, so a dev server can keep running
const env = e2eEnv();

// The tests reach the same values the app is built with, and the app runs with CAPTCHA and push switched off.
Object.assign(process.env, {
  E2E_SUPABASE_URL: env.url,
  E2E_SUPABASE_PUBLISHABLE_KEY: env.publishableKey,
  E2E_SUPABASE_SECRET_KEY: env.secretKey,
});

export default defineConfig({
  testDir: "tests/e2e",
  // One session is live at a time and the tests share the database: run them one after another.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The production build: what runs in the gym, including the per-request CSP.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.publishableKey,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
      SUPABASE_SECRET_KEY: env.secretKey,
      APP_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
