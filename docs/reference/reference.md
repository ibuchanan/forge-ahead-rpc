# In-memory command and JSON-RPC reference

<!-- markdownlint-disable MD013 -->
<!-- cspell:words mypermissions webtrigger specversion -->

`createExecutor(options)` returns `execute(method, params, trustedContext)`,
a promise of `@forge-ahead/errors` `Result`. The caller supplies trusted
context separately from untrusted params; request fields never become context.
`options` holds `handlers`, `inputValidators`, and `outputValidators`, all
keyed by wire method name. A method requires all three entries to be routable.
Handlers return a promise of a semantic `Result`. Unknown handler failures
become `command-failed`; explicit `invalid-params`, `forbidden`, and
`internal-error` keep those sanitized categories. `rpcErrorCatalog` is the
library-owned `@forge-ahead/errors` catalog of protocol and command defaults.
Pass an app-owned `errorCatalog` created with `createProblemCatalog(baseUri,
definitions)` to register named failures or override built-in titles while
keeping their codes. Only registered names are returned by the executor;
the dispatcher projects each definition's `code` and `title` to public
`{ code, message }`, never its per-occurrence `detail` or `data`. App failures
must have codes from -32099 through -32002 and titles of 1–120 printable ASCII
characters; malformed app definitions fall back to `command-failed`.
Invalid built-in overrides fail at construction. The older `errorMap` option
remains supported for named failures, but cannot conflict with a catalog entry.
Unmapped failures never expose handler details. Handler exceptions and invalid
successful output become `internal-error`; rejected input becomes
`invalid-params`.

`createDispatcher(options)` returns `dispatch(request, trustedContext)`, a
promise of one JSON-RPC response. `request` may be a parsed value or a JSON
string. It supports a **single-call subset of JSON-RPC 2.0**, not full
conformance: a single object with exactly `jsonrpc: "2.0"`, nonempty string
`method`, named object `params`, and required string or finite-number `id`.
Empty params objects and empty string IDs are valid. Batches, notifications,
positional arrays, null/non-finite IDs, and extra envelope fields are rejected
before execution. No authentication, exposure policy, HTTP handling, or Forge
context is provided by this in-memory API.

| Condition                                 |             Code | Message          | Response ID                         |
| ----------------------------------------- | ---------------: | ---------------- | ----------------------------------- |
| Malformed JSON string                     |           -32700 | Parse error      | `null`                              |
| Invalid envelope or unsupported form      |           -32600 | Invalid request  | Valid supplied ID, otherwise `null` |
| Unknown or incompletely configured method |           -32601 | Method not found | Supplied ID                         |
| Invalid named params                      |           -32602 | Invalid params   | Supplied ID                         |
| Unmapped handler failure                  |           -32000 | Command failed   | Supplied ID                         |
| Explicit handler denial                   |           -32001 | Forbidden        | Supplied ID                         |
| Mapped application failure                | -32099 to -32002 | App-defined      | Supplied ID                         |
| Exception or invalid successful output    |           -32603 | Internal error   | Supplied ID                         |

Successful calls return `{ "jsonrpc": "2.0", "id": …, "result": … }`.
Error calls return `{ "jsonrpc": "2.0", "id": …, "error": { "code": …,
"message": … } }`. Error messages contain no handler or validator detail.
An output validation failure can occur **after a handler's side effect**;
the dispatcher neither rolls it back nor retries it. IDs correlate responses
only; they do not provide idempotency or replay protection.

## Web-scoped in-memory dispatch

