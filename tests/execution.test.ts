import { expect, test } from "bun:test";
import { err, ok } from "@forge-ahead/errors";
import { createExecutor } from "../src/index";

const options = {
  handlers: {
    "account.rename": async (
      { name }: { name: string },
      context: { prefix: string },
    ) =>
      name === "blocked" ? err("not allowed") : ok(`${context.prefix}${name}`),
  },
  inputValidators: {
    "account.rename": (value: unknown) =>
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as { name?: unknown }).name === "string",
  },
  outputValidators: {
    "account.rename": (value: unknown) => typeof value === "string",
  },
};

test("executor returns semantic outcomes with trusted context separate from input", async () => {
  const execute = createExecutor(options);
  expect(
    await execute("account.rename", { name: "Ada" }, { prefix: "Hello " }),
  ).toEqual(ok("Hello Ada"));
  expect(
    await execute("account.rename", { name: "blocked" }, { prefix: "Hello " }),
  ).toEqual(err("command-failed"));
  expect(
    await execute("unknown", { name: "Ada" }, { prefix: "Hello " }),
  ).toEqual(err("method-not-found"));
  expect(
    await execute("account.rename", { name: 3 }, { prefix: "Hello " }),
  ).toEqual(err("invalid-params"));
});
