import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { webDocument } from "../src/exposure";
import { generateContract } from "../src/generator";
import {
  type OpenRpcDocument,
  type OpenRpcSchema,
  schemaKeywords,
} from "../src/openrpc";

const doc = {
  openrpc: "1.3.2",
  info: { title: "Profile fixture", version: "1.0.0" },
  components: {
    schemas: { Label: { type: "string", minLength: 1, maxLength: 8 } },
  },
  methods: [
    {
      name: "profile.create",
      paramStructure: "by-name",
      params: [
        {
          name: "label",
          required: true,
          schema: { $ref: "#/components/schemas/Label" },
        },
        { name: "enabled", schema: { type: ["boolean", "null"] } },
      ],
      result: {
        name: "created",
        schema: {
          type: "object",
          properties: { state: { const: "created" }, note: { type: "null" } },
          required: ["state"],
          additionalProperties: false,
        },
      },
    },
    {
      name: "profile.ping",
      paramStructure: "by-name",
      params: [],
      result: { name: "pong", schema: { type: "boolean" } },
    },
  ],
};

test("every generated schema keyword survives public discovery", () => {
  const cases: Record<(typeof schemaKeywords)[number], OpenRpcSchema> = {
    $ref: { $ref: "#/components/schemas/Label" },
    type: { type: "boolean" },
    properties: {
      type: "object",
      properties: { label: { type: "string" } },
      additionalProperties: false,
    },
    required: {
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
      additionalProperties: false,
    },
    additionalProperties: { type: "object", additionalProperties: false },
    const: { type: "string", const: "ready" },
    enum: { type: "string", enum: ["ready", "done"] },
    minLength: { type: "string", minLength: 1 },
    maxLength: { type: "string", maxLength: 8 },
  };
  expect(Object.keys(cases).sort()).toEqual([...schemaKeywords].sort());
  for (const schema of Object.values(cases)) {
    const catalog: OpenRpcDocument = {
      openrpc: "1.3.2",
      info: { title: "Keywords", version: "1" },
      components: { schemas: { Label: { type: "string" } } },
      methods: [
        {
          name: "sample.read",
          paramStructure: "by-name",
          params: [],
          result: { name: "value", schema },
        },
      ],
    };
    expect(() => generateContract(catalog, "fixture.json")).not.toThrow();
    const published = webDocument(catalog, new Set(["sample.read"]));
    expect(published.methods[0]?.result.schema).toEqual(schema);
  }
});

