# **Architectural Blueprint: OpenRPC Runtime Validation for Atlassian Forge**

**Technical Evaluation:** Spec-First JSON-RPC Validation Strategy Comparing Ajv Standalone and Zod in Sandboxed Forge Environments

## **1\. Executive Summary & Problem Context**

Implementing a robust JSON-RPC 2.0 protocol layer for Atlassian Forge applications introduces a dual architectural requirement: generating end-to-end TypeScript types for developer ergonomic safety, and enforcing strict runtime boundary validation against incoming payloads. Because client and server components communicate over remote boundaries—whether across Forge Backend Resolvers, Scheduled Triggers, Webtriggers, or Custom UI iframe bridges—compile-time types alone are insufficient to guarantee payload integrity.
OpenRPC serves as the contract definition standard, embedding standard JSON Schema (Draft 7 / 2020-12) to describe RPC method parameters (params) and return types (result). In a **spec-first** architecture, the OpenRPC manifest acts as the single source of truth. The library core must compile or translate this specification into runtime validation mechanisms without violating Forge's execution limits, Content Security Policy (CSP), or bundling constraints.

## **2\. Atlassian Forge Runtime & Platform Constraints**

Atlassian Forge executes application logic in two discrete runtime domains, each presenting unique engineering hurdles for validation libraries:

> * **Forge Backend Functions (Node.js runtime / Resolvers / Webtriggers):** Serverless compute environments where memory allocation and cold-start latency directly determine app responsiveness. Dynamic runtime schema compilation during cold starts imposes a measurable CPU and memory penalty.
> * **Forge Custom UI (Sandboxed Browser Iframe):** Client-side frontend rendering constrained by Atlassian's strict Content Security Policy (CSP). The CSP explicitly disallows unsafe-eval and dynamic code evaluation (e.g., eval() or new Function()). Any validation engine relying on runtime code generation immediately throws fatal CSP violations.
> * **The Forge Bundler:** Forge’s deployment CLI abstracts an internal Webpack pipeline. Machine-generated code that contains complex module resolution schemes, deep subpath imports (such as package/dist/subfolder), or unresolved dependencies frequently causes silent build drops or runtime reference errors.

## **3\. Comprehensive Evaluation: Ajv vs. Zod**

The table below contrasts the two candidate validation engines across key architectural and platform metrics:

| Evaluation Dimension | Ajv (Precompiled Standalone) | Zod (Schema Transpilation)   |
| :---- | :---- | :---- |
| **OpenRPC / JSON Schema Fit** | **Native 1:1 Support.** OpenRPC embeds JSON Schema Draft 7/2020-12, which Ajv validates without semantic translation. | **Impedance Mismatch.** Requires an intermediate AST transpilation step from JSON Schema to Zod schema definitions. |
| **Forge Custom UI (CSP Compliance)** | **Compliant only via Standalone.** Precompiled JS functions run without new Function(). Standard runtime Ajv fails CSP. | **Natively Compliant.** Uses pure functional JavaScript; zero eval or dynamic evaluation. |
| **Cold Start & Execution Speed** | **Optimal Execution.** Zero compilation time at cold start when precompiled. Standalone functions execute at raw V8 speeds. | **Fast Cold Start.** Low instantiation overhead, though interpretive execution is slower than compiled code at high scale. |
| **Bundle Footprint** | \~35 kB to 45 kB min+gzip (or negligible if inlined as pure standalone functions without external dependencies). | \~13 kB min+gzip. Fully modular and tree-shakeable. |
| **Static Type Generation** | Requires build-time type emission using json-schema-to-typescript or json-schema-to-ts. | Native inference out of the box via z.infer\<typeof Schema\>. |
| **JSON-RPC Error Mapping (-32602)** | Exposes standard JSON Pointer paths (instancePath) and JSON Schema constraint keywords directly. | Exposes array path segments (issue.path) and Zod issue codes; easily converted to JSON Pointer format. |

## **4\. Transpiling OpenRPC to Zod: Feasibility & Caveats**

