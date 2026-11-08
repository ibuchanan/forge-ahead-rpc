import { expect, test } from "bun:test";
import { ok } from "@forge-ahead/errors";
import { auditEvent } from "../src/audit";
import { createWebtrigger } from "../src/webtrigger";

const catalog = {
  openrpc: "1.3.2",
  info: { title: "Audit", version: "1" },
  methods: [
    {
      name: "write.one",
      "x-forge-ahead": { web: true, execution: "asApp", audit: "critical" },
      params: [],
      result: { name: "result", schema: { type: "string" } },
    },
  ],
};
const events: unknown[] = [];
const calls: string[] = [];
const options = {
  catalog,
  webPolicy: {
    "write.one": { execution: "asApp" as const, audit: "critical" as const },
  },
  handlers: {
    "write.one": async () => {
      calls.push("write");
      return ok("saved");
    },
  },
  inputValidators: { "write.one": () => true },
  outputValidators: { "write.one": () => true },
  selection: () => ({ "write.one": "asApp" as const }),
  authorize: () => true,
  installation: (context: {
    installation: { id: string; environment: string };
  }) => context.installation,
  authenticate: async () => ({
    kind: "authenticated" as const,
    principal: { accountId: "verified" },
  }),
  context: (
    installation: { id: string; environment: string },
    principal: { accountId: string },
  ) => ({ installation, principal }),
  audit: {
    source: "urn:forge-ahead:rpc:test",
    identity: (installation: { id: string; environment: string }) => ({
      installationId: installation.id,
      environment: installation.environment,
    }),
    accountId: (principal: { accountId: string }) => principal.accountId,
    publish: async (event: unknown) => {
      events.push(event);
      calls.push((event as { type: string }).type);
    },
    onFailure: (_reason: string) => {
      calls.push("failure");
    },
    timeoutMs: 100,
  },
};
const request = {
  method: "POST",
  headers: {
    "Content-Type": ["application/json"],
    Authorization: ["Basic secret"],
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "write.one",
    params: { note: "private" },
  }),
};
const trusted = { installation: { id: "install", environment: "development" } };

test("CloudEvent formatter uses unique IDs and a stable safe envelope", () => {
  const data = {
    correlationId: "correlation",
    installationId: "install",
    environment: "dev",
    reason: "denied" as const,
  };
  const one = auditEvent("urn:rpc:test", "authorization", data);
  const two = auditEvent("urn:rpc:test", "authorization", data);
  expect(one).toEqual({
    specversion: "1.0",
    id: expect.any(String),
    source: "urn:rpc:test",
    type: "com.forge-ahead.rpc.authorization",
    time: expect.any(String),
    data,
  });
  expect(one.id).not.toBe(two.id);
});

test("missing authorization emits invalid-credentials without dispatch", async () => {
  events.length = 0;
  calls.length = 0;
  const response = await createWebtrigger(options)(
    { ...request, headers: { "Content-Type": ["application/json"] } },
    trusted,
  );
  expect(response.statusCode).toBe(401);
  expect(calls).not.toContain("write");
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "com.forge-ahead.rpc.authentication",
      data: expect.objectContaining({ reason: "invalid-credentials" }),
    }),
  );
});

test("authenticator exceptions emit unavailable without exposing claims", async () => {
  events.length = 0;
  const response = await createWebtrigger({
    ...options,
    authenticate: async () => {
      throw new Error("secret");
    },
  })(request, trusted);
  expect(response.statusCode).toBe(503);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "com.forge-ahead.rpc.authentication",
      data: expect.objectContaining({ reason: "unavailable" }),
    }),
  );
});

test("unacknowledged timeout prevents critical execution even if delivery is uncertain", async () => {
  calls.length = 0;
  const response = await createWebtrigger({
    ...options,
    audit: {
      ...options.audit,
      timeoutMs: 5,
      publish: async (event: { type: string }) => {
        if (event.type.endsWith(".attempt")) await new Promise<void>(() => {});
      },
    },
  })(request, trusted);
  expect(JSON.parse(response.body).error.code).toBe(-32603);
  expect(calls).toEqual(["failure"]);
});

test("rejected authentication emits a safe best-effort event without changing its status", async () => {
  events.length = 0;
  calls.length = 0;
  const response = await createWebtrigger({
    ...options,
    authenticate: async () => ({ kind: "forbidden" as const }),
    audit: {
      ...options.audit,
      publish: async (event: unknown) => {
        events.push(event);
        throw new Error("secret");
      },
    },
  })(request, trusted);
  expect(response.statusCode).toBe(403);
  expect(calls).toEqual(["failure"]);
  expect(events).toEqual([
    expect.objectContaining({
      type: "com.forge-ahead.rpc.authentication",
      data: expect.objectContaining({ reason: "not-admin" }),
    }),
  ]);
  expect(JSON.stringify(events)).not.toMatch(/Basic|secret|private/);
});

test("denied authorization is audited and does not execute", async () => {
  events.length = 0;
  calls.length = 0;
  const response = await createWebtrigger({
    ...options,
    authorize: () => false,
  })(request, trusted);
  expect(JSON.parse(response.body).error.code).toBe(-32001);
  expect(calls).not.toContain("write");
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "com.forge-ahead.rpc.authorization",
      data: expect.objectContaining({ reason: "denied" }),
    }),
  );
});

test("lost outcome publication cannot turn a completed write into a retryable failure", async () => {
  calls.length = 0;
  const response = await createWebtrigger({
    ...options,
    audit: {
      ...options.audit,
      publish: async (event: { type: string }) => {
        if (event.type.endsWith(".outcome"))
          throw new Error("private publisher failure");
      },
    },
  })(request, trusted);
  expect(JSON.parse(response.body).result).toBe("saved");
  expect(calls).toEqual(["write", "failure"]);
});

test("failed critical acknowledgement blocks execution and reports operator failure", async () => {
  calls.length = 0;
  const response = await createWebtrigger({
    ...options,
    audit: {
      ...options.audit,
      publish: async (event: { type: string }) => {
        if (event.type.endsWith(".attempt"))
          throw new Error("private publisher failure");
      },
    },
  })(request, trusted);
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body).error).toEqual({
    code: -32603,
    message: "Internal error",
  });
  expect(calls).toEqual(["failure"]);
});

test("critical configuration requires a publisher before serving", () => {
  const { audit: _audit, ...withoutAudit } = options;
  expect(() => createWebtrigger(withoutAudit)).toThrow(/audit publisher/);
  expect(() =>
    createWebtrigger({ ...options, audit: { ...options.audit, timeoutMs: 0 } }),
  ).toThrow(/audit configuration/);
});

test("critical writes await an acknowledged attempt and publish their outcome without secrets", async () => {
  events.length = 0;
  calls.length = 0;
  const response = await createWebtrigger(options)(request, trusted);
  expect(response.statusCode).toBe(200);
  expect(calls).toEqual([
    "com.forge-ahead.rpc.authentication",
    "com.forge-ahead.rpc.authorization",
    "com.forge-ahead.rpc.attempt",
    "write",
    "com.forge-ahead.rpc.outcome",
  ]);
  expect(JSON.stringify(events)).not.toMatch(/secret|private|Basic/);
  expect(events).toEqual(
    events.map(() =>
      expect.objectContaining({
        specversion: "1.0",
        source: "urn:forge-ahead:rpc:test",
        id: expect.any(String),
        time: expect.any(String),
        data: expect.objectContaining({
          installationId: "install",
          environment: "development",
          accountId: "verified",
          correlationId: expect.any(String),
        }),
      }),
    ),
  );
});
