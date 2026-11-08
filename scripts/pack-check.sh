#!/usr/bin/env sh
set -eu

# Use the same lifecycle-free consumer tarball for both checkers.
export npm_config_ignore_scripts=true
npm pack --dry-run --ignore-scripts
package_dir=$(mktemp -d "${TMPDIR:-/tmp}/pack-check.XXXXXX")
trap 'rm -rf "$package_dir"' EXIT
trap 'exit 1' HUP INT TERM
npm pack --ignore-scripts --pack-destination "$package_dir"
publint --strict "$package_dir"/*.tgz
attw "$package_dir"/*.tgz
