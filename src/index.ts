import type { Result } from "neverthrow";

type Validator = (value: unknown) => boolean;
type Handler<Context> = (
  params: never,
  context: Context,
) => Promise<Result<unknown, unknown>>;
type Response =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: { code: number; message: string };
    };

/** In-memory single-call JSON-RPC subset. Context is supplied by the caller, never the request. */
export function createDispatcher<Context>(options: {
  handlers: Record<string, Handler<Context>>;
  inputValidators: Record<string, Validator>;
  outputValidators: Record<string, Validator>;
}): (request: unknown, context: Context) => Promise<Response> {
  return async (request, context) => {
    const value =
      request && typeof request === "object" && !Array.isArray(request)
        ? (request as Record<string, unknown>)
        : null;
    const id =
      typeof value?.["id"] === "string" ||
      (typeof value?.["id"] === "number" && Number.isFinite(value["id"]))
        ? value["id"]
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
    const method = value["method"];
    const handler = Object.hasOwn(options.handlers, method)
      ? options.handlers[method]
      : undefined;
    const validInput = Object.hasOwn(options.inputValidators, method)
      ? options.inputValidators[method]
      : undefined;
    const validOutput = Object.hasOwn(options.outputValidators, method)
      ? options.outputValidators[method]
      : undefined;
    if (!handler || !validInput || !validOutput)
      return error(-32601, "Method not found");
    if (!validInput(value["params"])) return error(-32602, "Invalid params");
    try {
      const outcome = await handler(value["params"] as never, context);
      if (outcome.isErr()) return error(-32000, "Command failed");
      if (!validOutput(outcome.value)) return error(-32603, "Internal error");
      return { jsonrpc: "2.0", id, result: outcome.value };
    } catch {
      return error(-32603, "Internal error");
    }
  };
}
