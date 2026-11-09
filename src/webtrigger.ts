import { type AuditPort, auditSession } from "./audit";
import { createWebDispatcher, type WebOptions } from "./index";

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

/** Internal-use Jira admin verifier. The caller provides a Jira HTTP port; do not use for distributable apps. */
export function createJiraAdminAuthenticator(
  requestJira: (
    url: string,
    authorization: string,
  ) => Promise<{ status: number; body: unknown }>,
) {
  return async (
    authorization: string,
    installation: { jiraSiteUrl: string },
  ) => {
    if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization))
      return { kind: "unauthorized" as const };
    const decoded = Buffer.from(authorization.slice(6), "base64");
    if (decoded.toString("base64") !== authorization.slice(6))
      return { kind: "unauthorized" as const };
    const credentials = decoded.toString("utf8");
    const separator = credentials.indexOf(":");
    if (
      Buffer.from(credentials, "utf8").compare(decoded) !== 0 ||
      separator < 1 ||
      separator === credentials.length - 1 ||
      !/^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(credentials.slice(0, separator)) ||
      /[\r\n]/.test(credentials)
    )
      return { kind: "unauthorized" as const };
    try {
      const site = new URL(installation.jiraSiteUrl);
      if (
        site.protocol !== "https:" ||
        !site.hostname ||
        site.username ||
        site.password ||
        site.port ||
        site.pathname !== "/" ||
        site.search ||
        site.hash
      )
        return { kind: "unavailable" as const };
      const myself = await requestJira(
        `${site.origin}/rest/api/3/myself`,
        authorization,
      );
      if (myself.status === 401 || myself.status === 403)
        return { kind: "unauthorized" as const };
      if (myself.status !== 200) return { kind: "unavailable" as const };
      const accountId = (myself.body as { accountId?: unknown } | null)
        ?.accountId;
      if (typeof accountId !== "string" || !accountId)
        return { kind: "unavailable" as const };
      const permissions = await requestJira(
        `${site.origin}/rest/api/3/mypermissions?permissions=ADMINISTER`,
        authorization,
      );
      if (permissions.status === 401 || permissions.status === 403)
        return { kind: "unauthorized" as const };
      if (permissions.status !== 200) return { kind: "unavailable" as const };
      const admin = (
        permissions.body as {
          permissions?: { ADMINISTER?: { havePermission?: unknown } };
        } | null
      )?.permissions?.ADMINISTER?.havePermission;
      if (admin !== true && admin !== false)
        return { kind: "unavailable" as const };
      return admin
        ? { kind: "authenticated" as const, principal: { accountId } }
        : { kind: "forbidden" as const };
    } catch {
      return { kind: "unavailable" as const };
    }
  };
}

const containsCredentials = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) =>
      /^(?:authorization|password|api[-_]?token|token|secret|credentials|api[-_]?key)$/i.test(
        key,
      ) || containsCredentials(item),
  );
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
  const web = createWebDispatcher(options, true);
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
  return async (
    request: WebtriggerRequest,
    forgeContext?: ForgeContext,
  ): Promise<WebtriggerResponse> => {
    if (forgeContext === undefined || forgeContext === null)
      return failure(503);
    if (request.method !== "POST") return failure(405);
    if (
      request.headers !== undefined &&
      (!request.headers ||
        typeof request.headers !== "object" ||
        Array.isArray(request.headers))
    )
      return failure(400);
    const headerEntries = Object.entries(request.headers ?? {});
    if (
      headerEntries.some(
        ([, values]) =>
          !Array.isArray(values) ||
          values.some((value) => typeof value !== "string"),
      )
    )
      return failure(400);
    const headers = (name: string) =>
      headerEntries
        .filter(([key]) => key.toLowerCase() === name)
        .flatMap(([, values]) => values);
    const contentTypes = headers("content-type");
    const authorizations = headers("authorization");
    if (contentTypes.length > 1 || authorizations.length > 1)
      return failure(400);
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        contentTypes[0] ?? "",
      )
    )
      return failure(415);
    if (typeof request.body !== "string") return failure(400);
    if (Buffer.byteLength(request.body, "utf8") > 65_536) return failure(413);
    if (request.queryParameters && Object.keys(request.queryParameters).length)
      return failure(400);
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body);
    } catch {
      // Preserve the dispatcher's JSON-RPC parse error after authentication.
    }
    try {
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "params" in parsed &&
        containsCredentials(parsed.params)
      )
        return failure(400);
    } catch {
      return failure(400);
    }
    if (!authorizations[0]) {
      if (options.audit && options.installation) {
        try {
          const installation = options.installation(forgeContext);
          if (installation != null)
            await auditSession(options.audit, installation).emit(
              "authentication",
              "invalid-credentials",
            );
        } catch {
          try {
            options.audit.onFailure("authentication");
          } catch {
            /* Preserve 401. */
          }
        }
      }
      return failure(401);
    }
    if (!options.installation || !options.authenticate || !options.selection)
      return failure(503);
    try {
      const installation = options.installation(forgeContext);
      if (installation === undefined || installation === null)
        return failure(503);
      let auth: Authentication<Principal>;
      try {
        auth = await options.authenticate(authorizations[0], installation);
      } catch {
        await (options.audit &&
          auditSession(options.audit, installation).emit(
            "authentication",
            "unavailable",
          ));
        return failure(503);
      }
      if (auth.kind !== "authenticated") {
        await (options.audit &&
          auditSession(options.audit, installation).emit(
            "authentication",
            auth.kind === "unauthorized"
              ? "invalid-credentials"
              : auth.kind === "forbidden"
                ? "not-admin"
                : "unavailable",
          ));
        return failure(
          auth.kind === "unauthorized"
            ? 401
            : auth.kind === "forbidden"
              ? 403
              : 503,
        );
      }
      if (!auth.principal || typeof auth.principal !== "object")
        return failure(503);
      const audit =
        options.audit &&
        auditSession(options.audit, installation, auth.principal);
      await audit?.emit("authentication", "authenticated");
      const context = options.context(installation, auth.principal);
      if (context === undefined || context === null) return failure(503);
      return json(200, await web.dispatch(request.body, context, audit));
    } catch {
      return failure(503);
    }
  };
}
