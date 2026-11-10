import { createJSONRPCErrorResponse, JSONRPCServer } from "json-rpc-2.0";
import type { AuditPhase, AuditReason } from "./audit";
import { type Response, validateEnvelope } from "./envelope";
import { type PublicError, resolveErrors } from "./errors";
import { executor, type Options } from "./executor";

function requiredError(
  errors: ReadonlyMap<string, PublicError>,
  name: string,
): PublicError {
  const definition = errors.get(name);
  if (!definition) throw new Error("missing built-in error mapping");
  return definition;
}

export type DispatchAudit = {
  emit: (
    phase: AuditPhase,
    reason: AuditReason,
    method?: string,
  ) => Promise<boolean>;
};

/** In-memory single-call JSON-RPC 2.0 subset. Context is supplied by the caller, never the request. */
export function createDispatcher<Context>(
  options: Options<Context>,
): (
  request: unknown,
  context: Context,
  audit?: DispatchAudit,
) => Promise<Response> {
  return dispatcher(options, resolveErrors(options.errorCatalog));
}

/** Share the construction-time error lookup with a composing adapter. */
export function dispatcher<Context>(
  options: Options<Context>,
  errors: ReadonlyMap<string, PublicError>,
): (
  request: unknown,
  context: Context,
  audit?: DispatchAudit,
) => Promise<Response> {
  const execute = executor(options, errors);
  const server = new JSONRPCServer<Context>();
  const error = (id: string | number, name: string): Response => {
    const definition =
      errors.get(name) ?? requiredError(errors, "command-failed");
    return createJSONRPCErrorResponse(id, definition.code, definition.message);
  };
  for (const method of Object.keys(options.handlers)) {
    server.addMethodAdvanced(method, async (request, context) => {
      const outcome = await execute(method, request.params, context);
      if (outcome.isOk())
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: outcome.value,
        };
      return error(
        request.id as string | number,
        typeof outcome.error === "string" ? outcome.error : "internal-error",
      );
    });
  }
  server.handleMethodNotFound = async (request) =>
    error(request.id as string | number, "method-not-found");

  return async (request, context, audit) => {
    // The public subset is stricter than the library: no batches, notifications,
    // positional params, or unknown envelope fields.
    const validated = validateEnvelope(request, errors);
    if ("response" in validated) return validated.response;
    const { method, id } = validated.request;
    if (options.critical?.(method)) {
      if (!audit || !(await audit.emit("attempt", "started", method)))
        return error(id, "internal-error");
    }
    const response = await server.receive(validated.request, context);
    // The strict envelope always has an id and cannot produce a batch.
    if (!response || Array.isArray(response))
      return error(id, "internal-error");
    await audit?.emit(
      "outcome",
      "error" in response ? "failed" : "succeeded",
      method,
    );
    return response as Response;
  };
}
