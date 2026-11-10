#!/usr/bin/env sh
set -eu

tsdown --no-dts
tsc -p tsconfig.declarations.json

bun run scripts/declarations.mjs
