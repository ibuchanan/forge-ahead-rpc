import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { generateContract } from "./contract";

const [
  mode,
  spec = "examples/tracer/openrpc.json",
  out = "examples/tracer/generated",
] = process.argv.slice(2);
if (mode !== "generate" && mode !== "check")
  throw new Error(
    "Usage: bun run scripts/generate-tracer.ts generate|check [spec.json] [output-dir]",
  );
const artifacts = generateContract(
  JSON.parse(readFileSync(spec, "utf8")),
  basename(spec),
);
const files = {
  "contract.ts": artifacts.contract,
  "validators.js": artifacts.validators,
  "validators.d.ts": artifacts.declarations,
};
if (mode === "generate") mkdirSync(out, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  const path = join(out, name);
  if (mode === "generate") writeFileSync(path, content);
  else {
    let actual: string | undefined;
    try {
      actual = readFileSync(path, "utf8");
    } catch {
      /* Missing artifact is drift. */
    }
    if (actual !== content)
      throw new Error(`Generated artifact drift: ${path}; run generate`);
  }
}
