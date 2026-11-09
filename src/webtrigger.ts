import { type AuditPort, auditSession } from "./audit";
import { createWebDispatcher, type WebOptions } from "./index";
import { authenticationOutcome } from "./webtrigger-auth";
import { validateWebtriggerRequest } from "./webtrigger-request";

/** Forge dynamic webtrigger request shape (no Forge runtime dependency). */
export type WebtriggerRequest = {
  method: string;
  headers?: Record<string, string[]>;
  body?: string;
  queryParameters?: Record<string, string[]>;
};
export type WebtriggerResponse = {
  statusCode: number;
  headers: { "Content-Type": string[] };
  body: string;
};

type Authentication<Principal> =
  | { kind: "authenticated"; principal: Principal }
  | { kind: "unauthorized" | "forbidden" | "unavailable" };

export type WebtriggerOptions<Context, ForgeContext, Installation, Principal> =
  WebOptions<Context> & {
    installation: (context: ForgeContext) => Installation | undefined;
    authenticate: (
      authorization: string,
      installation: Installation,
    ) => Promise<Authentication<Principal>>;
    /** Construct handler context only from independently verified values. */
    context: (installation: Installation, principal: Principal) => Context;
    /** App-provided acknowledged CloudEvents publisher; required for critical methods. */
    audit?: AuditPort<Installation, Principal>;
  };

const json = (statusCode: number, value: unknown): WebtriggerResponse => ({
  statusCode,
  headers: { "Content-Type": ["application/json; charset=utf-8"] },
  body: JSON.stringify(value),
});
const failure = (statusCode: number) =>
  json(statusCode, { error: "Request rejected" });

/** Authenticate each request before allowing JSON-RPC dispatch or discovery. */
export function createWebtrigger<
  Context,
  ForgeContext,
  Installation,
  Principal,
>(options: WebtriggerOptions<Context, ForgeContext, Installation, Principal>) {
  const web = createWebDispatcher(options, { requireAudit: true });
  if (
    Object.values(options.webPolicy).some(
      (policy) => policy.audit === "critical",
    ) &&
    !options.audit
  )
    throw new Error("critical web methods require an audit publisher");
  if (
    options.audit &&
    (!options.audit.source ||
      typeof options.audit.identity !== "function" ||
      typeof options.audit.publish !== "function" ||
      typeof options.audit.onFailure !== "function" ||
      !Number.isFinite(options.audit.timeoutMs) ||
      options.audit.timeoutMs <= 0)
  )
    throw new Error("invalid audit configuration");
  const authenticate = async (
    authorization: string | undefined,
    forgeContext: ForgeContext,
  ) => {
    // A missing header remains 401 even when trusted installation lookup fails.
    let installation: Installation | undefined;
    try {
      installation = options.installation(forgeContext);
    } catch {
      if (authorization) return 503;
      try {
        options.audit?.onFailure("authentication");
      } catch {
        /* Preserve 401. */
      }
      return 401;
    }
    if (installation == null) return authorization ? 503 : 401;
    let auth: Authentication<Principal> | { kind: "missing" };
    if (!authorization) auth = { kind: "missing" };
    else {
      try {
        auth = await options.authenticate(authorization, installation);
      } catch {
        auth = { kind: "unavailable" };
      }
    }
    if (
      auth.kind === "authenticated" &&
      (!auth.principal || typeof auth.principal !== "object")
    )
      return 503;
    const outcome = authenticationOutcome(auth.kind);
    const principal =
      auth.kind === "authenticated" ? auth.principal : undefined;
    try {
      if (options.audit)
        await auditSession(options.audit, installation, principal).emit(
          "authentication",
          outcome.reason,
        );
    } catch {
      // Authentication audit is best-effort; retain the decided HTTP status.
    }
    return auth.kind === "authenticated"
      ? { installation, principal: auth.principal }
      : outcome.status;
  };
  return async (
    request: WebtriggerRequest,
    forgeContext?: ForgeContext,
  ): Promise<WebtriggerResponse> => {
    if (forgeContext === undefined || forgeContext === null)
      return failure(503);
    const validated = validateWebtriggerRequest(request);
    if (typeof validated === "number") return failure(validated);
    try {
      const authenticated = await authenticate(
        validated.authorization,
        forgeContext,
      );
      if (typeof authenticated === "number") return failure(authenticated);
      const { installation, principal } = authenticated;
      const context = options.context(installation, principal);
      if (context == null) return failure(503);
      const audit =
        options.audit && auditSession(options.audit, installation, principal);
      return json(200, await web.dispatch(validated.body, context, audit));
    } catch {
      return failure(503);
    }
  };
}
