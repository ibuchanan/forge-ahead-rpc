import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = "examples/tracer";
const run = (mode: string) => {
  const result = spawnSync("bun", ["run", join(fixture, "generate.ts"), mode], {
    encoding: "utf8",
  });
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  return result;
};

test("consumer generator has a read-only drift check and deterministic artifacts", () => {
  run("check");
  const files = [
    "contract.ts",
    "validators.js",
    "validators.d.ts",
    "web-policy.ts",
  ];
  const before = files.map((name) =>
    readFileSync(join(fixture, "generated", name), "utf8"),
  );
  run("generate");
  expect(
    files.map((name) => readFileSync(join(fixture, "generated", name), "utf8")),
  ).toEqual(before);
  run("check");
});

test("packed runtime entry points do not import the Ajv generator", () => {
  if (!process.env["RPC_CHECK_BUILDS"]) return;
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.devDependencies.ajv).toBeDefined();
  expect(manifest.dependencies.ajv).toBeUndefined();
  for (const entry of ["index", "webtrigger"]) {
    for (const ext of ["mjs", "cjs"]) {
      const content = readFileSync(`dist/${entry}.${ext}`, "utf8");
      expect(content).not.toMatch(/(?:ajv|generator)/i);
    }
  }
});