test("CLI drift check compares without changing artifacts", () => {
  mkdirSync(".scratch", { recursive: true });
  const dir = mkdtempSync(join(".scratch", "tmp_rovo_contract_"));
  try {
    const spec = join(dir, "openrpc.json");
    const out = join(dir, "generated");
    writeFileSync(spec, JSON.stringify(doc));
    const run = (mode: string) =>
      spawnSync("bun", ["run", "scripts/generate-tracer.ts", mode, spec, out], {
        encoding: "utf8",
      });
    expect(run("generate").status).toBe(0);
    expect(readdirSync(out).sort()).toEqual([
      "contract.ts",
      "validators.d.ts",
      "validators.js",
      "web-policy.ts",
    ]);
    const before = readFileSync(join(out, "contract.ts"), "utf8");
    const validators = readFileSync(join(out, "validators.js"), "utf8");
    expect(
      [...validators.matchAll(/export (?:const|function) (\w+)/g)].map(
        (match) => match[1],
      ),
    ).toEqual(["inputValidators", "outputValidators"]);
    expect(run("check").status).toBe(0);
    writeFileSync(
      spec,
      JSON.stringify({
        ...doc,
        methods: [
          {
            ...doc.methods[0],
            "x-forge-ahead": {
              web: true,
              execution: "asApp",
              audit: "critical",
            },
          },
          ...doc.methods.slice(1),
        ],
      }),
    );
    expect(run("check").status).not.toBe(0);
    expect(readFileSync(join(out, "contract.ts"), "utf8")).toBe(before);
    writeFileSync(spec, JSON.stringify({ ...doc, methods: [doc.methods[1]] }));
    expect(run("check").status).not.toBe(0);
    expect(readFileSync(join(out, "contract.ts"), "utf8")).toBe(before);
    expect(run("generate").status).toBe(0);
    expect(run("check").status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects unsupported schemas, references, positional params and collisions", () => {
  const invalid = [
    [
      {
        ...doc,
        methods: [{ ...doc.methods[0], paramStructure: "by-position" }],
      },
      /by-name/,
    ],
    [{ ...doc, methods: [doc.methods[0], doc.methods[0]] }, /duplicate method/],
    [
      {
        ...doc,
        methods: [
          {
            ...doc.methods[0],
            params: [
              { name: "__proto__", required: true, schema: { type: "string" } },
            ],
          },
        ],
      },
      /invalid or duplicate parameter name/,
    ],
    [
      {
        ...doc,
        methods: [
          {
            ...doc.methods[0],
            params: [
              { name: "label", schema: { type: "string" } },
              { name: "label", schema: { type: "boolean" } },
            ],
          },
        ],
      },
      /duplicate parameter/,
    ],
    [
      {
        ...doc,
        methods: [
          {
            ...doc.methods[0],
            params: [
              { name: "label", schema: { type: "string", default: "x" } },
            ],
          },
        ],
      },
      /unsupported keyword default/,
    ],
    [
      {
        ...doc,
        methods: [
          {
            ...doc.methods[0],
            params: [
              { name: "label", schema: { $ref: "https://example.com/schema" } },
            ],
          },
        ],
      },
      /unresolved or external reference/,
    ],
    [
      { ...doc, components: { schemas: { Label: { type: "number" } } } },
      /unsupported type/,
    ],
    [
      {
        ...doc,
        methods: [
          {
            ...doc.methods[0],
            result: {
              schema: { type: "object", properties: { x: { type: "string" } } },
            },
          },
        ],
      },
      /additionalProperties/,
    ],
    [
      {
        ...doc,
        methods: [
          {
            ...doc.methods[0],
            result: { schema: { type: ["string", "null"], const: "yes" } },
          },
        ],
      },
      /nullable literal/,
    ],
  ] as const;
  for (const [value, message] of invalid)
    expect(() => generateContract(value, "fixture.json")).toThrow(message);
});

test("multiple named methods generate typed contracts and non-mutating validators", async () => {
  const artifacts = generateContract(doc, "fixture.json");
  expect(artifacts.contract).toContain('"profile.create"');
  expect(artifacts.contract).toContain('"profile.ping"');
  expect(artifacts.contract).toContain('"label": string');
  expect(artifacts.contract).toContain('"enabled"?: boolean | null');
  expect(artifacts.contract).toContain('"state": "created"');
  expect(artifacts.validators).not.toContain("require(");
  const require = createRequire(import.meta.url);
  const { inputValidators, outputValidators } = new Function(
    "require",
    `${artifacts.validators.replaceAll("export const", "const")}\nreturn { inputValidators, outputValidators };`,
  )(require);
  const good = { label: "  A  ", enabled: null };
  expect(inputValidators["profile.create"](good)).toBe(true);
  expect(good).toEqual({ label: "  A  ", enabled: null });
  expect(inputValidators["profile.create"]({ label: "" })).toBe(false);
  expect(inputValidators["profile.create"]({ label: "123456789" })).toBe(false);
  expect(inputValidators["profile.create"]({ label: "A", extra: 1 })).toBe(
    false,
  );
  expect(inputValidators["profile.ping"]({})).toBe(true);
  expect(inputValidators["profile.ping"]({ other: 1 })).toBe(false);
  expect(
    outputValidators["profile.create"]({ state: "created", note: null }),
  ).toBe(true);
  expect(outputValidators["profile.create"]({ state: "other" })).toBe(false);
  expect(outputValidators["profile.ping"](true)).toBe(true);
});
