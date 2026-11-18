# Supported OpenRPC contract profile

<!-- markdownlint-disable MD013 -->
<!-- cspell:words openrpc webtrigger -->

The generator supports OpenRPC `1.3.2` and JSON Schema draft-07 semantics (Ajv 8 default). It is a bounded subset, not general OpenRPC or JSON Schema support.

- `methods`: a nonempty array with unique simple or dotted JavaScript-identifier segments (`name`), `paramStructure: "by-name"`, `params` array (empty is valid), and `result.schema`. `rpc.discover` is reserved. Each param has a unique identifier `name`, optional boolean `required`, and a `schema`. Named params form a closed object; extra fields fail validation.
- Optional reviewed method extension `x-forge-ahead`: `{ "web": true, "execution": "asApp" | "asUser", "audit": "standard" | "critical" }`. Web eligibility defaults to false when omitted; web-eligible methods require both execution mode and minimum audit criticality. Invalid values and unknown extension keys fail generation. This metadata sets a maximum, not installation exposure or permission. The in-memory web dispatcher does not authenticate or publish audit events; the webtrigger adapter requires app-provided authentication, selection, authorization, and an acknowledged audit publisher for critical methods.
- `components.schemas`: optional local named schemas. `$ref` alone may refer to `#/components/schemas/Name`. Missing, external, circular, or combined references fail generation. Unused components are also checked.
- Schema keywords: `type`, `properties`, `required`, `additionalProperties`, `const`, `enum`, `minLength`, `maxLength`, `$ref`. Types: `object`, `string`, `boolean`, `null`, or an array of one supported non-null type plus `null`. `const` accepts a matching string, boolean, or null literal; `enum` accepts nonempty matching string or boolean literals. Nullable literals are unsupported; use nullable primitive types. String limits are nonnegative integer lengths. Objects require `additionalProperties: false`, optional `properties`, and optional `required` listing declared properties. All other keywords fail generation. Object property names are quoted in generated TypeScript.
- Input and output standalone Ajv validators compile without coercion, defaults, removal of additional properties, or normalization. Validation does not mutate input. Handwritten handlers are never regenerated.

Default CLI paths: `examples/tracer/openrpc.json` and `examples/tracer/generated`. `bun run scripts/generate-tracer.ts generate [spec.json] [output-dir]` writes `contract.ts`, `validators.js`, `validators.d.ts`, and `web-policy.ts` (the reviewed web maximum). `bun run scripts/generate-tracer.ts check [spec.json] [output-dir]` detects drift without writing. `bun run typecheck` checks handler-map and typed-caller mismatches. The in-memory JSON-RPC dispatcher does not provide authentication or transport security.

## Public error metadata

Methods may declare `errors`: an array of inline objects with a finite integer
`code`, a string `message`, and optional `data`. Codes must be unique within the
method. `data` is static public JSON metadata, not JSON Schema: null, booleans,
finite numbers, strings, arrays, and plain objects are supported recursively.
Undefined values, sparse arrays, cycles, functions, symbols, big integers, and
non-JSON objects are rejected. Error `$ref` objects are not supported; neither
are component error references. Generation and web dispatcher construction use
the same validation rules, with method/field diagnostics.

The optional method extension `x-retryable-errors` is an array of unique integer
codes declared in that method's `errors`. A listed code classifies a failure as
potentially transient; it does not promise success on retry. With an explicit
list, unlisted errors are not classified as retryable by this extension. An
omitted list means classification is unspecified. Explicit empty arrays remain
empty; omitted fields remain absent.

Both fields are preserved in `publicDocument` and context-selected
`rpc.discover` for exposed methods only. Only inline `code`, `message`, and
`data` are projected; arbitrary extensions and `x-forge-ahead` policy remain
private. Declare only metadata intended for public discovery. These declarations
are separate from the executable error catalog and do not alter runtime error
sanitization, authorization, auditing, HTTP statuses, or generated success
input/output types and validators.

Retry classification is advisory only: no automatic retries, backoff, or
scheduling is added. It establishes neither idempotency nor permission to repeat
a mutation after an uncertain outcome. Clients must separately establish safe
repetition, retry budgets, and delay policy.
