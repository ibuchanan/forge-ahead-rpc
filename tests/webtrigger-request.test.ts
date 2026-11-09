import { expect, test } from "bun:test";
import { validateWebtriggerRequest } from "../src/webtrigger-request";

const request = (overrides: Record<string, unknown> = {}) => ({
  method: "POST",
  headers: {
    "Content-Type": ["application/json"],
    Authorization: ["Basic secret"],
  },
  body: '{"jsonrpc":"2.0","id":7,"method":"rpc.discover"}',
  ...overrides,
});

test("validates webtrigger ingress without authenticating or interpreting JSON-RPC", () => {
  expect(validateWebtriggerRequest(request())).toEqual({
    authorization: "Basic secret",
    body: request().body,
  });
  expect(validateWebtriggerRequest(request({ body: "{" }))).toEqual({
    authorization: "Basic secret",
    body: "{",
  });
});

test("rejects ingress with the existing status precedence", () => {
  for (const [input, status] of [
    [request({ method: "GET", headers: {} }), 405],
    [request({ headers: null }), 400],
    [
      request({
        headers: {
          "Content-Type": ["application/json"],
          Authorization: [null],
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
    [
      request({
        headers: {
          "Content-Type": ["application/json"],
          authorization: ["b"],
          Authorization: ["a"],
        },
      }),
      400,
    ],
    [request({ headers: { "Content-Type": ["text/plain"] } }), 415],
    [request({ body: undefined }), 400],
    [request({ body: "é".repeat(32_769) }), 413],
    [request({ queryParameters: { site: ["untrusted"] } }), 400],
    [
      request({
        body: JSON.stringify({ params: { nested: [{ apiToken: "secret" }] } }),
      }),
      400,
    ],
  ] as const) {
    expect(validateWebtriggerRequest(input)).toBe(status);
  }
  expect(
    validateWebtriggerRequest(
      request({ headers: { "Content-Type": ["application/json"] } }),
    ),
  ).toEqual({
    authorization: undefined,
    body: request().body,
  });
});
