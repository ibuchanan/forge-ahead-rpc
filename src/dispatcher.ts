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
  return async (request, context, audit) => {
    const validated = validateEnvelope(request, errors);
    if ("response" in validated) return validated.response;
    const { method, params, id } = validated.request;
    const error = (name: string): Response => ({
      jsonrpc: "2.0",
      id,
      error: errors.get(name) ?? requiredError(errors, "command-failed"),
    });
    if (options.critical?.(method)) {
      if (!audit || !(await audit.emit("attempt", "started", method)))
        return error("internal-error");
    }
    const outcome = await execute(method, params, context);
    await audit?.emit(
      "outcome",
      outcome.isOk() ? "succeeded" : "failed",
      method,
    );
    if (outcome.isOk()) return { jsonrpc: "2.0", id, result: outcome.value };
    return error(
      typeof outcome.error === "string" ? outcome.error : "internal-error",
    );
  };
}