While the official OpenRPC organization does not publish an openrpc-to-zod generator, an automated pipeline can be constructed using @apidevtools/json-schema-ref-parser alongside json-schema-to-zod. However, when evaluating this path for enterprise Forge apps, several semantic edge cases must be accommodated:

> * **Positional Parameters vs. Named Parameters:** JSON-RPC 2.0 accommodates parameters passed by-position (arrays) or by-name (objects). An OpenRPC-to-Zod generator must dynamically branch: positional parameters map to z.tuple(\[...\]), while named parameters map to z.object({...}).
> * **Pattern Properties & Dynamic Keys:** Standard JSON Schema supports patternProperties (regular expressions matching property keys). Zod lacks regular-expression keyed maps, supporting only uniform key schemas via z.record(...).
> * **Additional Properties Semantics:** In JSON Schema, schemas allow additional properties by default unless additionalProperties: false is declared. Zod's default behavior with z.object() strips unknown keys unless explicitly chained with .passthrough() or .strict().
> * **Recursive Schema References:** Hierarchical data structures common in Atlassian domains (e.g., Jira epic-issue-subtask hierarchies or Confluence page trees) rely on circular \$ref pointers. In Zod, recursive structures require manual wrapping in z.lazy() with explicit recursive TypeScript type annotations, which generic AST compilers frequently fail to emit cleanly.

## **5\. Production Blueprint: Zero-Dependency Standalone Ajv with Forge Bundler**

To implement a true spec-first architecture without falling into Forge Webpack resolution traps, the recommended approach is a **Two-Stage Standalone Ajv Build**. This compiles JSON Schemas directly into standalone JavaScript, and then uses a single-pass bundler (such as esbuild) to inline all Ajv runtime helpers into a self-contained module.

### **Step A: Code Generation & Schema Compilation Script**

Save this script as scripts/compile-openrpc.ts. It parses the OpenRPC specification, adds schemas to Ajv, emits standalone validation functions, and generates paired TypeScript type definitions.

import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone";
import { compile } from "json-schema-to-typescript";

interface OpenRPCParam {
  name: string;
  required?: boolean;
  schema: Record\<string, unknown\>;
}

interface OpenRPCMethod {
  name: string;
  params: OpenRPCParam\[\];
  result: { name: string; schema: Record\<string, unknown\> };
}

interface OpenRPCDocument {
  methods: OpenRPCMethod\[\];
}

