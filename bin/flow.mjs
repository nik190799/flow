#!/usr/bin/env node
// flow: a small command-line tool for FLOW documents.
//
//   flow keygen <suite> <out.json>                 make a key (p256 or slh-dsa-sha2-128s); keep the file secret
//   flow seal <type> <payload.json> <key.json>...  sign a payload into an envelope (stdout)
//   flow cosign <env.json> <key.json>...           add signatures to an envelope (stdout)
//   flow reveal <key.json>                         mark a spare key so its signature carries its public key
//   flow check-wasm <file.wasm>...                 is each layer within WebAssembly 1.0?
//   flow install <bundle-dir> --first <keyring.json> [--clock untrusted] [--wasm any]
//                                                  install a bundle from files only, then print the screen
import { readFileSync, writeFileSync } from "node:fs";
import { generateKey, seal, cosign, wasm1Problem, FlowHost, installBundle } from "../src/index.js";

const [cmd, ...args] = process.argv.slice(2);
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = (v) => process.stdout.write(JSON.stringify(v, null, 2) + "\n");
const textOf = (n) => !n ? "" : n.k === "text" ? n.t : (n.c || []).map(textOf).join(" ");

switch (cmd) {
  case "keygen": {
    const [suite, file] = args;
    const k = await generateKey(suite);
    writeFileSync(file, JSON.stringify(k, null, 2), { mode: 0o600 });
    console.log(`${k.suite} key ${k.kid} written to ${file}`);
    break;
  }
  case "seal": { const [type, payload, ...keys] = args; out(await seal(type, readFileSync(payload), keys.map(readJson))); break; }
  case "cosign": { const [env, ...keys] = args; out(await cosign(readJson(env), keys.map(readJson))); break; }
  case "reveal": { out({ ...readJson(args[0]), reveal: true }); break; }
  case "check-wasm": {
    let bad = 0;
    for (const f of args) { const p = wasm1Problem(readFileSync(f)); if (p) bad++; console.log(`${f}: ${p ?? "WebAssembly 1.0"}`); }
    process.exitCode = bad ? 1 : 0;
    break;
  }
  case "install": {
    const first = opt("--first"), clock = opt("--clock", "trusted"), wasm = opt("--wasm", "1.0");
    let screen = "";
    const host = await FlowHost.create({ keyring: readJson(first), clock, wasm, onRender: (t) => { screen = t.map((s) => textOf(s.tree)).join(" | "); } });
    const r = await installBundle(host, args[0]);
    if (r.ok) await host.render();
    out({ ...r, keyring: host.keyring.keyring, version: host.version, screen });
    host.close();
    process.exitCode = r.ok ? 0 : 1;
    break;
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
    process.exitCode = cmd ? 1 : 0;
}
