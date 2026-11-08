# JSON-RPC Backbone: initial library specification

<!-- cspell:words webtrigger Rovo -->

Status: review draft. V1 security decisions below describe an **internal-use,
Jira-backed default**, not an authentication profile for distributable cloud apps.
This is a specification, not a claim that the library has been implemented,
deployed, or security-validated.

## Problem Statement

A Forge app author wants
to describe application operations once
in an [OpenRPC](https://www.open-rpc.org/) document,
implement them without embedding JSON-RPC
or Forge transport details in business logic,
and test them through a stable request/response interface.
The same JSON-RPC endpoint can also be a useful production API.
Today the author has to assemble
contract generation,
runtime validation,
a dispatcher,
webtrigger ingress,
and security policy separately.
That invites drift between
the spec,
typed callers,
real behavior,
and deployed responses.

The [reference exploration](https://github.com/ibuchanan/explore-forge-json-rpc-backbone/blob/main/specs/command-architecture-decision.md)
demonstrates a neutral executor,
a JSON-RPC dispatcher,
an authenticated webtrigger,
and generated contract artifacts in one app.
It does **not** prove a reusable package,
a second consumer,
native trigger delivery,
or compatibility with generic `@forge-ahead/triggers` response helpers.
Those are distinct claims.

## Solution

Provide a spec-first command interface,
a sans-I/O in-memory JSON-RPC dispatcher,
OpenRPC-derived contracts and precompiled Ajv validators,
and a separate Forge webtrigger adapter.
The OpenRPC document is authoritative for
known method names,
named parameters,
successful outputs,
and documented errors.
Generated contracts are kept apart from
handwritten handlers,
execution policy,
and application normalization.
The core accepts values and trusted context and returns values;
it does not read environment variables,
access storage or HTTP,
or choose an authentication mechanism.
Handlers may perform app I/O through app-owned capabilities,
so the library does **not** claim that handler execution is pure.

V1 focuses on an app with a JSON-RPC webtrigger.
The protocol-independent command interface
must remain usable later by Forge Bridge `invoke()`,
Rovo/Automation Actions,
lifecycle, scheduled, and product triggers,
without forcing those callers to return JSON-RPC envelopes.
V1 does not deliver adapters for all of those surfaces.

## Vocabulary

- **Command:** named application operation,
  including reads, with input, output, and expected failures.
- **Handler:** app-owned implementation of a command.
- **Catalog:** build-time OpenRPC method definitions and generated contracts.
- **Exposure:** the runtime selection of catalog methods
  addressable at one endpoint.
  Exposure does not grant authority to execute.
- **Executor:** runs one selected handler
  with untrusted params and separately constructed trusted context,
  enforcing configured validation and execution rules.
- **Outcome:** semantic success or failure, independent of transport.
- **Dispatcher:** translates one supported JSON-RPC call
  into executor work and a JSON-RPC response.
- **Webtrigger adapter:** owns Forge HTTP ingress/egress
  and composes authentication, exposure, and dispatch.

## User Stories

1. As a Forge app author, I want to define operations in OpenRPC before writing
   handlers, so that the reviewed contract guides implementation.
2. As a command author, I want typed named parameters, outcomes, and trusted
   context kept separate, so that a payload cannot claim its own authority.
3. As an app maintainer, I want generation and a read-only drift check, so that
   changes to the spec cannot silently leave compiled handlers or callers stale.
4. As an app maintainer, I want reviewable generated artifacts separate from
   handwritten code, so that regeneration never overwrites business behavior.
5. As an app author, I want runtime input and output validation, so that untyped
   callers and faulty implementations cannot rely on TypeScript alone.
6. As a developer, I want to call a shared in-memory dispatcher in fast tests,
   so that I can verify command behavior without deployment or live credentials.
7. As an API consumer, I want one documented named-parameter JSON-RPC call and
   a correlated result or sanitized error, so that the API is predictable.
8. As an app author, I want an opt-in Forge webtrigger adapter, so that I need
   not reconstruct HTTP framing and RPC dispatch for every app.
9. As an app operator, I want production ingress to fail closed when required
   authentication or configuration is missing, so that testing support does not
   accidentally expose privileged operations.
10. As an app author, I want to choose which catalog methods are exposed at each
    endpoint at runtime, so that internal commands are not public by default.
11. As an authorized API consumer, I want `rpc.discover` to describe the methods
    currently exposed at this endpoint, so that I can inspect its actual contract
    rather than infer it from an internal static document.
12. As an app author, I want semantic command failures separated from JSON-RPC
    errors and native trigger completion, so that reuse does not imply shared
    retry or permission policy.
13. As a developer of a consuming app, I want short, linkable setup and drift
    instructions, so that its `DEVELOPMENT.md` can point contributors to the
    authoritative workflow.

## Security and development profiles

The fast test seam and deployed ingress share the same command contract, not an
unauthenticated webtrigger. Every OpenRPC command should have automated behavior
coverage through the dispatcher. A development installation may enable a separate
all-method **test profile** for web-eligible methods; the production build must
make this profile unavailable, and an internal-only method is never reachable over
HTTP. The development webtrigger still authenticates a current Jira admin on every
call. In-memory tests instead supply an explicitly trusted test principal; they
are not evidence that a deployed request is authorized. Do not force all tests to
run `asApp`: a method's execution mode and `asUser` rules still need coverage.

The internal-use v1 default authenticates **every** JSON-RPC webtrigger request,
including `rpc.discover`, using HTTP Basic with a Jira account email and API
token. The adapter uses the trusted installation Jira site, never a request-supplied
site URL or cloud ID. On each request it calls Jira to authenticate the token,
obtains the account ID from Jira rather than trusting the email as an identity
claim, and checks that account's current Jira `ADMINISTER` global permission.
There is no cache of identity or permission decisions. Jira unavailability,
missing configuration, bad credentials, and insufficient permission all stop
execution. The token is used for that request only: never persist or log it or
pass it to command handlers. Only the verified account ID and trusted
installation identity enter the command context. Treat credentials in headers
as sensitive, and require HTTPS; never accept them in params or query strings.
The adapter's authenticator is replaceable, but replacement must not silently
weaken exposure, execution-policy, or audit requirements.

HTTP Basic with customer Jira API tokens is **not a default for distributable
Forge cloud apps**; Atlassian's [Basic auth guidance](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
warns against apps collecting customer API tokens. Builders who need non-admin
callers, SaaS integrations, or distribution must provide and security-review a
different authenticator and its identity, consent, and authorization model. V1
has no library-managed bearer-credential issuance, secret store, rotation,
revocation, or admin credential-management commands. App-owned admin operations
can still use the same JSON-RPC dispatcher and webtrigger. Having a Forge
webtrigger URL never proves a caller is a site admin.

OpenRPC sets the reviewed maximum of web-eligible methods, execution modes,
and the minimum audit requirement per method. Methods default to not
web-eligible. Trusted installation configuration selects a runtime subset;
it cannot elevate an internal-only method or an `asUser` method to `asApp`.
The verified principal, method policy, and applicable Forge user-context checks
must all allow execution. Admin authentication is a prerequisite, not permission
to change a method's declared mode. For `asUser`, use only the account ID verified
by Jira; if Forge cannot act as that user, fail without `asApp` fallback. An
unexposed method appears unknown after authentication; an exposed method denied
by policy returns a distinct sanitized not-permitted error. Anonymous callers
cannot look up methods through JSON-RPC. Where Jira confirms missing permission,
return HTTP 403; invalid Basic credentials return generic HTTP 401; Jira timeout
or outage returns sanitized HTTP 503. None dispatches a handler. Do not log
credentials, raw headers, params, unverified identity claims, or raw exceptions.

A JSON-RPC ID correlates a response, **not** a write or a retry. V1 does not
promise replay prevention or idempotency. App-owned write handlers must document
whether retry is safe and supply durable idempotency where needed.

See [Audit events for authentication and authorization](audit-logging-for-auth.md)
for the v1 event policy and its replaceable publishing seam.

## Implementation Decisions

### Contract and generation

- The app's OpenRPC document is the source of truth for the **build-time**
  catalog. Generation emits exact wire method names, named parameter and result
  TypeScript types, typed handler-map/caller interfaces, and runtime validators.
  It does not emit working handlers, app authorization, Forge manifest modules,
  deployment configuration, or an HTTP client. Preserve ESM, CommonJS, and
  TypeScript declaration compatibility for the package, targeting Node.js 22.
- Use a bounded, documented OpenRPC/JSON Schema profile to start: the peer has
  demonstrated named object parameters (including empty objects), string,
  boolean, null and nullable shapes, required/optional properties, literal
  values, string limits, and local component references. Preserve dotted method
  names. Reject unsupported schema features, unresolved or external references,
  duplicate or colliding names, and positional parameter declarations with
  actionable generation errors. Do not fetch remote schemas during builds.
  Document the schema dialect and exact supported keywords before claiming
  broader compatibility. The peer's tests are evidence for this starting subset,
  not proof that arbitrary OpenRPC or JSON Schema is supported.
- Use build-time Ajv standalone compilation for runtime validators and keep the
  compiler out of the deployed runtime. Generate both input and successful-output
  validators, alongside static types, from the supported source schemas. Generated
  validators accept or reject: they do not silently trim, coerce, apply defaults,
  remove unknown properties, or transform values. Reject unknown named input fields
  by default. App-owned normalization is explicit and must be ordered and tested
  against validation; no generic transform is inferred from prose. Validate the
  resulting successful output before returning success. An invalid output or
  exception cannot imply rollback or safe retry of a preceding side effect.
  The separate [runtime-validation evaluation](openrpc-runtime-validation.md)
  motivates Ajv, but its broad performance and bundler claims need measurement
  in this package and its reference consumer.
- Generated types and validators are checked into the consuming app for review.
  A read-only generation/drift check runs in CI and fails if tracked artifacts
  differ; typechecking detects missing/extra handlers and caller mismatches.
  Provide a concise consumer development guide, directly linkable from an app's
  `DEVELOPMENT.md`, covering spec edits, regeneration, code review, drift checks,
  typecheck, and the distinction between generated and handwritten files.

### Execution and JSON-RPC

- Handlers receive named parameters and separately supplied trusted context,
  and return semantic success or failure using `@forge-ahead/errors` `Result`.
  Context/capabilities (for example installation identity or storage) and
  per-command policy are app-owned; untrusted request fields never become trusted
  context. The executor should expose a single reusable execution path and
  sanitize unexpected exceptions. Command failures do not contain HTTP status,
  JSON-RPC error codes, or native retry instructions. Reuse existing
  `@forge-ahead/errors` and `@forge-ahead/logging` only where their contracts
  actually fit; do not introduce a new generic error or logging framework.
- Support a deliberate **single-call subset of JSON-RPC 2.0**: one request
  object, `jsonrpc: "2.0"`, nonempty string method, named object `params`, and
  required string or finite-number `id`. Return one result/error response;
  preserve the ID only for correlation, not deduplication. Reject positional
  arrays, notifications (missing ID), null IDs, batches, and unsupported envelope
  fields without executing a handler. Malformed JSON, invalid envelopes, unknown
  methods, invalid params, and internal failures have documented, sanitized
  JSON-RPC error mappings. Do not claim full JSON-RPC 2.0 conformance; batches
  may be added later for a real consumer.
- The principal fast behavioral test seam is the in-memory dispatcher, with
  the public executor available for direct command/outcome assertions. The
  dispatcher must work without actual Forge infrastructure, HTTP calls, or a
  privileged test mode. Separate adapter tests verify HTTP behavior; slower
  deployed tests verify real Forge wiring. A forbidden response verifies denial,
  not successful execution of a method.
- Keep catalog, exposure, and execution permission distinct. OpenRPC is the
  single authoritative document: method-level reviewed extensions declare
  web eligibility (default none), allowed `asApp`/`asUser` execution modes,
  and minimum audit criticality. Trusted installation configuration may select
  only a subset of web-eligible methods at runtime, never widen the maximum
  or weaken audit requirements. A method not exposed at that endpoint cannot
  be invoked there even if it exists in the catalog. A verified principal
  must also pass the app's per-method policy. Runtime selection may change
  without redefining contracts; brand-new method definitions after build are
  out of v1 scope. Keep future registration possible without implementing it.

### Discovery and webtrigger

- Maintain one authoritative OpenRPC document. A separately served anonymous
  **view**, not another maintained source, filters it to the maximum web-eligible
  methods; it is documentation, not a claim that any installation enables them.
  Authenticated `rpc.discover` returns an OpenRPC view filtered further to the
  installation's **current** exposed methods, not a bare name list or a grant
  of permission to call all of them. Apply the same current-admin authentication
  before RPC dispatch and discovery. Filter referenced components transitively,
  avoid unreferenced/internal-only metadata, and never advertise a method that
  cannot be routed at that endpoint. An empty selection never leaks internal
  methods. Internal-only methods appear in neither web view, including in the
  development test profile. Test filtering from the one source document rather
  than maintaining a second contract.
- Offer a Forge webtrigger adapter distinct from the sans-I/O dispatcher. The
  baseline wire contract is POST with JSON, bounded request bytes, HTTP 200 with
  JSON for accepted RPC requests (including JSON-RPC errors), and HTTP-level
  rejection before dispatch for invalid method/media/size or failed ingress
  authentication. Specify error precedence, content types, status codes,
  duplicate-header handling, and the exact size limit in the adapter contract;
  expose only a small, justified set of configurable options. Do not freeze
  incidental Forge response-object field order or header casing where the
  public wire behavior is equivalent. HTTP status alone is not proof of command
  success. The adapter must not infer caller authority from request JSON.
- `@forge-ahead/triggers` owns generic trigger contracts; this package owns
  JSON-RPC framing. Reuse trigger helpers only if tests demonstrate compatible
  behavior; the peer's direct substitution was **deferred** because defaults
  changed its response shape and parse-error handling. No dependency cycle or
  gratuitous wrapper is required for the sake of an import.

### Audit event seam

- This library defines RPC-specific authentication, authorization, attempt, and
  outcome event types and their safe data, emitted as CloudEvents through an
  app-provided publisher. Keep the event schema/formatter and publisher port in
  a separately testable module so generic CloudEvents handling can later move
  to `@forge-ahead/logging`. That library's structured logs do not themselves
  constitute acknowledged publishing or a durable audit ledger. The publisher
  acknowledges acceptance; this library trusts that contract without requiring
  proof of durable retention. Events are unsampled by default and omit secrets,
  raw headers, params, unverified claims, and raw exceptions. Verified events
  carry installation identity, Jira-verified account ID, method where safe,
  decision, and a generated correlation ID. Failed authentication has no verified
  account ID or token-derived identifier.
- A reviewed OpenRPC method extension declares minimum audit criticality;
  trusted installation policy may strengthen but never weaken it. Audit-critical
  methods cannot be enabled without a publisher. Before their handlers start,
  the pre-execution decision/attempt CloudEvent must be acknowledged; failed or
  timed-out publishing fails closed, even if the event might have been accepted.
  After execution, publish an outcome event. If its publication fails after a
  successful write, return the successful command result and invoke the required
  operator failure callback; do not imply rollback, safety to retry, or a
  complete audit trail. Authentication failures and authorization denials emit
  best-effort events: publisher failure never changes a denied request into
  execution or masks its HTTP response, but invokes the failure callback.
  See [the audit-event specification](audit-logging-for-auth.md).

### Packaging and developer workflow

- Start with one package with separate runtime, JSON-RPC/webtrigger, and
  build-time tooling entry points. Supplying runtime and development capabilities
  does not itself decide how a consuming app declares the package in its
  `dependencies` and `devDependencies`; document the actual runtime import and
  deployment requirements. Keep Ajv compilers, generators, and build tools out
  of the deployed path. Re-export third-party tooling only when that provides
  a stable, demonstrable consumer benefit; don't promise wrappers for arbitrary
  package scripts. Keep package publication subject to separate approval.
- Provide consumer documentation for supported OpenRPC profile, endpoint
  configuration, generation/drift workflow, tests, and production security
  prerequisites. Do not mistake a local test pass for installed/deployed
  acceptance.

## Testing Decisions

- Test externally visible behavior at the public dispatcher and executor
  seams, with small complete webtrigger adapter tests and separate opt-in live
  Forge tests. Reuse the peer's request sequences, exact error fixtures, Unicode
  boundaries, authorization denials, and side-effect observations as prior art;
  assert the new package's documented wire contract rather than every incidental
  field of the peer's implementation.
- Compile consumer examples and negative type fixtures; generate twice to prove
  deterministic output and run a read-only drift check. Reject unsupported
  schemas, external references, collisions, positional params, and mismatched
  types/handlers. Verify that generated validation accepts supported nullable,
  literal, empty-object, and referenced shapes, rejects unknown fields, and
  never mutates input.
- Exercise malformed JSON, unsupported JSON-RPC forms, unknown/unexposed
  methods, denied calls, invalid params, output violations, unexpected errors,
  and writes followed by uncertain failure. Assert no handler side effects on
  rejection before execution, and no invented rollback or automatic retry after
  an uncertain write. Check endpoint-specific discovery against the selected
  exposure and against component/metadata leakage, including exposure changes
  between calls.
- Exercise HTTP ingress independently: Basic credentials against the trusted
  installation Jira site, fresh identity and `ADMINISTER` checks on every request,
  account ID binding for `asUser`, no fallback to `asApp`, malformed/duplicate
  Authorization headers, method/media/size rejection, and no dispatch after any
  rejection. Assert generic 401 for invalid credentials, 403 for a confirmed
  non-admin, and sanitized 503 on Jira unavailability. Never leak token, email,
  headers, params, or raw failures into responses or audit events. A local adapter
  fixture does not establish deployed authentication, Forge bundling, installation
  isolation, or correct native delivery.
- Test the one-document public and authenticated filtered views, runtime changes,
  production-build rejection of development-only exposure, and internal-only
  methods never appearing on HTTP. Exercise CloudEvents publisher acknowledgement,
  failure and timeout before a critical handler, best-effort events on denials,
  failed outcome publishing after a successful write, and the required operator
  failure callback. Test the event payload for safe attribution and absence of
  credentials and unverified claims.
- First adoption gate: the peer app consumes the package via its real dispatcher
  and webtrigger path and preserves agreed **high-level** specification, testing,
  and deployed behaviors. Low-level behavior may change deliberately if the
  documented public contract and consumer tests are revised together. Obtain
  separate permission for any deployment or live writes; preserve historical
  evidence as historical. A second consumer is needed before claiming general
  cross-app reuse. The internal-use default needs live security acceptance before
  any production-readiness claim; it does not establish distributable-app safety.

## Out of Scope for v1

- Full JSON-RPC conformance: batches, notifications, positional params, null IDs,
  streaming, or automatic retries/deduplication.
- Runtime definition of brand-new method contracts, generated business handlers,
  generated manifests, a CLI client, or automatic adapters for Bridge `invoke()`,
  Actions, scheduled/lifecycle/product triggers, and native retry values.
- Library-managed credential provisioning, storage, rotation, and revocation;
  a universally privileged test caller; built-in customer-distributable auth;
  automatic user consent, rollback, exactly-once writes, durable reconciliation,
  or a generic middleware/DI or event/workflow system.
- Guaranteed audit retention or tamper evidence from Forge logs or CloudEvents;
  `@forge-ahead/logging` migration without a separate decision.
- Publication, registration, installation, deployment, credential changes, or
  cross-repository edits solely because this spec exists.

## Further Notes and Open Decisions

- **Before internal-use production acceptance:** complete a security review and
  live test matrix for Jira Basic-token verification, permission checks, user
  impersonation, installation binding, transport/egress and Forge limitations,
  audit publishing, and absent/failed dependencies. A distributable app needs
  an independently designed and reviewed alternative authenticator.
- **Before freezing adapter API:** choose exact HTTP ingress defaults, error
  precedence, configurable limits, duplicate-header handling, and the size cap.
- **Before implementation:** settle the OpenRPC extension names and schema
  dialect/keyword matrix, the precise identity/permission verification calls,
  public-document serving surface, generated artifacts, and package boundaries;
  verify Ajv standalone output in Node.js 22, both package module formats, and
  the Forge bundler. Benchmark only if making performance or size claims.
- The peer's [outbound seed](https://github.com/ibuchanan/explore-forge-json-rpc-backbone/blob/main/specs/outbound/forge-ahead-commands.md)
  and [runtime reference](https://github.com/ibuchanan/explore-forge-json-rpc-backbone/blob/main/docs/reference/reference.md)
  are useful prior art, not a binding specification for this package.
