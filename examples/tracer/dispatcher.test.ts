import { expect, test } from "bun:test";
import { createDispatcher } from "forge-ahead-rpc";
import { inputValidators, outputValidators } from "./generated/validators";
import { handlers } from "./handlers";

const dispatch = createDispatcher({
  handlers,
  inputValidators,
  outputValidators,
});

test("handwritten handlers consume generated validators", async () => {
  expect(
    await dispatch(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "greeting.hello",
        params: { name: "Ada" },
      },
      { prefix: "Hello" },
    ),
  ).toEqual({ jsonrpc: "2.0", id: 1, result: { message: "Hello, Ada!" } });
  expect(
    await dispatch(
      { jsonrpc: "2.0", id: 2, method: "greeting.hello", params: { name: 42 } },
      { prefix: "Hello" },
    ),
  ).toEqual({
    jsonrpc: "2.0",
    id: 2,
    error: { code: -32602, message: "Invalid params" },
  });
});
