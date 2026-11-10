import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type {
  DispatchAudit,
  OpenRpcDocument,
  WebOptions,
} from "forge-ahead-rpc";
import type {
  WebtriggerOptions,
  WebtriggerRequest,
  WebtriggerResponse,
} from "forge-ahead-rpc/webtrigger";
import { generateContract } from "forge-ahead-rpc/generator";

type PublicTypes = [
  DispatchAudit,
  OpenRpcDocument,
  WebOptions<object>,
  WebtriggerOptions<object, object, object, object>,
  WebtriggerRequest,
  WebtriggerResponse,
];
void (0 as unknown as PublicTypes);

const require = createRequire(import.meta.url);

test("consumer build-time entry generates the reviewed contract", () => {
  const spec = JSON.parse(readFileSync("examples/tracer/openrpc.json", "utf8"));
  expect(generateContract(spec, "openrpc.json").contract).toContain(
    '"greeting.hello"',
  );
});

test("Node 22-targeted package resolves ESM and CommonJS entries", async () => {
  if (!process.env["RPC_CHECK_BUILDS"]) return;
  const esm = spawnSync(
    "bun",
    [
      "run",
      "-e",
      'import { createDispatcher } from "forge-ahead-rpc"; import * as webtrigger from "forge-ahead-rpc/webtrigger"; if (typeof createDispatcher !== "function" || typeof webtrigger.createWebtrigger !== "function" || "createJiraAdminAuthenticator" in webtrigger) process.exit(1)',
    ],
    { encoding: "utf8" },
  );
  expect(esm.status).toBe(0);
  const runtime = {
    "forge-ahead-rpc": [
      "createDispatcher",
      "createExecutor",
      "createTestProfileSelection",
      "createWebDispatcher",
      "rpcErrorCatalog",
    ],
    "forge-ahead-rpc/webtrigger": ["createWebtrigger"],
    "forge-ahead-rpc/generator": ["generateContract"],
  };
  for (const [entry, names] of Object.entries(runtime)) {
    const imported = await import(entry);
    expect(Object.keys(imported).sort()).toEqual(names.sort());
    expect(Object.keys(require(entry)).sort()).toEqual(names);
  }
  expect(typeof generateContract).toBe("function");
});
