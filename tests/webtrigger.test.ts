import { expect, test } from "bun:test";
import { ok } from "@forge-ahead/errors";
import { createWebtrigger } from "../src/webtrigger";
import { createJiraAdminAuthenticator } from "../examples/tracer/jira-admin-authenticator";

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

test("Jira admin authentication uses trusted site and current Jira account on every call", async () => {
  calls.length = 0;
  const requests: string[] = [];
  const authenticate = createJiraAdminAuthenticator(
    async (url, authorization) => {
      requests.push(url);
      expect(authorization).toBe(
        `Basic ${Buffer.from("claim@example.test:api-token").toString("base64")}`,
      );
      if (url.endsWith("/myself"))
        return { status: 200, body: { accountId: "jira-verified" } };
      return {
        status: 200,
        body: { permissions: { ADMINISTER: { havePermission: true } } },
      };
    },
  );
  const handle = createWebtrigger({
    ...options,
    installation: (context: { installation: { jiraSiteUrl: string } }) =>
      context.installation,
    authenticate,
    context: (
      _installation: { jiraSiteUrl: string },
      principal: { accountId: string },
    ) => ({ principal }),
  });
  const forgeContext = {
    installation: { jiraSiteUrl: "https://trusted.atlassian.net" },
  };
  const input = request({
    headers: {
      "Content-Type": ["application/json"],
      Authorization: [
        `Basic ${Buffer.from("claim@example.test:api-token").toString("base64")}`,
      ],
    },
    body: body("write.one", {
      site: "https://attacker.test",
      accountId: "fake",
    }),
  });
  for (const method of ["write.one", "rpc.discover"]) {
    const response = await handle(
      {
        ...input,
        body: body(method, {
          site: "https://attacker.test",
          accountId: "fake",
        }),
      },
      forgeContext,
    );
    expect(response.statusCode).toBe(200);
  }
  expect(requests).toEqual([
    "https://trusted.atlassian.net/rest/api/3/myself",
    "https://trusted.atlassian.net/rest/api/3/mypermissions?permissions=ADMINISTER",
    "https://trusted.atlassian.net/rest/api/3/myself",
    "https://trusted.atlassian.net/rest/api/3/mypermissions?permissions=ADMINISTER",
  ]);
  expect(calls).toEqual(["jira-verified"]);
});

test("Jira admin verifier distinguishes bad credentials, non-admin, and unavailable Jira", async () => {
  calls.length = 0;
  const basic = `Basic ${Buffer.from("claim@example.test:api-token").toString("base64")}`;
  const input = request({
    headers: { "Content-Type": ["application/json"], Authorization: [basic] },
  });
  const installation = { jiraSiteUrl: "https://trusted.atlassian.net" };
  const invoke = async (
    authorization: string,
    jira: (url: string) => Promise<{ status: number; body: unknown }>,
  ) =>
    createWebtrigger({
      ...options,
      installation: (context: { installation: typeof installation }) =>
        context.installation,
      authenticate: createJiraAdminAuthenticator(jira),
      context: (
        _installation: typeof installation,
        principal: { accountId: string },
      ) => ({ principal }),
    })(
      {
        ...input,
        headers: { ...input.headers, Authorization: [authorization] },
        body: body("rpc.discover"),
      },
      { installation },
    );
  const admin = {
    status: 200,
    body: { permissions: { ADMINISTER: { havePermission: true } } },
  };
  const identity = { status: 200, body: { accountId: "verified" } };
  for (const malformed of [
    "Bearer token",
    "Basic ???",
    "Basic Zm9v",
    `Basic ${Buffer.from("not-email:token").toString("base64")}`,
  ]) {
    let called = false;
    const result = await invoke(malformed, async () => {
      called = true;
      return identity;
    });
    expect(result.statusCode).toBe(401);
    expect(called).toBe(false);
  }
  for (const [jira, status] of [
    [
      async (url: string) =>
        url.endsWith("/myself")
          ? { status: 401, body: { emailAddress: "secret" } }
          : admin,
      401,
    ],
    [
      async (url: string) =>
        url.endsWith("/myself")
          ? identity
          : {
              status: 200,
              body: { permissions: { ADMINISTER: { havePermission: false } } },
            },
      403,
    ],
    [
      async (url: string) =>
        url.endsWith("/myself") ? identity : { status: 401, body: {} },
      401,
    ],
    [
      async () => {
        throw new Error("secret outage");
      },
      503,
    ],
    [
      async (url: string) =>
        url.endsWith("/myself") ? identity : { status: 200, body: {} },
      503,
    ],
  ] as const) {
    const response = await invoke(basic, jira);
    expect(response.statusCode).toBe(status);
    expect(response.body).toBe('{"error":"Request rejected"}');
  }
  expect(calls).toEqual([]);
});

