#!/bin/sh
# Rebuilds the WebAssembly 1.0 test layers from LLP's own AssemblyScript sources (installed as the
# live-layer-protocol dependency). AssemblyScript turns on four post-1.0 features by default; FLOW
# layers turn them off so engines from 2017 on can run them.
set -e
cd "$(dirname "$0")"
LLP=../node_modules/live-layer-protocol
FLAGS="-O3 --disable mutable-globals,sign-extension,nontrapping-f2i,bulk-memory"
npx asc $LLP/layers/tasks-as/app.ts -o tasks.wasm $FLAGS
npx asc $LLP/layers/variants/tasks_v2.ts -o tasks_v2.wasm $FLAGS
npx asc $LLP/layers/variants/snoop.ts -o snoop.wasm $FLAGS
npx asc src/leak.ts -o leak.wasm $FLAGS
for f in streak streak_v2 crash spoof share; do npx asc src/$f.ts -o $f.wasm $FLAGS; done
