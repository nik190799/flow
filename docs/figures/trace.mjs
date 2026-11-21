// Runs the reference app's story on the real FlowHost in Node and returns what happened.
// The architecture figures in docs/ are drawn from this run, so every code and timing in them is measured.
import { readFileSync } from "node:fs";
import { FlowHost, generateKey, asText, asSpeech, asTools } from "../../src/index.js";
import { keyringDoc, sealKeyring, sealRelease, sealFunction, sealGrant } from "../../src/author.js";
import { sha256hex } from "../../src/bytes.js";

export async function trace() {
  const blobs = new Map(), H = {};
  for (const f of ["app", "app_v2", "checklist", "checklist_v2", "digest", "exporter"]) {
    const b = new Uint8Array(readFileSync(new URL(`../../examples/workorders/layers/${f}.wasm`, import.meta.url)));
    H[f] = sha256hex(b); blobs.set(H[f], b);
  }
  const fetched = new Set();
  const fetchBlob = async (h) => { fetched.add(h); return blobs.get(h); };
  const app = "example.workorders";
  const [root, release, ana, agent] = await Promise.all([1, 2, 3, 4].map(() => generateKey("p256")));
  const [rootQ, spare] = await Promise.all([1, 2].map(() => generateKey("slh-dsa-sha2-128s")));
  const keyring = await sealKeyring(keyringDoc({ keyring: 1, app, spare, roles: { root: [{ keys: [root] }, { keys: [rootQ] }], release: [{ keys: [release] }] } }), [root, rootQ]);
  const companyRelease = (version, layer) => sealRelease({
    app,
    manifest: { app, version, layers: { main: layer }, order: ["main"], keys: { main: { own: ["jobs.", "draft"] } }, caps: { main: [] } },
    data: { "jobs.": "personal", "draft": "personal" },
    capabilities: { upload: { egress: true }, haptic: { egress: false } },
    core: ["main"],
    directions: { side: { read: ["jobs."], caps: ["upload", "haptic"], egress: "public", max: 4, after: "main" } },
  }, [release]);

  let frames = [];
  const host = await FlowHost.create({ keyring, onRender: (t) => { frames = t; }, capabilities: { upload: async () => {}, haptic: async () => {} } });
  [["Replace intake filter", "Unit 4"], ["Boiler service", "12 Mill Lane"], ["Check pressure valve", "Dock 2"]]
    .forEach(([t, s], i) => { host.kv.set(`jobs.${i}.title`, t); host.kv.set(`jobs.${i}.site`, s); host.kv.set(`jobs.${i}.done`, 0); });
  host.kv.set("jobs.n", 3);

  const steps = [];
  const timed = async (name, fn) => { const t = performance.now(); const r = await fn(); steps.push({ name, ok: r.ok, code: r.code ?? null, reason: r.reason ?? null, ms: +(performance.now() - t).toFixed(1) }); return r; };
  const fn = (id, seq, layer, more = {}) => ({ app, direction: "side", id, seq, layer, ...more });

  await timed("release-1", async () => host.apply(await companyRelease(1, H.app), fetchBlob));
  host.enrolPerson({ ...ana, name: "Ana" });
  const mainBox = () => host.llp.slots.get("main")?.box;
  const coreBefore = mainBox();
  await timed("ana-checklist", async () => host.installFunction(await sealFunction(fn("checklist", 1, H.checklist, { reads: ["jobs."], intent: "My own packing list" }), ana), fetchBlob));
  const coreAfterFn = mainBox();
  const grant = await sealGrant({ app, agent, directions: ["side"], notAfter: Date.now() + 600_000, caps: [] }, ana);
  await timed("agent-next-up", async () => host.installFunction(await sealFunction(fn("next-up", 2, H.digest, { reads: ["jobs."], intent: "Show the next open job" }), agent, grant), fetchBlob));
  await timed("ana-export", async () => host.installFunction(await sealFunction(fn("export", 3, H.exporter, { reads: ["jobs."], caps: ["upload"] }), ana), fetchBlob));
  const fnBox = host.llp.slots.get("fn.side.checklist")?.box;
  await timed("release-2", async () => host.apply(await companyRelease(2, H.app_v2), fetchBlob));
  const fnKept = host.llp.slots.get("fn.side.checklist")?.box === fnBox;
  await timed("ana-checklist-v2", async () => host.installFunction(await sealFunction(fn("checklist", 4, H.checklist_v2, { reads: ["jobs."], intent: "Count what is packed" }), ana), fetchBlob));
  await timed("ana-undo", async () => host.undoFunction("fn.side.checklist"));
  const running = host.inspect();
  const value = (k) => String(host.kv.get(k) ?? "");
  const surfaces = {};
  for (const f of frames) {
    surfaces[f.slot] = { text: asText(f.tree, value), speech: asSpeech(f.tree, value), tools: asTools(f.slot, f.tree) };
  }
  return { steps, coreUntouchedByFunction: coreBefore !== undefined && coreAfterFn === coreBefore, leakCodeNeverFetched: !fetched.has(H.exporter), functionKeptAcrossRelease: fnKept, surfaces, running };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await trace(), null, 2));
