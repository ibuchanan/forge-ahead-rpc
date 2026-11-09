# Develop a Forge RPC consumer

<!-- markdownlint-disable MD013 -->
<!-- cspell:words webtrigger openrpc -->

This example is a local consumer fixture, **not** a deployed Forge app or a production-ready endpoint. Copy its `openrpc.json`, `generate.ts`, handwritten `handlers.ts`, `dispatcher.test.ts`, and generated directory into your app; adjust paths and commands for your app. Install `forge-ahead-rpc` and `@forge-ahead/errors` as application dependencies because the dispatcher and handler results are runtime imports. The generator is a separate build-time export (`forge-ahead-rpc/generator`); Ajv is bundled into that export and is not needed at runtime. Keep generator and typecheck/test tooling in the development workflow, never import the generator into a Forge handler.

## Edit, review, and verify

1. Edit `openrpc.json` using the [supported profile](../../docs/reference/openrpc-profile.md): OpenRPC 1.3.2, by-name params, a bounded JSON Schema draft-07 subset, and optional reviewed `x-forge-ahead` web policy.
2. Run `bun run examples/tracer/generate.ts generate` from the repository root. Review the diff to `generated/contract.ts`, `validators.js`, `validators.d.ts`, and `web-policy.ts`; commit all four alongside the spec. Keep business handlers handwritten.
3. Run `bun run examples/tracer/generate.ts check` in CI. This is read-only and fails on drift or missing artifacts. Run `bun run typecheck` for positive and `@ts-expect-error` negative type fixtures in `examples/tracer/contract-types.ts`; run `bun test examples/tracer/dispatcher.test.ts` for valid and invalid dispatch. For a separate consumer, adapt the typecheck fixture and its TS config to include it.
4. Build the package and run `bun run pack:check` to verify ESM, CommonJS, and declarations. Use a Node.js 22 Forge consumer runtime; local tests are not a substitute for installed Forge verification.

## Before enabling a webtrigger

- `createDispatcher` is transport-agnostic and does not authenticate. `createWebtrigger` expects an app-provided trusted installation extractor, authentication function, and context constructed only from verified installation and principal values. Never take identity from request params. `selection` defaults to **none**; generated `webPolicy` is only a maximum, not permission. Authorize each method explicitly and verify `asUser` can act as the verified Jira user; never fall back to `asApp`.
- `createJiraAdminAuthenticator` is **internal-use only**: supply a Jira request port that checks `/rest/api/3/myself` and `ADMINISTER` for the trusted installation site on every request. A distributable app needs a separately designed and reviewed alternative authenticator. Do not expose a URL until credentials, installation isolation, Forge permissions/egress, and error behavior have been verified on an installed app.
- The opt-in development test profile requires a **development build** (`bun run build:development`) and `createTestProfileSelection(webPolicy, "development", productionSelection)`. A production build cannot enable it through runtime settings. Use it for local tests only; it does not bypass authentication or authorization. Never deploy a development build as production.
- For reviewed `audit: "critical"` methods, configure `audit` with `source`, `identity(installation)` returning installation ID and environment, optional `accountId(principal)`, `publish(event): Promise<void>` that resolves **only after acknowledgement**, finite `timeoutMs`, and `onFailure(phase)` for operator alerts. The CloudEvents 1.0 envelope includes a correlation ID, verified attribution, phase, and reason, not request bodies or credentials. Failed or timed-out attempt publication blocks a critical write. Failed outcome publication after a successful write cannot undo it: surface the operator failure, do not retry blindly or claim a complete audit trail. Noncritical denial events are best effort. See [audit decisions](../../specs/audit-logging-for-auth.md).

This fixture demonstrates local behavior, not Forge bundling, live Jira verification, deployed transport security, or native audit delivery.
