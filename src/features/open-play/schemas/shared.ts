import { z } from "zod";

// Building blocks for the JSON the database returns. It is trusted to be well-formed Postgres output, so ids are
// only checked for shape (a fixture id such as 0000…0001 is a valid uuid to Postgres, not to RFC 9562).
export const guid = z.guid();
/** Postgres writes timestamps with a numeric offset and microseconds: 2026-09-21T10:11:12.123456+00:00 */
export const timestamp = z.iso.datetime({ offset: true });
export const count = z.number().int().nonnegative();