`createWebDispatcher({ catalog, webPolicy, handlers, inputValidators, outputValidators, selection, authorize })` returns `{ publicDocument, dispatch }`. Supply the authoritative OpenRPC document, generated `webPolicy` from that document, and the same complete handler/validator maps as `createDispatcher`. A policy/catalog mismatch fails at construction; it cannot widen the reviewed maximum. `publicDocument` is the maximum web-eligible OpenRPC view (not current availability); its method set is limited to fully routable methods. `selection(trustedContext)` supplies a trusted per-installation name-to-`asApp`/`asUser` map. If absent, nothing is selected. A name is exposed only when it is web-eligible, routable, selected, and its selected mode matches the reviewed mode. Selection may change between calls. `authorize(method, mode, trustedContext)` is app-owned and defaults to deny; it does not select a different execution mode. For `asUser`, supply `canActAsUser(trustedContext)` to check that Forge can act as the Jira-verified account in trusted context (for example, by checking the app's user impersonation capability for that account). Only an explicit `true` permits execution; absent, false, or throwing checks return `-32001 Not permitted` without falling back to `asApp`. `asApp` does not require a user-context check. The app must bind both this check and the handler's user capability to the same verified account ID; neither may use an ID from params. Authentication as an admin does not override the reviewed mode or app-owned policy.

`dispatch` expects authentication to have already completed. `rpc.discover` accepts empty named params and returns an OpenRPC view of the current selected methods; discovery is not an authorization grant. Unknown and unexposed methods both return `-32601 Method not found`; exposed methods denied by `authorize` return `-32001 Not permitted`. Both views omit internal methods, private extension metadata, and unreferenced component schemas. Do not use this in-memory API as a webtrigger on its own: it provides no authentication, Forge user capability implementation, HTTP ingress, or audit publishing. These are separate integration prerequisites.

## Development test profile

`createTestProfileSelection(webPolicy, buildTarget, productionSelection)` returns a trusted selection callback for `createWebDispatcher` or `createWebtrigger`. Pass the generated `webPolicy` and a build-target constant, **not** a request or installation field. In a development build, `"development"` selects all reviewed web-eligible methods using their declared execution modes; internal-only methods remain unavailable over HTTP. In a production build, the compile-time gate disables this shortcut even if the runtime build target says `"development"`, and only the app-owned `productionSelection(trustedContext)` applies. Neither profile bypasses `authorize`, `canActAsUser`, or audit requirements.

The default `bun run build` creates a production bundle with the gate compiled off. `bun run build:development` creates a separate `dist-development/` bundle with the gate compiled on. Install the latter **only in a separate Forge development installation**; never deploy it as a production artifact. Keep the production bundle and installation distinct from the development test profile. `bun run test:profiles` builds both and verifies their exposure differs. In-memory `createDispatcher` tests should supply an explicit trusted test principal and exercise every catalog method, including internal-only ones; they do not establish deployed authentication or authorization. A development webtrigger must still use a current Jira-admin authenticator on every request, including discovery, and retain app-owned policy and Forge execution-context checks. No deployment or real Jira verification is claimed by these local tests.

## CloudEvents audit for web ingress

`createWebtrigger` accepts an optional `audit` port with `source` (stable
CloudEvents source URI), `identity(trustedInstallation)` returning
`{ installationId, environment }`, optional `accountId(verifiedPrincipal)`,
`publish(event): Promise<void>`, `onFailure(phase)`, and a positive finite
`timeoutMs`. A reviewed `critical` web method requires this port at adapter
construction. The app must provide a publisher whose resolved promise means
acknowledged delivery; a Forge log line is not an acknowledgement or durable
retention. This library does not implement persistence, retries, or sampling.

Events use CloudEvents 1.0 fields `specversion`, generated UUID `id`,
`source`, `type`, `time`, and `data`. The stable types are
`com.forge-ahead.rpc.authentication`, `.authorization`, `.attempt`, and
`.outcome`. Each request has a generated `data.correlationId`; data includes
trusted installation/environment, verified account ID when configured, a
reviewed method name where applicable, and a safe `reason` category:
`authenticated`, `invalid-credentials`, `not-admin`, `unavailable`,
`allowed`, `denied`, `unknown`, `started`, `succeeded`, or `failed`.
Raw requests, credentials, email, params, headers, unverified claims, and
exception details are not copied to events or the operator callback. The
app's identity and account-ID extractors must return only trusted, safe IDs.

Authentication and authorization decisions are published best-effort;
a publication failure calls `onFailure` without changing the 401/403/503
or denial. Critical attempts must receive acknowledgement before the handler
starts; publication rejection or timeout returns a sanitized JSON-RPC internal
error without executing it, even if delivery may have occurred. An outcome
publication failure calls `onFailure` but does not turn a successful write
into a retryable error. No rollback, automatic retry, audit completeness,
or durable retention is claimed. In-memory dispatcher tests can run without
a publisher; this does not verify deployed audit security.

## Forge dynamic webtrigger adapter

Import `createWebtrigger` from `forge-ahead-rpc/webtrigger` (the opt-in
`./webtrigger` package subpath). Supply the same web dispatcher options plus
`installation(forgeContext)` (trusted installation identity),
`authenticate(authorization, installation)` (a fresh verification returning
`{ kind: "authenticated", principal }`, `{ kind: "unauthorized" }`,
`{ kind: "forbidden" }`, or `{ kind: "unavailable" }`), and
`context(installation, principal)` (the trusted handler context). Supply
`selection` explicitly; no selection or missing configuration fails closed.
For **internal-use installations only**, `createJiraAdminAuthenticator(requestJira)`
provides the replaceable Jira-admin authenticator. `requestJira(url,
authorization)` is an app-supplied HTTPS Jira transport returning `{ status,
body }`; it must send the Authorization header only to the supplied URL and
must not log or retain it. The trusted installation supplies `jiraSiteUrl`
(an HTTPS site origin), not a request field. On **every** request (including
`rpc.discover`) it calls `/rest/api/3/myself` to verify Basic email/API-token
credentials and obtain Jira's account ID, then calls
`/rest/api/3/mypermissions?permissions=ADMINISTER` using the same credentials.
Only a positive `havePermission: true` permits dispatch; the principal contains
only Jira's verified `accountId`. The app's context factory must pass only that
account ID and trusted installation identity to handlers, not credentials,
email, or raw Jira responses. There is no identity or permission cache.
Malformed Basic and rejected credentials yield generic 401; confirmed
`havePermission: false` yields 403; malformed Jira responses, outages, and
missing trusted site yield sanitized 503. Query parameters and credential-named
fields in JSON-RPC params are rejected with HTTP 400 before authentication.
The app must use HTTPS and configure Forge egress for its trusted Jira site.
Customer-distributed apps and integrations admitting non-admin SaaS callers
must supply and security-review an alternative authenticator; this library
does not issue, store, or rotate credentials.
The adapter does not provide Forge user impersonation: the app must supply
and configure its authenticator, Jira transport, and trusted installation
binding. A webtrigger URL is not an authentication mechanism. Forge's dynamic webtrigger
must pass its request and invocation context to the returned handler; no
manifest or deployment is generated here.

An absent invocation context returns sanitized 503 before installation lookup,
authentication, or dispatch. The installation resolver still owns the
interpretation of a present trusted context.

Ingress checks run in this order: absent context (503), POST only (405), well-formed array-valued
headers and no duplicate `Content-Type` or `Authorization` values even across
header casing (400), `application/json` optionally followed by
`; charset=utf-8` (415), string body (400), at most 65,536 UTF-8 body bytes
(413), no query parameters or credential-named JSON-RPC params (400),
nonempty authorization header (401), trusted configuration and installation
(503), then authentication (401 invalid, 403 denied, 503 unavailable or
exception). A successful authentication is required before
`rpc.discover` or any RPC call. HTTP rejections return
`Content-Type: application/json; charset=utf-8` and a generic JSON
`{"error":"Request rejected"}` body, never a JSON-RPC response or raw
exception. Accepted requests, including JSON-RPC parse, method and validation
errors, return HTTP 200 with the same content type and the JSON-RPC response
body. Response headers use Forge's array-valued format. No retry or rollback
is implied by a 503 after an uncertain operation. The app must ensure its
custom authenticator meets the security requirements of its deployment;
this adapter alone does not claim deployed security validation.
