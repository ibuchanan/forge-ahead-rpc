import {
  type CatalogProblemDefinition,
  createProblemCatalog,
  err,
  ok,
  type Result,
} from "@forge-ahead/errors";
import type { AuditPhase, AuditReason } from "./audit";
import { type Mode, methodMetadata, webDocument } from "./exposure";

const builtinDefinitions = {
  "parse-error": { title: "Parse error", code: -32700 },
  "invalid-request": { title: "Invalid request", code: -32600 },
  "method-not-found": { title: "Method not found", code: -32601 },
  "invalid-params": { title: "Invalid params", code: -32602 },
  "internal-error": { title: "Internal error", code: -32603 },
  "command-failed": { title: "Command failed", code: -32000 },
  forbidden: { title: "Forbidden", code: -32001 },
};
export const rpcErrorCatalog = createProblemCatalog(
  "urn:forge-ahead:rpc",
  builtinDefinitions,
);
const builtinNames = Object.keys(builtinDefinitions);
const handlerReserved = new Set<string>([
  "parse-error",
  "invalid-request",
  "method-not-found",
]);
const validTitle = (title: unknown): title is string =>
  typeof title === "string" && /^[\x20-\x7e]{1,120}$/.test(title);
type PublicError = { code: number; message: string };

function resolveErrors(
  definitions: Record<string, CatalogProblemDefinition> = {},
) {
  const errors = new Map<string, PublicError>();
  for (const name of builtinNames) {
    const entry = rpcErrorCatalog.get(name);
    if (!entry || entry.code === undefined)
      throw new Error("invalid built-in error mapping");
    errors.set(name, { code: entry.code, message: entry.title });
  }
  const codes = new Set<number>();
  for (const [name, entry] of Object.entries(definitions)) {
    const standard = errors.get(name);
    const code = entry?.code;
    if (
      !entry ||
      !validTitle(entry.title) ||
      !Number.isInteger(code) ||
      (standard
        ? code !== standard.code
        : (code ?? 0) < -32099 || (code ?? 0) > -32002) ||
      (!standard && codes.has(code as number))
    )
      throw new Error("invalid application error mapping");
    errors.set(name, { code: code as number, message: entry.title });
    if (!standard) codes.add(code as number);
  }
  return errors;
}

/** Execute one catalog command without JSON-RPC framing. */
export function createExecutor<Context>(options: Options<Context>) {
  const errors = resolveErrors(options.errorCatalog);
  return executor(options, errors);
}

function executor<Context>(
  options: Options<Context>,
  errors: Map<string, PublicError>,
) {
  return async (
    method: string,
    params: unknown,
    context: Context,
  ): Promise<Result<unknown, string>> => {
    const handler = Object.hasOwn(options.handlers, method)
      ? options.handlers[method]
      : undefined;
    const input = Object.hasOwn(options.inputValidators, method)
      ? options.inputValidators[method]
      : undefined;
    const output = Object.hasOwn(options.outputValidators, method)
      ? options.outputValidators[method]
      : undefined;
    if (!handler || !input || !output) return err("method-not-found");
    try {
      if (!input(params)) return err("invalid-params");
      const result = await handler(params as never, context);
      if (result.isErr())
        return err(
          typeof result.error === "string" &&
            !handlerReserved.has(result.error) &&
            errors.has(result.error)
            ? result.error
            : "command-failed",
        );
      return output(result.value) ? ok(result.value) : err("internal-error");
    } catch {
      return err("internal-error");
    }
  };
}

type Validator = (value: unknown) => boolean;
type Handler<Context> = (
  params: never,
  context: Context,
) => Promise<Result<unknown, unknown>>;
type Options<Context> = {
  handlers: Record<string, Handler<Context>>;
  /** Named app definitions can override built-in titles (not codes) and register failures. */
  errorCatalog?: Record<string, CatalogProblemDefinition>;
  inputValidators: Record<string, Validator>;
  outputValidators: Record<string, Validator>;
  critical?: (method: string) => boolean;
  web?: (
    method: string,
    context: Context,
    audit?: DispatchAudit,
  ) =>
    | { kind: "unknown" | "denied" }
    | { kind: "discovery"; document: unknown }
    | undefined
    | Promise<
        | { kind: "unknown" | "denied" }
        | { kind: "discovery"; document: unknown }
        | undefined
      >;
};
export type WebOptions<Context> = Options<Context> & {
  /** Generated reviewed maximum; must match the catalog before serving requests. */
  webPolicy: Record<
    string,
    { execution: Mode; audit: "standard" | "critical" }
  >;
  catalog: {
    openrpc: string;
    info: Record<string, unknown>;
    methods: Record<string, unknown>[];
    components?: Record<string, unknown>;
  };
  /** Trusted installation selection; absence exposes no application method. */
  selection?: (context: Context) => Record<string, Mode>;
  /** App-owned authorization (not authentication); defaults to deny. */
  authorize?: (method: string, mode: Mode, context: Context) => boolean;
  /** Confirm Forge can act as the Jira-verified user in trusted context; required for asUser. */
  canActAsUser?: (context: Context) => boolean | Promise<boolean>;
};

