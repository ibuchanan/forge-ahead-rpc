import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = "examples/tracer";
const run = (mode: string) =>
  spawnSync("bun", ["run", join(fixture, "generate.ts"), mode], {
    encoding: "utf8",
  });

test("consumer generator has a read-only drift check and deterministic artifacts", () => {
  expect(run("check").status).toBe(0);
  const files = [
    "contract.ts",
    "validators.js",
    "validators.d.ts",
    "web-policy.ts",
  ];
  const before = files.map((name) =>
    readFileSync(join(fixture, "generated", name), "utf8"),
  );
  expect(run("generate").status).toBe(0);
  expect(
    files.map((name) => readFileSync(join(fixture, "generated", name), "utf8")),
  ).toEqual(before);
  expect(run("check").status).toBe(0);
});

test("package manifest is reproducible and retains private pre-release status", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.dependencies["@forge-ahead/errors"]).toMatch(
    /^github:ibuchanan\/forge-ahead-errors#[a-f0-9]{40}$/,
  );
  expect(manifest.devDependencies.ajv).toMatch(/^\d+\.\d+\.\d+$/);
  expect(manifest.devDependencies).not.toHaveProperty("vitest");
  expect(manifest.description).not.toBe("");
  expect(manifest.private).toBe(true);
  expect(manifest.engines.node).toBe(">=22");
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
