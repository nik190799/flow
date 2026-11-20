#!/bin/sh
# Builds the example's layers as WebAssembly 1.0.
set -e
cd "$(dirname "$0")"
for f in app app_v2 checklist checklist_v2 digest exporter; do npx asc $f.ts -o $f.wasm -O3 --disable mutable-globals,sign-extension,nontrapping-f2i,bulk-memory; done
