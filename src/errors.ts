import {
  type CatalogProblemDefinition,
  createProblemCatalog,
} from "@forge-ahead/errors";

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
export const handlerReserved = new Set<string>([
  "parse-error",
  "invalid-request",
  "method-not-found",
]);
const validTitle = (title: unknown): title is string =>
  typeof title === "string" && /^[\x20-\x7e]{1,120}$/.test(title);
export type PublicError = { code: number; message: string };

function validApplicationCode(
  code: unknown,
  standard: PublicError | undefined,
  usedCodes: ReadonlySet<number>,
): code is number {
  if (typeof code !== "number" || !Number.isInteger(code)) return false;
  if (standard) return code === standard.code;
  return code >= -32099 && code <= -32002 && !usedCodes.has(code);
}

export function resolveErrors(
  definitions: Record<string, CatalogProblemDefinition> = {},
) {
  const errors = new Map<string, PublicError>();
  for (const name of Object.keys(builtinDefinitions)) {
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
      !validApplicationCode(code, standard, codes)
    )
      throw new Error("invalid application error mapping");
    errors.set(name, { code, message: entry.title });
    if (!standard) codes.add(code);
  }
  return errors;
}
