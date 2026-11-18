# Official schema fixtures

<!-- cspell:words openrpc -->

These test-only fixtures allow deterministic, offline validation of source and
discovered OpenRPC documents. No production validation dependency was added.

- `openrpc-1.3.2.schema.json`: the unmodified `openrpcDocument` export, serialized
  as JSON, from `@open-rpc/meta-schema` **1.14.9** (supports OpenRPC 1.3.2).
  Source: <https://registry.npmjs.org/@open-rpc/meta-schema/-/meta-schema-1.14.9.tgz>.
  License: `openrpc-LICENSE` (Apache-2.0).
- `json-schema-tools.schema.json`: the unmodified `jsonSchema` export, serialized
  as JSON, from `@json-schema-tools/meta-schema` **1.8.3**, referenced by the
  OpenRPC schema. Source:
  <https://registry.npmjs.org/@json-schema-tools/meta-schema/-/meta-schema-1.8.3.tgz>.
  License: `json-schema-tools-LICENSE` (Apache-2.0).

The Ajv harness registers both upstream URL spellings locally. It disables
schema self-validation (the upstream custom meta-meta-schema is not draft-07)
and format checking, but validates documents using the complete released schema.
Library-specific uniqueness and retry-subset rules are tested separately.
