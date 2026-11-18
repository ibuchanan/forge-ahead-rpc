/** Validate author-declared public errors, independently of the executable catalog. */
export function validateErrorMetadata(method: {
  name?: unknown;
  errors?: unknown;
  "x-retryable-errors"?: unknown;
}): void {
  const invalid = (): never => {
    throw new Error(
      `${String(method.name)}.errors: invalid inline error metadata`,
    );
  };
  if (Object.hasOwn(method, "errors") && !Array.isArray(method.errors))
    invalid();
  const codes = new Set<number>();
  for (const entry of (method.errors ?? []) as unknown[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) invalid();
    const error = entry as Record<string, unknown>;
    if (
      "$ref" in error ||
      !Number.isInteger(error["code"]) ||
      typeof error["message"] !== "string" ||
      codes.has(error["code"] as number) ||
      (Object.hasOwn(error, "data") && !isJsonValue(error["data"], new Set()))
    )
      invalid();
    codes.add(error["code"] as number);
  }
  if (Object.hasOwn(method, "x-retryable-errors")) {
    const retry = method["x-retryable-errors"];
    if (
      !Array.isArray(retry) ||
      new Set(retry).size !== retry.length ||
      Array.from(retry).some(
        (code) => !Number.isInteger(code) || !codes.has(code),
      )
    )
      throw new Error(
        `${String(method.name)}.x-retryable-errors: expected unique declared integer error codes`,
      );
  }
}

function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  ancestors.add(value);
  const values = Array.isArray(value)
    ? Array.from(value)
    : Object.values(value);
  const valid = values.every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}
