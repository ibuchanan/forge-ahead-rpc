# In-memory command and JSON-RPC reference

<!-- markdownlint-disable MD013 -->
<!-- cspell:words webtrigger -->

`createExecutor(options)` returns `execute(method, params, trustedContext)`,
a promise of `@forge-ahead/errors` `Result`. The caller supplies trusted
context separately from untrusted params; request fields never become context.
`options` holds `handlers`, `inputValidators`, and `outputValidators`, all
keyed by wire method name. A method requires all three entries to be routable.
Handlers return a promise of a semantic `Result`; expected error values are
not exposed to RPC callers. The executor returns `method-not-found`,
`invalid-params`, `command-failed`, or `internal-error` on failure. Validation
and handler exceptions map to `internal-error` except rejected input, which
maps to `invalid-params`.

`createDispatcher(options)` returns `dispatch(request, trustedContext)`, a
promise of one JSON-RPC response. `request` may be a parsed value or a JSON
string. It supports a **single-call subset of JSON-RPC 2.0**, not full
conformance: a single object with exactly `jsonrpc: "2.0"`, nonempty string
`method`, named object `params`, and required string or finite-number `id`.
Empty params objects and empty string IDs are valid. Batches, notifications,
positional arrays, null/non-finite IDs, and extra envelope fields are rejected
before execution. No authentication, exposure policy, HTTP handling, or Forge
context is provided by this in-memory API.

| Condition                                 |   Code | Message          | Response ID                         |
| ----------------------------------------- | -----: | ---------------- | ----------------------------------- |
| Malformed JSON string                     | -32700 | Parse error      | `null`                              |
| Invalid envelope or unsupported form      | -32600 | Invalid request  | Valid supplied ID, otherwise `null` |
| Unknown or incompletely configured method | -32601 | Method not found | Supplied ID                         |
| Invalid named params                      | -32602 | Invalid params   | Supplied ID                         |
| Handler's expected failure                | -32000 | Command failed   | Supplied ID                         |
| Exception or invalid successful output    | -32603 | Internal error   | Supplied ID                         |

Successful calls return `{ "jsonrpc": "2.0", "id": …, "result": … }`.
Error calls return `{ "jsonrpc": "2.0", "id": …, "error": { "code": …,
"message": … } }`. Error messages contain no handler or validator detail.
An output validation failure can occur **after a handler's side effect**;
the dispatcher neither rolls it back nor retries it. IDs correlate responses
only; they do not provide idempotency or replay protection.

## Web-scoped in-memory dispatch

`createWebDispatcher({ catalog, webPolicy, handlers, inputValidators, outputValidators, selection, authorize })` returns `{ publicDocument, dispatch }`. Supply the authoritative OpenRPC document, generated `webPolicy` from that document, and the same complete handler/validator maps as `createDispatcher`. A policy/catalog mismatch fails at construction; it cannot widen the reviewed maximum. `publicDocument` is the maximum web-eligible OpenRPC view (not current availability); its method set is limited to fully routable methods. `selection(trustedContext)` supplies a trusted per-installation name-to-`asApp`/`asUser` map. If absent, nothing is selected. A name is exposed only when it is web-eligible, routable, selected, and its selected mode matches the reviewed mode. Selection may change between calls. `authorize(method, mode, trustedContext)` is app-owned and defaults to deny; it does not select a different execution mode.

`dispatch` expects authentication to have already completed. `rpc.discover` accepts empty named params and returns an OpenRPC view of the current selected methods; discovery is not an authorization grant. Unknown and unexposed methods both return `-32601 Method not found`; exposed methods denied by `authorize` return `-32001 Not permitted`. Both views omit internal methods, private extension metadata, and unreferenced component schemas. Do not use this in-memory API as a webtrigger on its own: it provides no authentication, Forge context checks, HTTP ingress, or audit publishing. These are separate integration prerequisites.

## Forge dynamic webtrigger adapter

Import `createWebtrigger` from `forge-ahead-rpc/webtrigger` (the opt-in
`./webtrigger` package subpath). Supply the same web dispatcher options plus
`installation(forgeContext)` (trusted installation identity),
`authenticate(authorization, installation)` (a fresh verification returning
`{ kind: "authenticated", principal }`, `{ kind: "unauthorized" }`,
`{ kind: "forbidden" }`, or `{ kind: "unavailable" }`), and
`context(installation, principal)` (the trusted handler context). Supply
`selection` explicitly; no selection or missing configuration fails closed.
The adapter does **not** implement authentication or provide Forge user
impersonation: the app must verify credentials and installation binding. A
webtrigger URL is not an authentication mechanism. Forge's dynamic webtrigger
must pass its request and invocation context to the returned handler; no
manifest or deployment is generated here.

Ingress checks run in this order: POST only (405), well-formed array-valued
headers and no duplicate `Content-Type` or `Authorization` values even across
header casing (400), `application/json` optionally followed by
`; charset=utf-8` (415), string body (400), at most 65,536 UTF-8 body bytes
(413), nonempty authorization header (401), trusted configuration and
installation (503), then authentication (401 invalid, 403 denied, 503
unavailable or exception). A successful authentication is required before
`rpc.discover` or any RPC call. HTTP rejections return
`Content-Type: application/json; charset=utf-8` and a generic JSON
`{"error":"Request rejected"}` body, never a JSON-RPC response or raw
exception. Accepted requests, including JSON-RPC parse, method and validation
errors, return HTTP 200 with the same content type and the JSON-RPC response
body. Response headers use Forge's array-valued format. No retry or rollback
is implied by a 503 after an uncertain operation. The app must ensure its
custom authenticator meets the security requirements of its deployment;
this adapter alone does not claim deployed security validation.
