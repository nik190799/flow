// FlowHost end to end: FLOW decides trust, the unchanged LLP host runs and swaps the layers.
import { readFileSync } from "node:fs";
import { check, done, keys } from "./lib.mjs";
import { FlowHost } from "../src/index.js";
import { keyringDoc, sealKeyring, sealRelease } from "../src/author.js";
import { sha256hex } from "../src/bytes.js";

const read = (u) => new Uint8Array(readFileSync(u));
const tasks = read(new URL("../layers/tasks.wasm", import.meta.url));
const tasksV2 = read(new URL("../layers/tasks_v2.wasm", import.meta.url));
const llpTasks = read(new URL("../node_modules/live-layer-protocol/build/tasks.wasm", import.meta.url)); // AssemblyScript defaults: bulk memory on
const blobs = new Map([tasks, tasksV2, llpTasks].map((b) => [sha256hex(b), b]));
const fetchBlob = async (h) => blobs.get(h);
const H = (b) => sha256hex(b);

const app = "demo.tasks";
const [r1, r2] = await keys("p256", 2);
const [q1, spare] = await keys("slh-dsa-sha2-128s", 2);
const [rel, rel2, outsider] = await keys("p256", 3);
const k1 = await sealKeyring(keyringDoc({ keyring: 1, app, spare, roles: { root: [{ keys: [r1, r2], threshold: 1 }, { keys: [q1] }], release: [{ keys: [rel] }] } }), [r1, q1]);
const release = (version, layer, signer = rel, extra = {}) => sealRelease({ app, manifest: { app, version, layers: { main: H(layer) }, order: ["main"] }, ...extra }, [signer]);

let screen = "";
const textOf = (n) => !n ? "" : n.k === "text" ? n.t : (n.c || []).map(textOf).join(" ");
const host = await FlowHost.create({ keyring: k1, onRender: (t) => { screen = t.map((s) => textOf(s.tree)).join(" | "); } });

let r = await host.apply(await release(1, tasks), fetchBlob);
check("H1 a FLOW release runs on the unchanged LLP host", r.ok && screen.includes("Tasks"), screen.slice(0, 60));
host.llp.setBound("draft", "keep me"); await host.dispatch("main", "add");
check("H2 the app works: a task is added through the layer", host.kv.get("tasks.n") === 1);

r = await host.apply(await release(2, tasksV2), fetchBlob);
check("H3 a FLOW release swaps the layer live and keeps state", r.ok && screen.includes("Tasks v2") && host.kv.get("tasks.0.text") === "keep me", `${r.ms} ms`);

r = await host.apply(await release(3, tasks, outsider), fetchBlob);
check("H4 a release signed by a key outside the keyring never reaches LLP; v2 keeps running", !r.ok && r.code === "untrusted" && host.version === 2);

r = await host.apply(await release(3, llpTasks), fetchBlob);
check("H5 a layer built with post-1.0 WebAssembly features (bulk memory) is refused as not_wasm_1", !r.ok && r.code === "not_wasm_1" && host.version === 2, r.reason);

r = await host.apply(await release(4, tasks, rel, { expires: Date.now() - 60_000 }), fetchBlob);
check("H6 an expired release is refused on a device with a trusted clock", !r.ok && r.code === "expired");

// Rotate the release key through a keyring change, then old release keys stop working.
const k2 = await sealKeyring(keyringDoc({ keyring: 2, app, spare, roles: { root: [{ keys: [r1, r2], threshold: 1 }, { keys: [q1] }], release: [{ keys: [rel2] }] } }), [r1, q1]);
r = await host.updateKeyring(k2);
check("H7 the device moves to keyring 2", r.ok && host.keyring.keyring === 2);
r = await host.apply(await release(5, tasks), fetchBlob);
check("H8 the retired release key is refused after rotation", !r.ok && r.code === "untrusted");
r = await host.apply(await release(5, tasks, rel2), fetchBlob);
check("H9 the new release key is accepted, and LLP rolls back to v1 code with state intact", r.ok && host.version === 5 && host.kv.get("tasks.0.text") === "keep me");
r = await host.apply(await release(4, tasksV2, rel2), fetchBlob);
check("H10 LLP's own replay protection still applies behind FLOW (older version refused)", !r.ok && r.code === "stale");
host.close();

// A device with no trustworthy clock (its clock reads 1970), and an old engine that accepts any WebAssembly.
const offline = await FlowHost.create({ keyring: k1, clock: "untrusted", wasm: "any", now: () => 0, onRender: () => {} });
r = await offline.apply(await release(Date.UTC(2031, 0, 1), llpTasks, rel, { expires: 1 }), fetchBlob);
check("H11 clock: untrusted ignores expiry and LLP's 'too far ahead of now' check; wasm: any allows post-1.0 layers", r.ok, r.reason ?? "");
offline.close();

const trusted = await FlowHost.create({ keyring: k1, onRender: () => {} });
r = await trusted.apply(await release(Date.UTC(2031, 0, 1), tasks), fetchBlob);
check("H12 with a trusted clock, LLP still refuses a version years ahead of now", !r.ok && r.code === "bad_version", r.reason);
trusted.close();

done("host");
