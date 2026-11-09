import type { DispatchAudit } from "./dispatcher";
import { dispatcher } from "./dispatcher";
import { type Response, validateEnvelope } from "./envelope";
import { type PublicError, resolveErrors } from "./errors";
import type { Options } from "./executor";
import { type Mode, methodMetadata, webDocument } from "./exposure";
import type { OpenRpcDocument } from "./openrpc";

export type WebOptions<Context> = Options<Context> & {
  /** Generated reviewed maximum; must match the catalog before serving requests. */
  webPolicy: Record<
    string,
    { execution: Mode; audit: "standard" | "critical" }
  >;
  catalog: OpenRpcDocument;
  /** Trusted installation selection; absence exposes no application method. */
  selection?: (context: Context) => Record<string, Mode>;
  /** App-owned authorization (not authentication); defaults to deny. */
  authorize?: (method: string, mode: Mode, context: Context) => boolean;
  /** Confirm Forge can act as the Jira-verified user in trusted context; required for asUser. */
  canActAsUser?: (context: Context) => boolean | Promise<boolean>;
};

declare const __RPC_DEV_PROFILE__: boolean;

/** Select all reviewed web methods only when enabled by the development build. */
export function createTestProfileSelection<Context>(
  webPolicy: WebOptions<Context>["webPolicy"],
  productionSelection: (context: Context) => Record<string, Mode>,
): (context: Context) => Record<string, Mode> {
  return typeof __RPC_DEV_PROFILE__ !== "undefined" && __RPC_DEV_PROFILE__
    ? () =>
        Object.fromEntries(
          Object.entries(webPolicy).map(([name, policy]) => [
            name,
            policy.execution,
          ]),
        )
    : productionSelection;
}

/** Create views and a web-scoped in-memory dispatcher; caller authenticates before invoking dispatch. */
export function createWebDispatcher<Context>(
  options: WebOptions<Context>,
  { requireAudit = false }: { requireAudit?: boolean } = {},
) {
  const eligible = new Map<string, Mode>();
  const reviewed: Record<
    string,
    { execution: Mode; audit: "standard" | "critical" }
  > = {};
  for (const method of options.catalog.methods) {
    if (method["name"] === "rpc.discover")
      throw new Error("reserved method name rpc.discover");
    const meta = methodMetadata(method);
    if (
      meta.web === true &&
      meta.execution &&
      meta.audit &&
      typeof method["name"] === "string"
    ) {
      eligible.set(method["name"], meta.execution);
      reviewed[method["name"]] = {
        execution: meta.execution,
        audit: meta.audit,
      };
    }
  }
  if (
    Object.keys(reviewed).length !== Object.keys(options.webPolicy).length ||
    Object.entries(reviewed).some(
      ([name, policy]) =>
        !Object.hasOwn(options.webPolicy, name) ||
        options.webPolicy[name]?.execution !== policy.execution ||
        options.webPolicy[name]?.audit !== policy.audit,
    )
  )
    throw new Error("reviewed web policy drift; regenerate contract");
  const routable = (name: string) =>
    Object.hasOwn(options.handlers, name) &&
    Object.hasOwn(options.inputValidators, name) &&
    Object.hasOwn(options.outputValidators, name);
  const maximum = new Set([...eligible.keys()].filter(routable));
  const publicDocument = webDocument(options.catalog, maximum);
  const selected = (context: Context) => {
    const selection = options.selection?.(context) ?? {};
    return new Set(
      [...maximum].filter(
        (name) =>
          Object.hasOwn(selection, name) &&
          selection[name] === eligible.get(name),
      ),
    );
  };
  const errors = resolveErrors(options.errorCatalog);
  const dispatchCore = dispatcher(
    {
      handlers: options.handlers,
      inputValidators: options.inputValidators,
      outputValidators: options.outputValidators,
      critical: (name) => requireAudit && reviewed[name]?.audit === "critical",
    },
    errors,
  );
  const error = (
    id: string | number,
    name: string,
    message?: string,
  ): Response => {
    const definition = errors.get(name) as PublicError;
    return {
      jsonrpc: "2.0",
      id,
      error: message ? { ...definition, message } : definition,
    };
  };
  const dispatch = async (
    request: unknown,
    context: Context,
    audit?: DispatchAudit,
  ): Promise<Response> => {
    const validated = validateEnvelope(request, errors);
    if ("response" in validated) return validated.response;
    const { method, params, id } = validated.request;
    try {
      const exposed = selected(context);
      if (method === "rpc.discover")
        return Object.keys(params).length === 0
          ? {
              jsonrpc: "2.0",
              id,
              result: webDocument(options.catalog, exposed),
            }
          : error(id, "invalid-params");
      if (!exposed.has(method)) {
        await audit?.emit("authorization", "unknown");
        return error(id, "method-not-found");
      }
      const mode = eligible.get(method);
      let allowed =
        !!mode && options.authorize?.(method, mode, context) === true;
      if (allowed && mode === "asUser") {
        try {
          allowed = (await options.canActAsUser?.(context)) === true;
        } catch {
          allowed = false;
        }
      }
      await audit?.emit(
        "authorization",
        allowed ? "allowed" : "denied",
        method,
      );
      if (!allowed) return error(id, "forbidden", "Not permitted");
    } catch {
      return error(id, "internal-error");
    }
    return dispatchCore(validated.request, context, audit);
  };
  return { publicDocument, dispatch };
}
