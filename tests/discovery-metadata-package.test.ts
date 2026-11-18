import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import type { OpenRpcDocument } from "forge-ahead-rpc";

// Compile against distributed declarations, not just source types.
const typedCatalog: OpenRpcDocument = {
  openrpc: "1.3.2",
  info: { title: "Public types", version: "1" },
  methods: [
    {
      name: "export.document",
      params: [],
      result: { name: "document", schema: { type: "string" } },
      errors: [
        {
          code: -32004,
          message: "Unreadable",
          data: { public: [null, 1, true] },
        },
      ],
      "x-retryable-errors": [-32004],
    },
  ],
};
void typedCatalog;

for (const profile of ["dist", "dist-development"]) {
  for (const format of ["esm", "cjs"]) {
    test.skipIf(!process.env["RPC_CHECK_BUILDS"])(
      `${profile} ${format} discovery metadata through public package boundaries`,
      () => {
        const extension = format === "esm" ? "mjs" : "cjs";
        const entry = (name: string) =>
          profile === "dist"
            ? `forge-ahead-rpc${name === "index" ? "" : `/${name}`}`
            : `./${profile}/${name}.${extension}`;
        const load = (binding: string, path: string) =>
          format === "esm"
            ? `import { ${binding} } from ${JSON.stringify(path)};`
            : `const { ${binding} } = require(${JSON.stringify(path)});`;
        const script = `
        ${load("createWebDispatcher", entry("index"))}
        ${load("createWebtrigger", entry("webtrigger"))}
        ${load("generateContract", "forge-ahead-rpc/generator")}
        ${load("deepStrictEqual, throws", "node:assert/strict")}
        (async () => {
          const errors = [{ code: -32004, message: "Unreadable", data: { public: [null, true] } }];
          const method = {
            name: "export.document", paramStructure: "by-name", params: [], result: { name: "document", schema: { type: "string" } },
            errors, "x-retryable-errors": [-32004],
            "x-forge-ahead": { web: true, execution: "asApp", audit: "standard" },
          };
          const catalog = { openrpc: "1.3.2", info: { title: "Metadata", version: "1" }, methods: [method] };
          const options = {
            catalog, webPolicy: { "export.document": { execution: "asApp", audit: "standard" } },
            handlers: { "export.document": async () => ({ ok: true, value: "document" }) },
            inputValidators: { "export.document": () => true }, outputValidators: { "export.document": () => true },
            selection: () => ({ "export.document": "asApp" }),
          };
          const expected = { ...catalog, methods: [{ name: "export.document", params: [], result: method.result, paramStructure: "by-name", errors, "x-retryable-errors": [-32004] }] };
          const discover = { jsonrpc: "2.0", id: 1, method: "rpc.discover", params: {} };
          const web = createWebDispatcher(options);
          deepStrictEqual(web.publicDocument, expected);
          deepStrictEqual(await web.dispatch(discover, {}), { jsonrpc: "2.0", id: 1, result: expected });
          const trigger = createWebtrigger({ ...options,
            installation: context => context.installation,
            authenticate: async () => ({ kind: "authenticated", principal: { accountId: "verified" } }),
            context: (installation, principal) => ({ installation, principal }),
          });
          const response = await trigger({ method: "POST", headers: { authorization: ["Basic fixture"], "content-type": ["application/json"] }, body: JSON.stringify(discover) }, { installation: { id: "trusted" } });
          deepStrictEqual(response.statusCode, 200);
          deepStrictEqual(JSON.parse(response.body), { jsonrpc: "2.0", id: 1, result: expected });
          deepStrictEqual(typeof generateContract(catalog, "fixture.json").contract, "string");
          for (const metadata of [{ errors: [{ code: 1.5, message: "Invalid" }] }, { "x-retryable-errors": [-32005] }]) {
            const invalid = { ...catalog, methods: [{ ...method, ...metadata }] };
            throws(() => generateContract(invalid, "fixture.json"), /export.document/);
            throws(() => createWebDispatcher({ ...options, catalog: invalid }), /export.document/);
          }
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `;
        const result = spawnSync(
          "node",
          [...(format === "esm" ? ["--input-type=module"] : []), "-e", script],
          { encoding: "utf8" },
        );
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
      },
    );
  }
}
