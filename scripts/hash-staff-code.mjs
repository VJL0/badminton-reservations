#!/usr/bin/env node
// Hashes a staff access code for STAFF_ACCESS_CODE_HASH. Run: node scripts/hash-staff-code.mjs "<code>"
// Kept dependency-free (plain node:crypto) so it never needs a build step; mirrors the format
// src/lib/staff-code.ts verifies against: scrypt:<saltHex>:<hashHex>.
import { randomBytes, scryptSync } from "node:crypto";

const code = process.argv[2];
if (!code) {
  console.error('Usage: node scripts/hash-staff-code.mjs "<staff code>"');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(code, salt, 64);
console.log(`scrypt:${salt.toString("hex")}:${hash.toString("hex")}`);
