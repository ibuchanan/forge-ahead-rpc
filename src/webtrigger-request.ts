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

function validHeaders(headers: WebtriggerRequest["headers"]): boolean {
  if (headers === undefined) return true;
  if (!headers || typeof headers !== "object" || Array.isArray(headers))
    return false;
  return Object.values(headers).every(
    (values) =>
      Array.isArray(values) &&
      values.every((value) => typeof value === "string"),
  );
}

function headerValues(entries: [string, string[]][], name: string): string[] {
  return entries
    .filter(([key]) => key.toLowerCase() === name)
    .flatMap(([, values]) => values);
}

function hasCredentialParams(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Preserve the dispatcher's JSON-RPC parse error after authentication.
    return false;
  }
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    "params" in parsed &&
    containsCredentials(parsed.params)
  );
}

/** Validate untrusted HTTP input before authentication; JSON-RPC parsing stays in dispatch. */
export function validateWebtriggerRequest(
  request: WebtriggerRequest,
): { authorization: string | undefined; body: string } | number {
  if (request.method !== "POST") return 405;
  if (!validHeaders(request.headers)) return 400;
  const headerEntries = Object.entries(request.headers ?? {});
  const headers = (name: string) => headerValues(headerEntries, name);
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
  try {
    if (hasCredentialParams(request.body)) return 400;
  } catch {
    return 400;
  }
  return { authorization: authorizations[0], body: request.body };
}
