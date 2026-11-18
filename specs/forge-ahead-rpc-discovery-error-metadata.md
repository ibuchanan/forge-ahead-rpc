# RPC capability request: discoverable errors and retry classification

<!-- cspell:words webtrigger openrpc workdown unroutable -->

Status: proposed library work, 2026-11-17. This is a portable handoff for
`forge-ahead-rpc` (imported by this app as `@forge-ahead/rpc`), not an
application workaround or a claim that these capabilities already exist.

## Problem and observed evidence

The consuming Forge app declares method-level OpenRPC `errors` and an
`x-retryable-errors` extension in its application contract. The installed
library's bounded `OpenRpcMethod` type does not include either field.
`webDocument` reconstructs methods from an allowlist and drops both fields.
Both `createWebDispatcher().publicDocument` and `rpc.discover` use that
projection. Meanwhile, `generateContract` accepts the source document and
artifact freshness checks pass without establishing metadata preservation.

Consequently, four consuming-app discovery tests fail: direct dispatcher and
both authenticated webtrigger adapters return a document that differs from the
application contract. Standard OpenRPC validity passes; completeness does not.
Do not fix this by weakening equality tests, copying metadata into responses
in each application, or editing installed/generated files by hand.

## Required outcome

One application-owned OpenRPC document defines public method errors and their
retry classification. Library validation and discovery preserve the supported
public metadata for exposed methods, while retaining all existing exposure,
authentication, authorization, execution-mode, and audit boundaries.

Intent flows through these existing surfaces:

1. Application OpenRPC document: authoritative public method declaration.
2. Library profile/types and generator: validate the supported declaration.
3. Web projection: retain supported public metadata only for included methods.
4. Discovery consumers: inspect error meanings and advisory retry classification.
5. Runtime dispatcher: continue using the separately supplied error catalog;
   declarations do not implement handlers or generate executable error behavior.

## Minimum supported declaration

The following is a complete, sanitized example of the required metadata. The
Forge extension shown here is the existing policy; the retry extension is new.

```json
{
  "openrpc": "1.3.2",
  "info": { "title": "Example", "version": "0.1.0" },
  "methods": [
    {
      "name": "workdown.export",
      "paramStructure": "by-name",
      "params": [],
      "result": { "name": "Document", "schema": { "type": "string" } },
      "errors": [
        { "code": -32004, "message": "Field unreadable" },
        { "code": -32005, "message": "Issue ineligible" },
        { "code": -32006, "message": "Eligibility undetermined" }
      ],
      "x-retryable-errors": [-32004, -32006],
      "x-forge-ahead": {
        "web": true,
        "execution": "asUser",
        "audit": "standard"
      }
    }
  ]
}
```

### Standard OpenRPC errors

- Add optional method-level inline `errors` support to the bounded profile and
  exported TypeScript types. Each entry requires an integer `code` and a string
  `message`; permit the standard optional `data` JSON value as declarative
  metadata. Preserve its JSON structure without interpreting it as a schema.
- Reject malformed entries and duplicate codes within a method. The same code
  may appear on different methods. Accept protocol codes such as -32602 and
  application codes such as -32004; do not limit declarations to this app's
  catalog or require one global message for every method.
- Preserve declared array order, messages, and optional data exactly in value.
  Omitted metadata stays omitted; do not invent errors from the runtime catalog.
- Inline definitions are sufficient for this request. Component error
  references and unrelated OpenRPC features are not prerequisites. If not
  supported, reject them explicitly rather than silently dropping them.
- Runtime error data, causes, and internal messages must not be copied into
  discovery. Only author-declared public metadata is eligible for projection.

### Proposed extension: `x-retryable-errors`

This is a proposed library-supported, method-level extension, not a standard
OpenRPC field. Implement and document its semantics before claiming support.

- Its value is an optional array of unique integer error codes, each declared
  in that method's `errors`. Reject invalid types, duplicates, and undeclared
  codes. An empty array is valid and must remain empty in discovery.
- A listed code means the application classifies that failure as potentially
  transient for this method. It does not promise that a retry will succeed.
- For an explicit list, unlisted declared errors are not classified as
  retryable by this extension. An absent list means classification is
  unspecified, not that all or none of the errors are retryable.
