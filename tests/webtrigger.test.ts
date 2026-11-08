import { expect, test } from "bun:test";
import { ok } from "@forge-ahead/errors";
import { createWebtrigger } from "../src/webtrigger";

const body = (method = "write.one", params: unknown = {}) =>
  JSON.stringify({ jsonrpc: "2.0", id: 7, method, params });
const request = (overrides: Record<string, unknown> = {}) => ({
  method: "POST",
  headers: {
    "Content-Type": ["application/json"],
    Authorization: ["Basic secret"],
  },
  body: body(),
  ...overrides,
});
const catalog = {
  openrpc: "1.3.2",
  info: { title: "Example", version: "1.0" },
  methods: [
    {
      name: "write.one",
      "x-forge-ahead": { web: true, execution: "asApp", audit: "standard" },
      params: [],
      result: { name: "result", schema: { type: "string" } },
    },
  ],
};
const calls: string[] = [];
const options = {
  catalog,
  webPolicy: {
    "write.one": { execution: "asApp" as const, audit: "standard" as const },
  },
  handlers: {
    "write.one": async (
      _: never,
      context: { principal: { accountId: string } },
    ) => {
      calls.push(context.principal.accountId);
      return ok("saved");
    },
  },
  inputValidators: { "write.one": () => true },
  outputValidators: { "write.one": () => true },
  selection: () => ({ "write.one": "asApp" as const }),
  authorize: () => true,
  installation: (context: { installation?: { id: string } }) =>
    context.installation,
  authenticate: async () => ({
    kind: "authenticated" as const,
    principal: { accountId: "verified" },
  }),
  context: (
    installation: { id: string },
    principal: { accountId: string },
  ) => ({ installation, principal }),
};
const forgeContext = { installation: { id: "trusted" } };

test("authenticated POST returns a Forge JSON response with trusted context", async () => {
  calls.length = 0;
  const handle = createWebtrigger(options);
  const response = await handle(
    request({ body: body("write.one", { accountId: "forged" }) }),
    forgeContext,
  );
  expect(response.statusCode).toBe(200);
  expect(response.headers["Content-Type"]).toEqual([
    "application/json; charset=utf-8",
  ]);
  expect(JSON.parse(response.body)).toEqual({
    jsonrpc: "2.0",
    id: 7,
    result: "saved",
  });
  expect(calls).toEqual(["verified"]);
  const discovery = await handle(
    request({ body: body("rpc.discover") }),
    forgeContext,
  );
  expect(
    JSON.parse(discovery.body).result.methods.map(
      (method: { name: string }) => method.name,
    ),
  ).toEqual(["write.one"]);
  const invalid = await handle(request({ body: "{" }), forgeContext);
  expect(invalid.statusCode).toBe(200);
  expect(JSON.parse(invalid.body)).toEqual({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32700, message: "Parse error" },
  });
});

test("ingress rejects before dispatch with stable precedence and no secret leakage", async () => {
  calls.length = 0;
  const handle = createWebtrigger(options);
  for (const [input, status] of [
    [request({ method: "GET", headers: {} }), 405],
    [request({ headers: { "Content-Type": ["text/plain"] } }), 415],
    [request({ body: "x".repeat(65_537) }), 413],
    [
      request({
        headers: {
          "content-type": ["application/json"],
          "Content-Type": ["application/json"],
        },
      }),
      400,
    ],
    [
      request({
        headers: {
          "Content-Type": ["application/json"],
          Authorization: ["a", "b"],
        },
      }),
      400,
    ],
    [request({ headers: { "Content-Type": "application/json" } }), 400],
    [request({ headers: null }), 400],
    [
      request({
        headers: {
          Authorization: [null],
          "Content-Type": ["application/json"],
        },
      }),
      400,
    ],
    [request({ body: "é".repeat(32_769) }), 413],
    [request({ headers: { "Content-Type": ["application/json"] } }), 401],
  ] as const) {
    const response = await handle(input, forgeContext);
    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain("secret");
  }
  expect(calls).toEqual([]);
});

test("missing configuration and failed authentication never run handlers", async () => {
  calls.length = 0;
  for (const config of [
    { ...options, installation: () => undefined },
    { ...options, context: undefined },
    { ...options, authenticate: undefined },
    { ...options, selection: undefined },
    {
      ...options,
      authenticate: async () => {
        throw new Error("secret");
      },
    },
    {
      ...options,
      authenticate: async () => ({ kind: "unavailable" as const }),
    },
  ]) {
    const response = await createWebtrigger(config as typeof options)(
      request(),
      forgeContext,
    );
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("secret");
  }
  for (const [kind, status] of [
    ["unauthorized", 401],
    ["forbidden", 403],
  ] as const) {
    const response = await createWebtrigger({
      ...options,
      authenticate: async () => ({ kind }),
    })(request(), forgeContext);
    expect(response.statusCode).toBe(status);
  }
  expect(calls).toEqual([]);
});