declare const __RPC_DEV_PROFILE__: boolean;

/** Select all reviewed web methods only in a development build; never derive buildTarget from runtime installation settings. */
export function createTestProfileSelection<Context>(
  webPolicy: WebOptions<Context>["webPolicy"],
  buildTarget: "development" | "production",
  productionSelection: (context: Context) => Record<string, Mode>,
): (context: Context) => Record<string, Mode> {
  return buildTarget === "development" &&
    typeof __RPC_DEV_PROFILE__ !== "undefined" &&
    __RPC_DEV_PROFILE__
    ? () =>
        Object.fromEntries(
          Object.entries(webPolicy).map(([name, policy]) => [
            name,
            policy.execution,
          ]),
        )
    : productionSelection;
}

export type DispatchAudit = {
  emit: (
    phase: AuditPhase,
    reason: AuditReason,
    method?: string,
  ) => Promise<boolean>;
};

/** Create views and a web-scoped in-memory dispatcher; caller authenticates before invoking dispatch. */
export function createWebDispatcher<Context>(
  options: WebOptions<Context>,
  requireAudit = false,
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
  const dispatch = createDispatcher({
    ...options,
    critical: (name) => requireAudit && reviewed[name]?.audit === "critical",
    web: async (name, context, audit) => {
      const exposed = selected(context);
      if (name === "rpc.discover")
        return {
          kind: "discovery",
          document: webDocument(options.catalog, exposed),
        } as const;
      if (!exposed.has(name)) {
        await audit?.emit("authorization", "unknown");
        return { kind: "unknown" } as const;
      }
      const mode = eligible.get(name);
      let allowed = !!mode && options.authorize?.(name, mode, context) === true;
      if (allowed && mode === "asUser") {
        try {
          allowed = (await options.canActAsUser?.(context)) === true;
        } catch {
          allowed = false;
        }
      }
      await audit?.emit("authorization", allowed ? "allowed" : "denied", name);
      return allowed ? undefined : ({ kind: "denied" } as const);
    },
  });
  return { publicDocument, dispatch };
}

type Response =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: { code: number; message: string };
    };

/** In-memory single-call JSON-RPC 2.0 subset. Context is supplied by the caller, never the request. */
export function createDispatcher<Context>(
  options: Options<Context>,
): (
  request: unknown,
  context: Context,
  audit?: DispatchAudit,
) => Promise<Response> {
  const errors = resolveErrors(options.errorCatalog);
  const execute = executor(options, errors);
  const requiredError = (name: string): PublicError => {
    const definition = errors.get(name);
    if (!definition) throw new Error("missing built-in error mapping");
    return definition;
  };
  return async (request, context, audit) => {
    let parsed: unknown = request;
    if (typeof request === "string") {
      try {
        parsed = JSON.parse(request);
      } catch {
        return {
          jsonrpc: "2.0",
          id: null,
          error: requiredError("parse-error"),
        };
      }
    }
    const value =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    const id =
      typeof value?.["id"] === "string" ||
      (typeof value?.["id"] === "number" && Number.isFinite(value["id"]))
        ? (value["id"] as string | number)
        : null;
    const error = (name: string, message?: string): Response => {
      const definition = errors.get(name) ?? requiredError("command-failed");
      return {
        jsonrpc: "2.0",
        id,
        error: message ? { ...definition, message } : definition,
      };
    };
    if (
      !value ||
      Object.keys(value).some(
        (key) => !["jsonrpc", "method", "params", "id"].includes(key),
      ) ||
      value["jsonrpc"] !== "2.0" ||
      typeof value["method"] !== "string" ||
      !value["method"] ||
      id === null ||
      !value["params"] ||
      typeof value["params"] !== "object" ||
      Array.isArray(value["params"])
    ) {
      return error("invalid-request");
    }
    if (options.web) {
      let gate: Awaited<ReturnType<NonNullable<Options<Context>["web"]>>>;
      try {
        gate = await options.web(value["method"], context, audit);
      } catch {
        return error("internal-error");
      }
      if (gate?.kind === "unknown") return error("method-not-found");
      if (gate?.kind === "denied") return error("forbidden", "Not permitted");
      if (gate?.kind === "discovery")
        return Object.keys(value["params"] as object).length === 0
          ? { jsonrpc: "2.0", id, result: gate.document }
          : error("invalid-params");
    }
    if (options.critical?.(value["method"])) {
      if (!audit || !(await audit.emit("attempt", "started", value["method"])))
        return error("internal-error");
    }
    const outcome = await execute(value["method"], value["params"], context);
    await audit?.emit(
      "outcome",
      outcome.isOk() ? "succeeded" : "failed",
      value["method"],
    );
    if (outcome.isOk()) return { jsonrpc: "2.0", id, result: outcome.value };
    return error(
      typeof outcome.error === "string" ? outcome.error : "internal-error",
    );
  };
}
