#!/bin/sh
# Rebuilds the calculator example's layers (WebAssembly 1.0, like every FLOW layer).
set -e
cd "$(dirname "$0")"
FLAGS="-O3 --disable mutable-globals,sign-extension,nontrapping-f2i,bulk-memory"
for f in pad_v1 pad_v2 deg split send; do npx asc src/$f.ts -o $f.wasm $FLAGS; done
