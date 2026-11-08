# Supported OpenRPC contract profile

<!-- markdownlint-disable MD013 -->

The generator supports OpenRPC `1.3.2` and JSON Schema draft-07 semantics (Ajv 8 default). It is a bounded subset, not general OpenRPC or JSON Schema support.

- `methods`: a nonempty array with unique simple or dotted JavaScript-identifier segments (`name`), `paramStructure: "by-name"`, `params` array (empty is valid), and `result.schema`. Each param has a unique identifier `name`, optional boolean `required`, and a `schema`. Named params form a closed object; extra fields fail validation.
- `components.schemas`: optional local named schemas. `$ref` alone may refer to `#/components/schemas/Name`. Missing, external, circular, or combined references fail generation. Unused components are also checked.
- Schema keywords: `type`, `properties`, `required`, `additionalProperties`, `const`, `enum`, `minLength`, `maxLength`, `$ref`. Types: `object`, `string`, `boolean`, `null`, or an array of one supported non-null type plus `null`. `const` accepts a matching string, boolean, or null literal; `enum` accepts nonempty matching string or boolean literals. Nullable literals are unsupported; use nullable primitive types. String limits are nonnegative integer lengths. Objects require `additionalProperties: false`, optional `properties`, and optional `required` listing declared properties. All other keywords fail generation. Object property names are quoted in generated TypeScript.
- Input and output standalone Ajv validators compile without coercion, defaults, removal of additional properties, or normalization. Validation does not mutate input. Handwritten handlers are never regenerated.

Default CLI paths: `examples/tracer/openrpc.json` and `examples/tracer/generated`. `bun run scripts/generate-tracer.ts generate [spec.json] [output-dir]` writes `contract.ts`, `validators.js`, and `validators.d.ts`. `bun run scripts/generate-tracer.ts check [spec.json] [output-dir]` detects drift without writing. `bun run typecheck` checks handler-map and typed-caller mismatches. The in-memory JSON-RPC dispatcher does not provide authentication or transport security.
