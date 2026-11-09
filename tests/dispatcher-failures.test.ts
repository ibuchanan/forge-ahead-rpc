import { expect, test } from "bun:test";
import { err, ok } from "@forge-ahead/errors";
import { createDispatcher } from "../src/index";

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
    errorMap: { "not-configured": { code: -32002, message: "Not configured" } },
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

test("rejects application mappings that collide with protocol errors or contain unsafe messages", () => {
  const options = {
    handlers: {},
    inputValidators: {},
    outputValidators: {},
  };
  expect(() =>
    createDispatcher({
      ...options,
      errorMap: { bad: { code: -32601, message: "Bad" } },
    }),
  ).toThrow();
  expect(() =>
    createDispatcher({
      ...options,
      errorMap: { bad: { code: -32002, message: "secret\nvalue" } },
    }),
  ).toThrow();
  expect(() =>
    createDispatcher({
      ...options,
      errorMap: { "invalid-params": { code: -32002, message: "Oops" } },
    }),
  ).toThrow();
  for (const code of [-32000, -32001])
    expect(() =>
      createDispatcher({
        ...options,
        errorMap: { bad: { code, message: "Bad" } },
      }),
    ).toThrow();
});

test("invalid output after a write reports internal failure without repeating the write", async () => {
  writes.length = 0;
  expect(await dispatch(call("invalid-output", 5), {})).toEqual(
    failure(-32603, "Internal error", 5),
  );
  expect(writes).toEqual(["invalid-output"]);
});
