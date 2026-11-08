import { expect, test } from "bun:test";
import { err, ok } from "neverthrow";
import type { HandlerMap } from "../examples/tracer/generated/contract";
import {
  inputValidators,
  outputValidators,
} from "../examples/tracer/generated/validators";
import { createDispatcher } from "../src/index";

const handlers = {
  "greeting.hello": ({ name }, context) =>
    Promise.resolve(
      name === "blocked"
        ? err("not available")
        : ok({ message: `${context.prefix}, ${name}!` }),
    ),
  "greeting.ping": async () => ok(true),
} satisfies HandlerMap<{ prefix: string }, string>;

const dispatch = createDispatcher({
  handlers,
  inputValidators,
  outputValidators,
});

test("OpenRPC-derived handler dispatches a correlated result with trusted context", async () => {
  expect(
    await dispatch(
      {
        jsonrpc: "2.0",
        method: "greeting.hello",
        params: { name: "Ada" },
        id: 7,
      },
      { prefix: "Hello" },
    ),
  ).toEqual({
    jsonrpc: "2.0",
    id: 7,
    result: { message: "Hello, Ada!" },
  });
});

test("empty named params dispatch the second generated method", async () => {
  expect(
    await dispatch(
      { jsonrpc: "2.0", method: "greeting.ping", params: {}, id: "ping" },
      { prefix: "unused" },
    ),
  ).toEqual({ jsonrpc: "2.0", id: "ping", result: true });
});

test("invalid params fail safely without executing a handler", async () => {
  let calls = 0;
  const guarded = createDispatcher({
    handlers: {
      "greeting.hello": async () => {
        calls++;
        return ok({ message: "unexpected" });
      },
    },
    inputValidators,
    outputValidators,
  });
  expect(
    await guarded(
      {
        jsonrpc: "2.0",
        method: "greeting.hello",
        params: { name: 42 },
        id: "bad",
      },
      { prefix: "Hello" },
    ),
  ).toEqual({
    jsonrpc: "2.0",
    id: "bad",
    error: { code: -32602, message: "Invalid params" },
  });
  expect(calls).toBe(0);
});

test("invalid output, expected failures and exceptions never leak details", async () => {
  expect(
    await dispatch(
      {
        jsonrpc: "2.0",
        method: "greeting.hello",
        params: { name: "blocked" },
        id: 1,
      },
      { prefix: "Hello" },
    ),
  ).toEqual({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32000, message: "Command failed" },
  });
  const broken = createDispatcher({
    handlers: { "greeting.hello": async () => ok({ message: 2 }) },
    inputValidators,
    outputValidators,
  });
  expect(
    await broken(
      {
        jsonrpc: "2.0",
        method: "greeting.hello",
        params: { name: "Ada" },
        id: 2,
      },
      { prefix: "Hello" },
    ),
  ).toEqual({
    jsonrpc: "2.0",
    id: 2,
    error: { code: -32603, message: "Internal error" },
  });
});
