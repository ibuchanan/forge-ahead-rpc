import { expect, test } from "bun:test";
import { err, ok } from "@forge-ahead/errors";
import {
  createDispatcher,
  createExecutor,
  rpcErrorCatalog,
} from "../src/index";

const writes: string[] = [];
const dispatch = createDispatcher({
  handlers: {
    "record.write": async ({ value }: { value: string }) => {
      writes.push(value);
      if (value === "denied") return err("private reason");
      if (value === "throw") throw new Error("private exception");
      return ok(value === "invalid-output" ? 42 : value);
    },
  },
  inputValidators: {
    "record.write": (value: unknown) =>
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as { value?: unknown }).value === "string",
  },
  outputValidators: {
    "record.write": (value: unknown) => typeof value === "string",
  },
});
const call = (value: string, id: string | number = 1) => ({
  jsonrpc: "2.0",
  method: "record.write",
  params: { value },
  id,
});
const failure = (
  code: number,
  message: string,
  id: string | number | null = null,
) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

test("malformed JSON and invalid envelopes are distinct and do not execute", async () => {
  writes.length = 0;
  expect(await dispatch('{"jsonrpc":', {})).toEqual(
    failure(-32700, "Parse error"),
  );
  for (const request of [
    [],
    [call("batch")],
    { ...call("extra"), extra: true },
    { ...call("null"), id: null },
    { ...call("array"), params: [] },
    { ...call("nan"), id: Number.NaN },
    { ...call("infinity"), id: Infinity },
    {
      jsonrpc: "2.0",
      method: "record.write",
      params: { value: "notification" },
    },
  ]) {
    expect(await dispatch(request, {})).toEqual(
      failure(
        -32600,
        "Invalid request",
        typeof (request as { id?: unknown })?.id === "string" ||
          (typeof (request as { id?: unknown })?.id === "number" &&
            Number.isFinite((request as { id: number }).id))
          ? (request as { id: string | number }).id
          : null,
      ),
    );
  }
  expect(writes).toEqual([]);
});

test("unknown methods, invalid params, expected errors and exceptions are safe", async () => {
  writes.length = 0;
  expect(
    await dispatch({ ...call("x", "missing"), method: "missing" }, {}),
  ).toEqual(failure(-32601, "Method not found", "missing"));
  expect(await dispatch({ ...call("x", 2), params: { value: 2 } }, {})).toEqual(
    failure(-32602, "Invalid params", 2),
  );
  expect(writes).toEqual([]);
  expect(await dispatch(call("denied", 3), {})).toEqual(
    failure(-32000, "Command failed", 3),
  );
  expect(await dispatch(call("throw", 4), {})).toEqual(
    failure(-32603, "Internal error", 4),
  );
  expect(writes).toEqual(["denied", "throw"]);
});

test("a declared application failure keeps its sanitized code while undeclared failures stay generic", async () => {
  const app = createDispatcher({
    handlers: {
      preview: async ({ text }: { text: string }) =>
        text === "missing" ? err("not-configured") : err("private detail"),
    },
    inputValidators: {
      preview: (value: unknown) =>
        !!value &&
        typeof value === "object" &&
        typeof (value as { text?: unknown }).text === "string",
    },
    outputValidators: {
      preview: (value: unknown) => typeof value === "string",
    },
    errorCatalog: {
      "not-configured": { code: -32002, title: "Not configured" },
    },
  });
  const request = (text: string) => ({
    jsonrpc: "2.0",
    id: 7,
    method: "preview",
    params: { text },
  });
  expect(await app(request("missing"), {})).toEqual(
    failure(-32002, "Not configured", 7),
  );
  expect(await app(request("other"), {})).toEqual(
    failure(-32000, "Command failed", 7),
  );
});

test("explicit handler denial and validation failures retain sanitized built-in responses", async () => {
  const app = createDispatcher({
    handlers: {
      command: async ({ reason }: { reason: string }) =>
        err(reason === "denied" ? "forbidden" : "invalid-params"),
    },
    inputValidators: {
      command: (value: unknown) => !!value && typeof value === "object",
    },
    outputValidators: { command: () => true },
  });
  const request = (reason: string) => ({
    jsonrpc: "2.0",
    id: 6,
    method: "command",
    params: { reason },
  });
  expect(await app(request("denied"), {})).toEqual(
    failure(-32001, "Forbidden", 6),
  );
  expect(await app(request("bad"), {})).toEqual(
    failure(-32602, "Invalid params", 6),
  );
});

test("explicit internal failure stays internal rather than becoming a retryable command failure", async () => {
  const app = createDispatcher({
    handlers: { command: async () => err("internal-error") },
    inputValidators: { command: () => true },
    outputValidators: { command: () => true },
  });
  expect(
    await app({ jsonrpc: "2.0", id: 1, method: "command", params: {} }, {}),
  ).toEqual(failure(-32603, "Internal error", 1));
});

