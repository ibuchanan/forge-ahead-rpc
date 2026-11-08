import { err, ok, type Result } from "@forge-ahead/errors";
import type { AuditPhase, AuditReason } from "./audit";
import { type Mode, methodMetadata, webDocument } from "./exposure";

/** Execute one catalog command without JSON-RPC framing. */
export function createExecutor<Context>(options: Options<Context>) {
  return async (
    method: string,
    params: unknown,
    context: Context,
  ): Promise<
    Result<
      unknown,
      | "method-not-found"
      | "invalid-params"
      | "command-failed"
      | "internal-error"
    >
  > => {
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
      if (result.isErr()) return err("command-failed");
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
  const execute = createExecutor(options);
  return async (request, context, audit) => {
    let parsed: unknown = request;
    if (typeof request === "string") {
      try {
        parsed = JSON.parse(request);
      } catch {
        return {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
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
    const error = (code: number, message: string): Response => ({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    });
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
      return error(-32600, "Invalid request");
    }
    if (options.web) {
      let gate: Awaited<ReturnType<NonNullable<Options<Context>["web"]>>>;
      try {
        gate = await options.web(value["method"], context, audit);
      } catch {
        return error(-32603, "Internal error");
      }
      if (gate?.kind === "unknown") return error(-32601, "Method not found");
      if (gate?.kind === "denied") return error(-32001, "Not permitted");
      if (gate?.kind === "discovery")
        return Object.keys(value["params"] as object).length === 0
          ? { jsonrpc: "2.0", id, result: gate.document }
          : error(-32602, "Invalid params");
    }
    if (options.critical?.(value["method"])) {
      if (!audit || !(await audit.emit("attempt", "started", value["method"])))
        return error(-32603, "Internal error");
    }
    const outcome = await execute(value["method"], value["params"], context);
    await audit?.emit(
      "outcome",
      outcome.isOk() ? "succeeded" : "failed",
      value["method"],
    );
    if (outcome.isOk()) return { jsonrpc: "2.0", id, result: outcome.value };
    switch (outcome.error) {
      case "method-not-found":
        return error(-32601, "Method not found");
      case "invalid-params":
        return error(-32602, "Invalid params");
      case "command-failed":
        return error(-32000, "Command failed");
      case "internal-error":
        return error(-32603, "Internal error");
    }
  };
}