- It is descriptive metadata only. No automatic retries, scheduling, backoff,
  changed HTTP statuses, permission changes, or dispatch behavior are added.
  It neither establishes idempotency nor authorizes repeating a mutation after
  an uncertain outcome. Clients must separately establish safe repetition,
  retry budgets, and delay policy.
- For the app example, -32005 is a policy denial; -32004 and -32006 may reflect
  transient read failures. Repeated uncertainty still fails closed and never
  grants permission. The library must not hard-code these app-specific codes.

## Validation and implementation requirements

- Extend the public bounded profile/types and its documentation for these two
  supported fields. Preserve existing call sites with neither field present.
- Share validation rules between generation and runtime catalog construction,
  or otherwise test their agreement. Malformed supported metadata must fail
  at generation and dispatcher construction, not disappear at discovery time.
  Validation errors should identify the method and offending metadata field.
- Extend the existing discovery projection rather than replacing it with a
  raw document spread. Preserve `errors` and `x-retryable-errors` for included
  methods in both the maximum public view and per-context discovery response.
- Keep hidden, unselected, unroutable, and non-web methods and their metadata
  out of the appropriate view. Preserve current deny-by-default selection.
  Keep `x-forge-ahead` execution/audit policy out of public discovery.
- Do not indiscriminately pass through arbitrary `x-*` properties. Supporting
  this named extension does not make unrelated extensions public or supported.
- No change to command input/output types or validators is inherently needed:
  these fields describe failures, not successful results. Generated artifacts
  may remain byte-identical; generator success alone must not be used as proof
  that runtime discovery supports the fields.
- Method error declarations remain separate from the executable error catalog.
  Do not require applications to generate the latter, change runtime error
  sanitization, or claim declarations implement eligibility checks.
- Cover the package's distributed entry points/build profiles that expose
  discovery, including ESM and CommonJS if both remain supported. Do not test
  only a source helper that the published package does not actually use.

## Acceptance tests

Use local, deterministic synthetic catalogs and contexts; this library change
requires neither Forge deployment nor a second installation.

1. A method declaring inline errors, optional static data, and retry codes is
   accepted by types/generation and runtime construction. Standard OpenRPC
   meta-schema validation passes for the source and discovered documents.
   Separately validate the extension's stronger subset/uniqueness rules.
2. Direct `rpc.discover` returns the supported public contract fields exactly
   in value. Assert the errors, data, and retry array explicitly; retain a
   whole-document equality check with only intentional private fields removed.
3. Exercise both `publicDocument` and context-selected discovery. A hidden or
   unselected second method's errors do not leak; selection/mode mismatch and
   missing handlers/validators retain existing exposure behavior.
4. Contracts with neither field preserve existing discovery shape. Empty
   arrays remain arrays; omitted fields remain absent. Preserve input objects
   unchanged and ensure context-specific calls cannot contaminate each other.
5. Invalid code/message types, duplicate error codes, malformed error data
   outside JSON, unsupported references, malformed retry arrays, duplicate
   retry codes, and undeclared retry codes fail through the documented
   validation boundaries. Include generation/runtime agreement tests.
6. Existing runtime error mapping and sanitization are unchanged: successful
   results, error envelopes, authorization denial, and audit behavior retain
   their existing tests. Merely declaring a retry list causes no extra calls.
7. Verify that a deliberately unknown method extension is not accidentally
   published, and that `x-forge-ahead` policy still stays private.
8. Exercise the built package entry points, then run the library's normal
   build, type, test, and package checks. Record actual commands and results.

## Consumer verification and handoff

After building and publishing or otherwise making the library revision
available through the consumer's approved dependency workflow:

1. Update the app's dependency/lockfile to that revision; do not patch
   `node_modules` or hand-edit generated artifacts.
2. Run `npm run contract:generate`, then `npm run lint:check:contract`.
3. Run `npm run check`. Baseline for this request: 110/114 tests pass; four
   discovery assertions fail because the two fields are missing. All four
   must pass without removing their contract equality checks.
4. Confirm the structured deployed test's discovery comparison still uses the
   same source contract. Deployed verification requires a separately approved
   app deployment; it is not implied by local library test success.

Updating discovery capabilities does not implement the consuming app's pending
eligibility policy. Record library support and application behavior separately.
No scope/egress, authentication, storage, retry engine, provisioning, or
application-specific behavior change is required by this capability request.
