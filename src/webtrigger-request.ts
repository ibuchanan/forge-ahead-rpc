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

/** Validate untrusted HTTP input before authentication; JSON-RPC parsing stays in dispatch. */
export function validateWebtriggerRequest(
  request: WebtriggerRequest,
): { authorization: string | undefined; body: string } | number {
  if (request.method !== "POST") return 405;
  if (!validHeaders(request.headers)) return 400;
  const headerEntries = Object.entries(request.headers ?? {});
  const contentTypes = headerValues(headerEntries, "content-type");
  const authorizations = headerValues(headerEntries, "authorization");
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
    const parsed: unknown = JSON.parse(request.body);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "params" in parsed &&
      containsCredentials(parsed.params)
    )
      return 400;
  } catch (error) {
    // Malformed JSON reaches dispatch after authentication; inspection failures do not.
    if (!(error instanceof SyntaxError)) return 400;
  }
  return { authorization: authorizations[0], body: request.body };
}
