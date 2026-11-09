const outcomes = {
  missing: { status: 401, reason: "invalid-credentials" },
  unauthorized: { status: 401, reason: "invalid-credentials" },
  forbidden: { status: 403, reason: "not-admin" },
  unavailable: { status: 503, reason: "unavailable" },
  authenticated: { status: 200, reason: "authenticated" },
} as const;

export function authenticationOutcome(kind: keyof typeof outcomes) {
  return outcomes[kind];
}
