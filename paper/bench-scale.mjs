// Scale benchmark for the paper: install N people's functions on one device, then ship a company
// release and undo one function with all N running. Run from the repo root:
//   node paper/bench-scale.mjs 50 200
import { readFileSync } from "node:fs";
import { FlowHost, generateKey } from "../src/index.js";
import { keyringDoc, sealKeyring, sealRelease, sealFunction } from "../src/author.js";
import { sha256hex } from "../src/bytes.js";

const blobs = new Map(), H = {};
for (const n of ["tasks", "tasks_v2", "streak", "streak_v2"]) {
  const b = new Uint8Array(readFileSync(new URL(`../layers/${n}.wasm`, import.meta.url)));
  H[n] = sha256hex(b); blobs.set(H[n], b);
}
const fetchBlob = async (h) => blobs.get(h);
const app = "demo.tasks";
const [r1, rel, ana] = await Promise.all([generateKey("p256"), generateKey("p256"), generateKey("p256")]);
const [q1, spare] = await Promise.all([generateKey("slh-dsa-sha2-128s"), generateKey("slh-dsa-sha2-128s")]);
const keyring = await sealKeyring(keyringDoc({ keyring: 1, app, spare, roles: { root: [{ keys: [r1] }, { keys: [q1] }], release: [{ keys: [rel] }] } }), [r1, q1]);
const DIRS = 4, dirs = {};
for (let d = 0; d < DIRS; d++) dirs[`d${d}`] = { read: ["tasks."], caps: [], egress: "none", max: 64, after: "main" };
const release = (version, layer) => sealRelease({ app, manifest: { app, version, layers: { main: layer }, order: ["main"], keys: { main: { own: ["tasks.", "draft", "migrated."] } }, caps: { main: [] } },
  data: { "tasks.": "personal", "draft": "personal" }, capabilities: {}, core: ["main"], directions: dirs }, [rel]);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const ms = async (f) => { const t = performance.now(); const r = await f(); return [performance.now() - t, r]; };

for (const N of process.argv.slice(2).map(Number)) {
  const host = await FlowHost.create({ keyring, onRender: () => {} });
  await host.apply(await release(1, H.tasks), fetchBlob);
  host.enrolPerson({ ...ana, name: "Ana" });
  const docs = [];
  for (let i = 0; i < N; i++) docs.push(await sealFunction({ app, direction: `d${i % DIRS}`, id: `f${i}`, seq: 1, layer: H.streak, reads: ["tasks."] }, ana));
  const inst = [];
  for (const d of docs) { const [t, r] = await ms(() => host.installFunction(d, fetchBlob)); if (!r.ok) throw new Error(`${r.code}: ${r.reason}`); inst.push(t); }
  const rss = process.memoryUsage().rss / 2 ** 20;
  const relEnv = await release(2, H.tasks_v2);
  const [tRelease, r2] = await ms(() => host.apply(relEnv, fetchBlob));
  if (!r2.ok) throw new Error(`release: ${r2.code} ${r2.reason}`);
  const running = Object.keys(host.running()).filter((s) => s.startsWith("fn.")).length;
  const [tUndo, u] = await ms(() => host.undoFunction("fn.d0.f0"));
  const [tRender] = await ms(() => host.render());
  console.log(JSON.stringify({ functions: N, install_first_ms: +inst[0].toFixed(1), install_median_ms: +med(inst).toFixed(1), install_last_ms: +inst.at(-1).toFixed(1),
    release_with_all_running_ms: +tRelease.toFixed(1), functions_still_running_after_release: running, undo_ms: +tUndo.toFixed(1), undo_ok: u.ok, render_ms: +tRender.toFixed(1), rss_mb: Math.round(rss) }));
  await host.close();
}
