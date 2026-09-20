import { execSync } from "node:child_process";

export type E2EEnv = { url: string; publishableKey: string; secretKey: string };

/** From E2E_SUPABASE_* when set (CI can export them), otherwise from the running local stack. */
export function e2eEnv(): E2EEnv {
  const { E2E_SUPABASE_URL: url, E2E_SUPABASE_PUBLISHABLE_KEY: publishableKey, E2E_SUPABASE_SECRET_KEY: secretKey } = process.env;
  if (url && publishableKey && secretKey) return { url, publishableKey, secretKey };

  const status = execSync("pnpm --silent supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const read = (key: string) => status.match(new RegExp(`^${key}="?([^"\\n]+)"?$`, "m"))?.[1];
  const found = { url: read("API_URL"), publishableKey: read("PUBLISHABLE_KEY"), secretKey: read("SECRET_KEY") };
  if (!found.url || !found.publishableKey || !found.secretKey) {
    throw new Error("Could not read the local Supabase keys. Is `pnpm supabase start` running?");
  }
  return { url: found.url, publishableKey: found.publishableKey, secretKey: found.secretKey };
}
