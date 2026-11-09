import { expect, test } from "bun:test";
import { authenticationOutcome } from "../src/webtrigger-auth";

test("authentication failures map to stable HTTP statuses and safe audit reasons", () => {
  for (const [kind, status, reason] of [
    ["missing", 401, "invalid-credentials"],
    ["unauthorized", 401, "invalid-credentials"],
    ["forbidden", 403, "not-admin"],
    ["unavailable", 503, "unavailable"],
    ["authenticated", 200, "authenticated"],
  ] as const) {
    expect(authenticationOutcome(kind).status).toBe(status);
    expect(authenticationOutcome(kind).reason).toBe(reason);
  }
});
