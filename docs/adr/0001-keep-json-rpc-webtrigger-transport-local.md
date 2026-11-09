# 0001: Keep JSON-RPC webtrigger transport in this package

<!-- cspell:words webtrigger -->

- Status: Accepted
- Date: 2026-11-09

## Context

`forge-ahead-rpc/webtrigger` authenticates requests before JSON-RPC dispatch,
including discovery and malformed JSON. It returns a fixed HTTP wire contract.
`@forge-ahead/triggers/webtrigger` supplies generic Forge types, response
builders, a handler type-checking adapter, and a JSON body parser. It does not
implement this endpoint's security or JSON-RPC semantics.

The RPC adapter returns `application/json; charset=utf-8` for accepted calls
(including JSON-RPC errors) and pre-dispatch HTTP rejections. Rejections contain
only `{"error":"Request rejected"}`. The generic `buildSuccessResponse` instead
returns `application/json` and includes `statusText`. The generic
`buildErrorResponse` emits Problem Details rather than this endpoint's rejection.
`parseJsonBody` rejects malformed JSON at HTTP ingress, whereas this endpoint
must authenticate first and then return a JSON-RPC parse error with HTTP 200.
`buildErrorCodeResponse` could build a rejection with explicit headers but would
still leave success responses, parsing order, authentication, policy, and audit
behavior local.

## Decision

Do not add `@forge-ahead/triggers` as a runtime dependency solely to replace the
small local response constructor or wrap this handler with `defineWebTrigger`.
Keep JSON-RPC ingress and response framing here. Apps can use the generic
trigger package independently for other trigger families and ordinary web
triggers. Preserve the documented response and authentication order rather than
changing wire behavior to match a generic helper.

## Consequences

- This package retains a few lines of response construction and narrower local
  request/response types; it does not inherit generic helper updates.
- It avoids an additional runtime dependency and transitive dependencies.
- Revisit reuse if a shared helper preserves the RPC wire contract and
  authentication-before-parse behavior without rebuilding the local response.
  Verify with ingress, authentication, and parse-error tests before migrating.

See [the JSON-RPC backbone specification](../../specs/json-rpc-backbone.md) and
[the webtrigger contract](../reference/reference.md#forge-dynamic-webtrigger-adapter).
