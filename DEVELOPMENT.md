# Development

Install dependencies with `npm install`.
Run the checks before sending a pull request:

```sh
npm run lint
npm run lint:docs
npm run format:check
npm run typecheck
npm run test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution process.

## Repository layout

- `.atlassian/`: Repository ownership metadata.
- `src/`: TypeScript source code.
- `docs/`: Diataxis guides, reference, explanations, and tutorials.
- `specs/`: Specifications and reference material; excluded from Biome checks.
- `dist/`: Build output; ignored by Git and excluded from Biome checks.
- `tests/`: Bun tests for source code and workflows.
- `scripts/`: Library build helpers.
