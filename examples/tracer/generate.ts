import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateContract } from "forge-ahead-rpc/generator";

const mode = process.argv[2];
if (mode !== "generate" && mode !== "check")
  throw new Error("Usage: bun run examples/tracer/generate.ts generate|check");
const root = "examples/tracer";
const artifacts = generateContract(
  JSON.parse(readFileSync(join(root, "openrpc.json"), "utf8")),
  "openrpc.json",
);
const outputs = {
  "contract.ts": artifacts.contract,
  "validators.js": artifacts.validators,
  "validators.d.ts": artifacts.declarations,
  "web-policy.ts": artifacts.policy,
};
const out = join(root, "generated");
if (mode === "generate") mkdirSync(out, { recursive: true });
for (const [file, content] of Object.entries(outputs)) {
  const path = join(out, file);
  if (mode === "generate") writeFileSync(path, content);
  else if (readFileSync(path, "utf8") !== content)
    throw new Error(`Generated artifact drift: ${path}`);
}