test("credential-bearing query or params are rejected before authentication and dispatch", async () => {
  calls.length = 0;
  let verified = 0;
  const handle = createWebtrigger({
    ...options,
    authenticate: async () => {
      verified++;
      return {
        kind: "authenticated" as const,
        principal: { accountId: "verified" },
      };
    },
  });
  for (const input of [
    request({ queryParameters: { token: ["secret"] } }),
    request({ queryParameters: { site: ["https://attacker.test"] } }),
    request({ body: body("write.one", { apiToken: "secret" }) }),
    request({
      body: body("rpc.discover", { credentials: { password: "secret" } }),
    }),
  ]) {
    const response = await handle(input, forgeContext);
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("secret");
  }
  expect(verified).toBe(0);
  expect(calls).toEqual([]);
});

test("asUser uses Jira-verified identity and never falls back to asApp", async () => {
  const executed: string[] = [];
  const checked: string[] = [];
  let forgeCanAct = false;
  const asUserCatalog = {
    ...catalog,
    methods: [
      {
        ...catalog.methods[0],
        "x-forge-ahead": {
          web: true,
          execution: "asUser",
          audit: "standard",
        },
      },
    ],
  };
  const handle = createWebtrigger({
    ...options,
    catalog: asUserCatalog,
    webPolicy: {
      "write.one": { execution: "asUser" as const, audit: "standard" as const },
    },
    selection: () => ({ "write.one": "asUser" as const }),
    authenticate: createJiraAdminAuthenticator(async (url) =>
      url.endsWith("/myself")
        ? { status: 200, body: { accountId: "jira-verified" } }
        : {
            status: 200,
            body: { permissions: { ADMINISTER: { havePermission: true } } },
          },
    ),
    installation: (context: { installation: { jiraSiteUrl: string } }) =>
      context.installation,
    context: (
      _installation: { jiraSiteUrl: string },
      principal: { accountId: string },
    ) => ({ principal }),
    canActAsUser: async (context: { principal: { accountId: string } }) => {
      checked.push(context.principal.accountId);
      return forgeCanAct;
    },
    handlers: {
      "write.one": async (
        _: never,
        context: { principal: { accountId: string } },
      ) => {
        executed.push(context.principal.accountId);
        return ok("saved");
      },
    },
  });
  const input = request({
    headers: {
      "Content-Type": ["application/json"],
      Authorization: [
        `Basic ${Buffer.from("claim@example.test:api-token").toString("base64")}`,
      ],
    },
    body: body("write.one", { accountId: "forged" }),
  });
  const trusted = {
    installation: { jiraSiteUrl: "https://trusted.atlassian.net" },
  };
  const denied = await handle(input, trusted);
  expect(denied.statusCode).toBe(200);
  expect(JSON.parse(denied.body)).toEqual({
    jsonrpc: "2.0",
    id: 7,
    error: { code: -32001, message: "Not permitted" },
  });
  expect(executed).toEqual([]);
  forgeCanAct = true;
  const permitted = await handle(input, trusted);
  expect(JSON.parse(permitted.body)).toEqual({
    jsonrpc: "2.0",
    id: 7,
    result: "saved",
  });
  expect(checked).toEqual(["jira-verified", "jira-verified"]);
  expect(executed).toEqual(["jira-verified"]);
});

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

test("missing Forge context is unavailable without consulting installation or authentication", async () => {
  calls.length = 0;
  let installationCalls = 0;
  let authenticationCalls = 0;
  const handle = createWebtrigger({
    ...options,
    installation: (_context: { installation?: { id: string } }) => {
      installationCalls++;
      return { id: "trusted" };
    },
    authenticate: async () => {
      authenticationCalls++;
      return {
        kind: "authenticated" as const,
        principal: { accountId: "verified" },
      };
    },
  });
  const response = await handle(request());
  expect(response.statusCode).toBe(503);
  expect(installationCalls).toBe(0);
  expect(authenticationCalls).toBe(0);
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