test("rejects invalid catalog definitions at construction", () => {
  const options = { handlers: {}, inputValidators: {}, outputValidators: {} };
  for (const definition of [
    { bad: { code: -32601, title: "Bad" } },
    { bad: { code: -32002, title: "secret\nvalue" } },
    { "invalid-params": { code: -32002, title: "Oops" } },
    { bad: { code: -32000, title: "Bad" } },
    { bad: { code: -32001, title: "Bad" } },
    {
      bad: { code: -32002, title: "Bad" },
      other: { code: -32002, title: "Other" },
    },
  ]) {
    expect(() =>
      createExecutor({ ...options, errorCatalog: definition }),
    ).toThrow();
    expect(() =>
      createDispatcher({ ...options, errorCatalog: definition }),
    ).toThrow();
  }
});

test("default catalog and app-owned catalog project safe JSON-RPC errors", async () => {
  expect(rpcErrorCatalog.get("invalid-params")?.code).toBe(-32602);
  const catalog = {
    "invalid-params": { title: "Bad arguments", code: -32602 },
    "not-configured": { title: "Not configured", code: -32002 },
  };
  const options = {
    handlers: {
      preview: async ({ text }: { text: string }) =>
        err(text === "missing" ? "not-configured" : "private detail"),
    },
    inputValidators: {
      preview: (value: unknown) =>
        !!value &&
        typeof value === "object" &&
        typeof (value as { text?: unknown }).text === "string",
    },
    outputValidators: { preview: () => true },
    errorCatalog: catalog,
  };
  const execute = createExecutor(options);
  expect(
    (await execute("preview", { text: "missing" }, {}))._unsafeUnwrapErr(),
  ).toBe("not-configured");
  const app = createDispatcher(options);
  const request = (text: unknown) => ({
    jsonrpc: "2.0",
    id: 8,
    method: "preview",
    params: { text },
  });
  expect(await app(request("missing"), {})).toEqual(
    failure(-32002, "Not configured", 8),
  );
  expect(await app(request("other"), {})).toEqual(
    failure(-32000, "Command failed", 8),
  );
  expect(await app(request(2), {})).toEqual(
    failure(-32602, "Bad arguments", 8),
  );
  expect(await app("{", {})).toEqual(failure(-32700, "Parse error"));
});

test("handlers cannot claim dispatcher-owned protocol failures", async () => {
  const app = createDispatcher({
    handlers: { preview: async ({ name }: { name: string }) => err(name) },
    inputValidators: { preview: () => true },
    outputValidators: { preview: () => true },
  });
  for (const name of ["parse-error", "invalid-request", "method-not-found"])
    expect(
      await app(
        { jsonrpc: "2.0", id: 1, method: "preview", params: { name } },
        {},
      ),
    ).toEqual(failure(-32000, "Command failed", 1));
});

test("rejects unsafe catalog overrides and malformed application entries", () => {
  const base = {
    handlers: { preview: async () => err("bad") },
    inputValidators: { preview: () => true },
    outputValidators: { preview: () => true },
  };
  for (const entry of [
    { title: "Wrong code", code: -32002 },
    { title: "secret\nvalue", code: -32602 },
  ]) {
    const errorCatalog = { "invalid-params": entry };
    expect(() => createDispatcher({ ...base, errorCatalog })).toThrow();
  }
  const invalidCode = { bad: { title: "Bad", code: -32601 } };
  expect(() =>
    createExecutor({ ...base, errorCatalog: invalidCode }),
  ).toThrow();
  expect(() =>
    createDispatcher({ ...base, errorCatalog: invalidCode }),
  ).toThrow();
  const errorCatalog = { bad: { title: "Unsafe\nmessage", code: -32002 } };
  expect(() => createDispatcher({ ...base, errorCatalog })).toThrow();
});

test("catalog-only mapping rejects reserved handler names and unknown failures", async () => {
  const catalog = {
    "parse-error": { title: "Parse again", code: -32700 },
    "invalid-params": { title: "Bad arguments", code: -32602 },
    "not-configured": { title: "Not configured", code: -32002 },
  };
  const options = {
    handlers: {
      preview: async ({ reason }: { reason: string }) => err(reason),
    },
    inputValidators: { preview: () => true },
    outputValidators: { preview: () => true },
    errorCatalog: catalog,
  };
  const execute = createExecutor(options);
  const app = createDispatcher(options);
  for (const [name, expected] of [
    ["not-configured", failure(-32002, "Not configured", 1)],
    ["invalid-params", failure(-32602, "Bad arguments", 1)],
    ["parse-error", failure(-32000, "Command failed", 1)],
    ["unknown", failure(-32000, "Command failed", 1)],
  ] as const) {
    const outcome = await execute("preview", { reason: name }, {});
    expect(outcome._unsafeUnwrapErr()).toBe(
      expected.error.code === -32000 ? "command-failed" : name,
    );
    expect(
      await app(
        { jsonrpc: "2.0", id: 1, method: "preview", params: { reason: name } },
        {},
      ),
    ).toEqual(expected);
  }
});

test("invalid output after a write reports internal failure without repeating the write", async () => {
  writes.length = 0;
  expect(await dispatch(call("invalid-output", 5), {})).toEqual(
    failure(-32603, "Internal error", 5),
  );
  expect(writes).toEqual(["invalid-output"]);
});
