import "server-only";
import { scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

/**
 * Constant-time check of a submitted code against the stored hash. The hash itself is produced
 * by `scripts/hash-staff-code.mjs` (a plain Node script, since it must run without a TypeScript
 * loader) — keep the `scrypt:<saltHex>:<hashHex>` format in sync between the two.
 */
export function verifyStaffCode(code: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;
  const actual = scryptSync(code, salt, KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}
