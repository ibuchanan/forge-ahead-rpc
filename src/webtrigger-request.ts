import type { WebtriggerRequest } from "./webtrigger";

const containsCredentials = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) =>
      /^(?:authorization|password|api[-_]?token|token|secret|credentials|api[-_]?key)$/i.test(
        key,
      ) || containsCredentials(item),
  );
};

/** Validate untrusted HTTP input before authentication; JSON-RPC parsing stays in dispatch. */
export function validateWebtriggerRequest(
  request: WebtriggerRequest,
): { authorization: string | undefined; body: string } | number {
  if (request.method !== "POST") return 405;
  if (
    request.headers !== undefined &&
    (!request.headers ||
      typeof request.headers !== "object" ||
      Array.isArray(request.headers))
  )
    return 400;
  const headerEntries = Object.entries(request.headers ?? {});
  if (
    headerEntries.some(
      ([, values]) =>
        !Array.isArray(values) ||
        values.some((value) => typeof value !== "string"),
    )
  )
    return 400;
  const headers = (name: string) =>
    headerEntries
      .filter(([key]) => key.toLowerCase() === name)
      .flatMap(([, values]) => values);
  const contentTypes = headers("content-type");
  const authorizations = headers("authorization");
  if (contentTypes.length > 1 || authorizations.length > 1) return 400;
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentTypes[0] ?? "")
  )
    return 415;
  if (typeof request.body !== "string") return 400;
  if (Buffer.byteLength(request.body, "utf8") > 65_536) return 413;
  if (request.queryParameters && Object.keys(request.queryParameters).length)
    return 400;
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body);
  } catch {
    // Preserve the dispatcher's JSON-RPC parse error after authentication.
  }
  try {
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "params" in parsed &&
      containsCredentials(parsed.params)
    )
      return 400;
  } catch {
    return 400;
  }
  return { authorization: authorizations[0], body: request.body };
}