async function buildValidators() {
  const specPath \= path.resolve("./openrpc.json");
  const rawSpec \= fs.readFileSync(specPath, "utf-8");
  const openRpc: OpenRPCDocument \= JSON.parse(rawSpec);

  const ajv \= new Ajv({
    code: { source: true, esm: true, lines: true },
    allErrors: true,
    strict: false,
  });

  const validatorMapping: Record\<string, string\> \= {};
  let tsDeclarations \= \`// Auto-generated by OpenRPC compiler. DO NOT EDIT.\\n\\n\`;

  for (const method of openRpc.methods) {
    const paramsSchemaId \= \`https\://forge.rpc/schemas/\${method.name}Params.json\`;

    // Construct schema for named parameters
    const paramsSchema \= {
      \$id: paramsSchemaId,
      type: "object",
      properties: Object.fromEntries(method.params.map(p \=\> \[p.name, p.schema\])),
      required: method.params.filter(p \=\> p.required).map(p \=\> p.name),
      additionalProperties: false,
    };

    ajv.addSchema(paramsSchema, paramsSchemaId);

    const exportIdentifier \= \`validate\_\${method.name}\_params\`;
    validatorMapping\[exportIdentifier\] \= paramsSchemaId;

    // Generate TypeScript interfaces
    const typeName \= \`\${method.name.charAt(0).toUpperCase() \+ method.name.slice(1)}Params\`;
    const generatedTs \= await compile(paramsSchema, typeName, { bannerComment: "" });
    tsDeclarations \+= generatedTs \+ "\\n";
  }

  // Generate intermediate standalone code
  const standaloneJs \= standaloneCode(ajv, validatorMapping);
  const outDir \= path.resolve("./src/generated");
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "validators.raw.js"), standaloneJs);
  fs.writeFileSync(path.join(outDir, "validators.d.ts"), tsDeclarations);
  console.log("Stage 1 complete: Standalone validation functions emitted.");
}

buildValidators().catch((err) \=\> {
  console.error(err);
  process.exit(1);
});

### **Step B: Inlining Runtime Helpers with esbuild**

Ajv's generated file imports utility modules like ajv/dist/runtime/ucs2length. To prevent Forge's opaque Webpack bundler from choking on these subpath exports, run a bundling pass with esbuild to produce a zero-dependency output:

npx esbuild src/generated/validators.raw.js \\
  \--bundle \\
  \--format=esm \\
  \--platform=neutral \\
  \--outfile=src/generated/validators.js

rm src/generated/validators.raw.js

### **Step C: NPM Lifecycle Integration**

Configure your Forge app's package.json so that validation compilation executes reliably before local emulation and deployment:

{
  "scripts": {
    "codegen:ajv": "tsx scripts/compile-openrpc.ts && esbuild src/generated/validators.raw.js \--bundle \--format=esm \--platform=neutral \--outfile=src/generated/validators.js && rm src/generated/validators.raw.js",
    "prebuild": "npm run codegen:ajv",
    "predeploy": "npm run codegen:ajv",
    "build": "tsc \--noEmit",
    "deploy": "forge deploy",
    "tunnel": "npm run codegen:ajv && forge tunnel"
  }
}

### **Step D: JSON-RPC Dispatcher with Error Normalization**

Integrate the inlined validators into your central Forge RPC dispatcher. The validation function automatically attaches its validation errors to the validator object, allowing direct mapping to JSON-RPC \-32602 (Invalid params):

import \* as validators from "./generated/validators.js";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string \| number \| null;
  method: string;
  params?: Record\<string, unknown\>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string \| number \| null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export async function handleRpcRequest(
  request: JsonRpcRequest,
  handlers: Record\<string, (params: any) \=\> Promise\<any\>\>
): Promise\<JsonRpcResponse\> {
  const { jsonrpc, id, method, params } \= request;

  if (jsonrpc \!== "2.0" \|\| \!method) {
    return { jsonrpc: "2.0", id: id ?? null, error: { code: \-32600, message: "Invalid Request" } };
  }

  const handler \= handlers\[method\];
  if (\!handler) {
    return { jsonrpc: "2.0", id, error: { code: \-32601, message: \`Method not found: \${method}\` } };
  }

  const validatorKey \= \`validate\_\${method}\_params\`;
  const validator \= (validators as Record\<string, any\>)\[validatorKey\];

  if (typeof validator \=== "function") {
    const isValid \= validator(params ?? {});
    if (\!isValid) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: \-32602,
          message: "Invalid params",
          data: validator.errors?.map((err: any) \=\> ({
            path: err.instancePath \|\| "/",
            keyword: err.keyword,
            message: err.message,
            params: err.params,
          })),
        },
      };
    }
  }

  try {
    const result \= await handler(params);
    return { jsonrpc: "2.0", id, result };
  } catch (err: any) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: \-32000,
        message: err?.message \|\| "Internal server error",
      },
    };
  }
}

## **6\. Architectural Recommendations**

When building a spec-first JSON-RPC library for Atlassian Forge:

> 1. **Commit to the Precompiled Ajv \+ esbuild Pipeline:** This provides total compliance with OpenRPC’s JSON Schema specifications without translation loss, guarantees zero CSP issues in Custom UI, eliminates cold-start schema compilation latency, and bypasses the Forge bundler's module resolution quirks.
> 2. **Avoid Dynamic Runtime Transpilation:** Avoid transpiling JSON Schema to Zod dynamically at runtime inside Forge functions. The overhead and impedance mismatch on advanced JSON Schema keywords introduce unforced failure modes in enterprise apps.
> 3. **Decouple Build Steps from the Forge CLI:** Run schema compilation and bundling strictly in predeploy and prebuild lifecycle scripts so Forge only ever processes static, self-contained ES module artifacts.