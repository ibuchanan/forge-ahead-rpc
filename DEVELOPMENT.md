# Development

Install dependencies with `npm install`. After changing dependencies in
`package.json`, run `npm install --package-lock-only --ignore-scripts` to refresh
the npm lockfile, then install and run the checks. The npm lockfile and
pack/release lifecycle use npm; tests and TypeScript utilities use Bun. The
package stays `private` until an explicit publishing decision and
release-readiness review.

Run the checks before sending a pull request:

```sh
npm run lint
npm run lint:docs
npm run format:check
npm run typecheck
npm run test
```

## Coverage-backed complexity checks

Run `bun run check` for the ordered verification workflow: build production and
development artifacts, run coverage-backed lint, then check the existing package.
Builds finish before any tests consume `dist/`, and the test suite runs once.

Run `bun run lint` to collect coverage, convert it, and then run independent
analysis tasks in parallel. It requires existing build artifacts. Leaf commands
do not rebuild or run prerequisite tasks:

- `bun run test:coverage`: run tests and emit text and LCOV coverage.
- `bun run coverage:convert`: convert existing LCOV to `coverage/coverage-final.json`.
- `bun run lint:check:fallow`: analyze using existing converted coverage.
- `bun run pack:check`: validate the existing build without rebuilding it.
- `bun run test:profiles`: test existing production and development builds.

`release:check` delegates to `check`. The `prepare` lifecycle hook still builds
before installing Git hooks.
Coverage artifacts are Git-ignored; do not commit them. Repository helpers in
`scripts/` are excluded from Fallow analysis and Bun coverage; they do not have
a dedicated test suite.

The adapter in `scripts/coverage.mjs` maps LCOV line hits and TypeScript-parsed
function locations into Istanbul JSON. Fallow uses the measured lines within
matched functions for CRAP scoring. This is line coverage, not branch coverage
or measured function invocation counts. Functions without a matching report
(including subprocess-only code) retain Fallow's graph-based estimates.
The cognitive-complexity ceiling is 20; cyclomatic complexity and CRAP retain
Fallow's defaults of 20 and 30. Generated Ajv validators are excluded only from
complexity analysis. Shell-parser false positives in package scripts have exact
binary-name exclusions. Measured coverage does not remove cognitive-complexity
findings.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution process.

## Repository layout

- `.atlassian/`: Repository ownership metadata.
- `src/`: TypeScript source code.
- `docs/`: Diataxis guides, reference, explanations, and tutorials.
- `specs/`: Specifications and reference material; excluded from Biome checks.
- `dist/`: Build output; ignored by Git and excluded from Biome checks.
- `tests/`: Bun tests for source code and workflows.
- `scripts/`: Library build helpers.
