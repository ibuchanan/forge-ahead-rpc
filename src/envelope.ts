import type { PublicError } from "./errors";

function requiredError(
  errors: ReadonlyMap<string, PublicError>,
  name: string,
): PublicError {
  const definition = errors.get(name);
  if (!definition) throw new Error("missing built-in error mapping");
  return definition;
}

export type Request = {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: string | number;
};
export type Response =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: PublicError;
    };

/** Parse and validate the single-call JSON-RPC envelope without executing it. */
export function validateEnvelope(
  request: unknown,
  errors: ReadonlyMap<string, PublicError>,
): { request: Request } | { response: Response } {
  let parsed: unknown = request;
  if (typeof request === "string") {
    try {
      parsed = JSON.parse(request);
    } catch {
      return {
        response: {
          jsonrpc: "2.0",
          id: null,
          error: requiredError(errors, "parse-error"),
        },
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
    return {
      response: {
        jsonrpc: "2.0",
        id,
        error: requiredError(errors, "invalid-request"),
      },
    };
  }
  return { request: value as Request };
}
