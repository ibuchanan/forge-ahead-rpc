# JSON-RPC Backbone

`explore-forge-json-rpc-backbone` is an exploration
that inspires this library.
The core idea is to be able to write Forge Apps with "API first" principles.
Namely, that means using spec-driven development techniques
where an [OpenRPC](https://www.open-rpc.org/) spec
is the key binding between human-readable behaviors
and machine executable code.

The key challenge for this library is to balance the use of JSON-RPC
as an app's backbone for specification and integration testing,
while keeping flexibility for the same underlying "methods"
to support invocations from invocations from other Forge modules:

- Frontend UI as `invoke()`
- Backend wrapping into Actions (for both Automations & Rovo)
- Other triggers such as lifecycle, scheduled, and product

In some of those contexts,
we can't/shouldn't respond with the JSON-RPC contract,
or the Forge contract is effectively a "void function" with no reply at all.
The important thing is to create leverage,
not to lock everything into JSON-RPC.

This library should supply both the `depencencies` and `devDependencies`
to Forge Apps that build with this approach.
The `devDepencencies` will include
re-exports of OpenRPC linting, generators, and testing tools,
and Forge-specific "glue" tooling like package.json scripts.
The `dependencies` will include
re-exports of libraries needed by a consuming app
and Forge-specific "glue" for JSON-RPC over webtriggers.

This library should also make it safe to use
JSON-RPC as a testing seam in development environments,
while protecting production with enterprise-grade auth.

This library should be [sans-io](https://sans-io.readthedocs.io/),
with regard to HTTP, JSON-RPC, or any other network protocols.
The library builds on existing `@forge-ahead` capabilities:

- `errors` (Indeed, JSON-RPC has it's own set of standard errors that we might pull into `errors`)
- `logging`
- `triggers` (Esp for the Forge-specified parts of webtriggers)
