# forge-ahead-rpc

<!-- markdownlint-disable MD013 -->
<!-- cspell:words webtrigger -->

[![Atlassian license](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](LICENSE) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

A spec-driven JSON-RPC dispatcher for Forge apps. Generate typed handlers and standalone validators from a bounded OpenRPC contract, then wire trusted app context to the runtime dispatcher. The optional webtrigger adapter requires app-owned authentication, authorization, and audit publishing; this package does not make an endpoint secure by itself.

## Try it locally

Use Node.js 22 and install the repository dependencies. This package is not published; no registry installation is available yet.

```sh
bun run build
bun run examples/tracer/generate.ts check
bun run typecheck
bun test examples/tracer/dispatcher.test.ts
```

The [consumer fixture](examples/tracer/DEVELOPMENT.md) shows the complete spec-edit, regeneration, drift-check, handler, dispatcher-test, and endpoint review workflow. Runtime exports are `forge-ahead-rpc` (`createDispatcher`, `createExecutor`, `createWebDispatcher`) and `forge-ahead-rpc/webtrigger` (`createWebtrigger`, the internal-use-only `createJiraAdminAuthenticator`). The separate `forge-ahead-rpc/generator` export is build-time tooling and must not be imported by deployed handlers.

See the [OpenRPC profile](docs/reference/openrpc-profile.md) and [development guide](DEVELOPMENT.md). Local tests do not establish deployed Forge security or production readiness.

## Contributions

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright (c) Atlassian US., Inc. Licensed under [Apache 2.0](LICENSE).
