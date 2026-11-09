import {
  type CatalogProblemDefinition,
  err,
  ok,
  type Result,
} from "@forge-ahead/errors";
import { handlerReserved, type PublicError, resolveErrors } from "./errors";

type Validator = (value: unknown) => boolean;
type Handler<Context> = (
  params: never,
  context: Context,
) => Promise<Result<unknown, unknown>>;
export type Options<Context> = {
  handlers: Record<string, Handler<Context>>;
  /** Named app definitions can override built-in titles (not codes) and register failures. */
  errorCatalog?: Record<string, CatalogProblemDefinition>;
  inputValidators: Record<string, Validator>;
  outputValidators: Record<string, Validator>;
  critical?: (method: string) => boolean;
};

/** Execute one catalog command without JSON-RPC framing. */
export function createExecutor<Context>(options: Options<Context>) {
  return executor(options, resolveErrors(options.errorCatalog));
}

export function executor<Context>(
  options: Options<Context>,
  errors: ReadonlyMap<string, PublicError>,
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
