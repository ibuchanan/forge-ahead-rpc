import { expect, test } from "bun:test";
import { validateEnvelope } from "../src/envelope";

const errors = new Map([
  ["parse-error", { code: -32700, message: "Parse error" }],
  ["invalid-request", { code: -32600, message: "Invalid request" }],
]);
const request = {
  jsonrpc: "2.0" as const,
  method: "example",
  params: {},
  id: 1,
};

test("valid envelope is returned without changing the request", () => {
  expect(validateEnvelope(JSON.stringify(request), errors)).toEqual({
    request,
  });
});

test("malformed JSON returns a parse error with null id", () => {
  expect(validateEnvelope("{", errors)).toEqual({
    response: {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    },
  });
});

test("invalid envelopes retain only valid ids in their responses", () => {
  for (const [value, id] of [
    [[], null],
    [{ ...request, extra: true }, 1],
    [{ ...request, jsonrpc: "1.0" }, 1],
    [{ ...request, method: "" }, 1],
    [{ ...request, id: null }, null],
    [{ ...request, id: Number.NaN }, null],
    [{ ...request, params: [] }, 1],
    [{ method: "example", params: {}, id: 1 }, 1],
  ] as const) {
    expect(validateEnvelope(value, errors)).toEqual({
      response: {
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid request" },
      },
    });
  }
});
