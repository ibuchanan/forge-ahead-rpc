import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { generateContract } from "forge-ahead-rpc/generator";

const require = createRequire(import.meta.url);

test("consumer build-time entry generates the reviewed contract", () => {
  const spec = JSON.parse(readFileSync("examples/tracer/openrpc.json", "utf8"));
  expect(generateContract(spec, "openrpc.json").contract).toContain(
    '"greeting.hello"',
  );
});

test("Node 22-targeted package resolves ESM and CommonJS entries", () => {
  if (!process.env["RPC_CHECK_BUILDS"]) return;
  const esm = spawnSync(
    "bun",
    [
      "run",
      "-e",
      'import { createDispatcher } from "forge-ahead-rpc"; import { createWebtrigger } from "forge-ahead-rpc/webtrigger"; if (typeof createDispatcher !== "function" || typeof createWebtrigger !== "function") process.exit(1)',
    ],
    { encoding: "utf8" },
  );
  expect(esm.status).toBe(0);
  const cjs = require("forge-ahead-rpc");
  expect(typeof cjs.createDispatcher).toBe("function");
  expect(typeof require("forge-ahead-rpc/webtrigger").createWebtrigger).toBe(
    "function",
  );
  expect(typeof require("forge-ahead-rpc/generator").generateContract).toBe(
    "function",
  );
  expect(typeof generateContract).toBe("function");
});
