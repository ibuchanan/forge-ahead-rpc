import { err, ok, type Result } from "@forge-ahead/errors";

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
};
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
): (request: unknown, context: Context) => Promise<Response> {
  const execute = createExecutor(options);
  return async (request, context) => {
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
    const outcome = await execute(value["method"], value["params"], context);
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
