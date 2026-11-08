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

test("invalid output after a write reports internal failure without repeating the write", async () => {
  writes.length = 0;
  expect(await dispatch(call("invalid-output", 5), {})).toEqual(
    failure(-32603, "Internal error", 5),
  );
  expect(writes).toEqual(["invalid-output"]);
});
