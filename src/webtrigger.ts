import { createWebDispatcher, type WebOptions } from "./index";

/** Forge dynamic webtrigger request shape (no Forge runtime dependency). */
export type WebtriggerRequest = {
  method: string;
  headers?: Record<string, string[]>;
  body?: string;
};
export type WebtriggerResponse = {
  statusCode: number;
  headers: { "Content-Type": string[] };
  body: string;
};

type Authentication<Principal> =
  | { kind: "authenticated"; principal: Principal }
  | { kind: "unauthorized" | "forbidden" | "unavailable" };

export type WebtriggerOptions<Context, ForgeContext, Installation, Principal> =
  WebOptions<Context> & {
    installation: (context: ForgeContext) => Installation | undefined;
    authenticate: (
      authorization: string,
      installation: Installation,
    ) => Promise<Authentication<Principal>>;
    /** Construct handler context only from independently verified values. */
    context: (installation: Installation, principal: Principal) => Context;
  };

const json = (statusCode: number, value: unknown): WebtriggerResponse => ({
  statusCode,
  headers: { "Content-Type": ["application/json; charset=utf-8"] },
  body: JSON.stringify(value),
});
const failure = (statusCode: number) =>
  json(statusCode, { error: "Request rejected" });

/** Authenticate each request before allowing JSON-RPC dispatch or discovery. */
export function createWebtrigger<
  Context,
  ForgeContext,
  Installation,
  Principal,
>(options: WebtriggerOptions<Context, ForgeContext, Installation, Principal>) {
  const web = createWebDispatcher(options);
  return async (
    request: WebtriggerRequest,
    forgeContext: ForgeContext,
  ): Promise<WebtriggerResponse> => {
    if (request.method !== "POST") return failure(405);
    if (
      request.headers !== undefined &&
      (!request.headers ||
        typeof request.headers !== "object" ||
        Array.isArray(request.headers))
    )
      return failure(400);
    const headerEntries = Object.entries(request.headers ?? {});
    if (
      headerEntries.some(
        ([, values]) =>
          !Array.isArray(values) ||
          values.some((value) => typeof value !== "string"),
      )
    )
      return failure(400);
    const headers = (name: string) =>
      headerEntries
        .filter(([key]) => key.toLowerCase() === name)
        .flatMap(([, values]) => values);
    const contentTypes = headers("content-type");
    const authorizations = headers("authorization");
    if (contentTypes.length > 1 || authorizations.length > 1)
      return failure(400);
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        contentTypes[0] ?? "",
      )
    )
      return failure(415);
    if (typeof request.body !== "string") return failure(400);
    if (Buffer.byteLength(request.body, "utf8") > 65_536) return failure(413);
    if (!authorizations[0]) return failure(401);
    if (!options.installation || !options.authenticate || !options.selection)
      return failure(503);
    try {
      const installation = options.installation(forgeContext);
      if (installation === undefined || installation === null)
        return failure(503);
      const auth = await options.authenticate(authorizations[0], installation);
      if (auth.kind === "unauthorized") return failure(401);
      if (auth.kind === "forbidden") return failure(403);
      if (
        auth.kind !== "authenticated" ||
        !auth.principal ||
        typeof auth.principal !== "object"
      )
        return failure(503);
      const context = options.context(installation, auth.principal);
      if (context === undefined || context === null) return failure(503);
      return json(200, await web.dispatch(request.body, context));
    } catch {
      return failure(503);
    }
  };
}
