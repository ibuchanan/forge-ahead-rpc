import {
  JSONRPCErrorException,
  type JSONRPCResponse,
  JSONRPCServer,
} from "json-rpc-2.0";
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
  const server = new JSONRPCServer<{
    context: Context;
    audit: DispatchAudit | undefined;
  }>({ errorListener: () => {} });
  const catalogErrors = new WeakSet<JSONRPCErrorException>();
  const error = (name: string) => {
    const definition =
      errors.get(name) ?? requiredError(errors, "command-failed");
    const exception = new JSONRPCErrorException(
      definition.message,
      definition.code,
    );
    catalogErrors.add(exception);
    return exception;
  };
  const mapError = server.mapErrorToJSONRPCErrorResponse;
  server.mapErrorToJSONRPCErrorResponse = (id, thrown: unknown) =>
    mapError(
      id,
      thrown instanceof JSONRPCErrorException && catalogErrors.has(thrown)
        ? thrown
        : error("internal-error"),
    );
  for (const method of Object.keys(options.handlers)) {
    server.addMethod(method, async (params, { context }) => {
      const outcome = await execute(method, params, context);
      if (outcome.isErr()) throw error(outcome.error);
      return outcome.value;
    });
  }
  server.handleMethodNotFound = async () => {
    throw error("method-not-found");
  };
  server.applyMiddleware(async (next, request, params) => {
    const { audit } = params;
    let response: JSONRPCResponse | null;
    try {
      if (options.critical?.(request.method)) {
        if (!audit || !(await audit.emit("attempt", "started", request.method)))
          throw error("internal-error");
      }
      response = await next(request, params);
    } catch (thrown) {
      response = server.mapErrorToJSONRPCErrorResponse(
        request.id ?? null,
        thrown,
      );
    }
    await audit?.emit(
      "outcome",
      response?.error ? "failed" : "succeeded",
      request.method,
    );
    return response;
  });

  return async (request, context, audit) => {
    // The public subset is stricter than the library: no batches, notifications,
    // positional params, or unknown envelope fields.
    const validated = validateEnvelope(request, errors);
    if ("response" in validated) return validated.response;
    // A validated single call always has an id, so the library returns a response.
    // biome-ignore lint/style/noNonNullAssertion: strict envelopes exclude notifications
    return (await server.receive(validated.request, { context, audit }))!;
  };
}
