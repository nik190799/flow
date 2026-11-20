// Revision B1: a person's own functions in the directions the company opened, data labels, grants, undo.
import { readFileSync } from "node:fs";
import { check, done, keys } from "./lib.mjs";
import { FlowHost, asText } from "../src/index.js";
import { keyringDoc, sealKeyring, sealRelease, sealFunction, sealGrant } from "../src/author.js";
import { sha256hex } from "../src/bytes.js";

const L = {}, H = {}, blobs = new Map();
for (const n of ["tasks", "tasks_v2", "streak", "streak_v2", "crash", "spoof", "share", "leak"]) {
  L[n] = new Uint8Array(readFileSync(new URL(`../layers/${n}.wasm`, import.meta.url)));
  H[n] = sha256hex(L[n]); blobs.set(H[n], L[n]);
}
const fetchBlob = async (h) => blobs.get(h);
const textOf = (n) => !n ? "" : n.k === "text" ? n.t : (n.c || []).map(textOf).join(" ");

const app = "demo.tasks";
const [r1, rel, ana, ben, agent, stranger] = await keys("p256", 6);
const [q1, spare] = await keys("slh-dsa-sha2-128s", 2);
const keyring = await sealKeyring(keyringDoc({ keyring: 1, app, spare, roles: { root: [{ keys: [r1] }, { keys: [q1] }], release: [{ keys: [rel] }] } }), [r1, q1]);

const KEYS = { main: { own: ["tasks.", "draft", "migrated.", "catalog.", "vault."] } };
const DATA = { "tasks.": "personal", "draft": "personal", "catalog.": "public", "vault.": "secret" };
const CAPS = { haptic: { egress: false }, net: { egress: true } };
const PANEL = { read: ["tasks.", "catalog."], caps: ["net", "haptic"], egress: "public", max: 2, after: "main" };
const release = (version, { layer = H.tasks, directions = { panel: PANEL }, extra = {}, manifest = {} } = {}) =>
  sealRelease({ app, manifest: { app, version, layers: { main: layer }, order: ["main"], keys: KEYS, caps: { main: ["haptic"] }, ...manifest }, data: DATA, capabilities: CAPS, core: ["main"], directions, ...extra }, [rel]);
const fnDoc = (id, seq, layer, more = {}) => ({ app, direction: "panel", id, seq, layer, ...more });

let now = Date.UTC(2026, 10, 20);
let screen = "";
const net = [];
const mk = (opts = {}) => FlowHost.create({ keyring, now: () => now, onRender: (t) => { screen = t.map((s) => textOf(s.tree)).join(" | "); }, capabilities: { net: async (a) => { net.push(a); }, haptic: async () => {} }, ...opts });

// ---------- a person's function ----------
const host = await mk();
let r = await host.installFunction(await sealFunction(fnDoc("streak", 1, H.streak, { reads: ["tasks."] }), ana), fetchBlob);
check("F1 before any release runs, a function is refused", !r.ok && r.code === "not_open");
await host.apply(await release(1), fetchBlob);
host.setBound("main", "draft", "Write spec"); await host.dispatch("main", "add");
host.setBound("main", "draft", "Ship demo"); await host.dispatch("main", "add");
await host.dispatch("main", "t:0");

r = await host.installFunction(await sealFunction(fnDoc("streak", 1, H.streak, { reads: ["tasks."] }), ana), fetchBlob);
check("F2 a function signed by a key that isn't enrolled on the device is refused", !r.ok && r.code === "untrusted", r.reason);
const anaKid = host.enrolPerson({ ...ana, name: "Ana" });
const mainBox = host.llp.slots.get("main").box;
r = await host.installFunction(await sealFunction(fnDoc("streak", 1, H.streak, { reads: ["tasks."], intent: "Show my streak next to the tasks" }), ana), fetchBlob);
check("F3 the person's own function installs in the direction the company opened, with no company signature", r.ok && r.slot === "fn.panel.streak" && /My streak: 1 of 2 done/.test(screen), `${r.ms} ms`);
check("F4 the company's app wasn't restarted or changed by it", host.llp.slots.get("main").box === mainBox && host.running().main === H.tasks && host.version === 1);
check("F5 it appears where the direction says: right after the main slot", JSON.stringify(host.llp.order) === '["main","fn.panel.streak"]');
await host.dispatch("fn.panel.streak", "cheer"); await host.dispatch("fn.panel.streak", "cheer");
check("F6 it keeps its own data under its own keys", host.kv.get("fn/panel/streak/count") === 2 && /Cheers: 2/.test(screen));
const e = host.ledger.at(-1);
check("F7 the device's record names the person, the signing key and the stated intent", e.kind === "function" && e.person.kid === anaKid && e.person.name === "Ana" && e.signers[0] === ana.kid && e.intent.includes("streak") && e.grant === null);

// ---------- the direction is a fence ----------
r = await host.installFunction(await sealFunction({ ...fnDoc("x", 1, H.streak), direction: "sidebar" }, ana), fetchBlob);
check("F8 a function for a direction the company didn't open is refused", !r.ok && r.code === "not_open");
r = await host.installFunction(await sealFunction(fnDoc("x", 1, H.streak, { reads: ["vault."] }), ana), fetchBlob);
check("F9 a function asking for data its direction doesn't offer is refused", !r.ok && r.code === "exceeds_direction", r.reason);
r = await host.installFunction(await sealFunction(fnDoc("x", 1, H.streak, { caps: ["camera"] }), ana), fetchBlob);
check("F10 a function asking for a capability its direction doesn't offer is refused", !r.ok && r.code === "exceeds_direction");
r = await host.installFunction(await sealFunction(fnDoc("x", 1, sha256hex(new Uint8Array([1]))), ana), async () => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 12, 1, 0]));
check("F11 a function's code is checked like any layer (hash, WebAssembly 1.0)", !r.ok && ["blob", "not_wasm_1"].includes(r.code), r.code);
r = await host.installFunction(await sealFunction({ ...fnDoc("x", 1, H.streak), app: "other.app" }, ana), fetchBlob);
check("F12 a function signed for another app is refused", !r.ok && r.code === "wrong_app");

// ---------- data labels ----------
r = await host.installFunction(await sealFunction(fnDoc("leak", 1, H.leak, { reads: ["tasks."], caps: ["net"] }), ana), fetchBlob);
check("F13 a function that reads personal data and declares a capability that leaves the device is refused before it runs", !r.ok && r.code === "would_leak" && !host.llp.slots.has("fn.panel.leak"), r.reason);
host.kv.set("catalog.title", "Autumn list");
r = await host.installFunction(await sealFunction(fnDoc("share", 1, H.share, { reads: ["catalog."], caps: ["net"] }), ana), fetchBlob);
await host.dispatch("fn.panel.share", "send"); await new Promise((s) => setTimeout(s, 30));
check("F14 a function that reads only public data may send it out", r.ok && net.join() === "Autumn list");
r = await host.installFunction(await sealFunction(fnDoc("leak", 1, H.leak, { reads: ["tasks."] }), ana), fetchBlob);
check("F15 the direction's limit on how many functions it holds is enforced", !r.ok && r.code === "not_open" && /limit of 2/.test(r.reason));
await host.removeFunction("fn.panel.share");
r = await host.installFunction(await sealFunction(fnDoc("leak", 1, H.leak, { reads: ["tasks."] }), ana), fetchBlob);
net.length = 0;
await host.dispatch("fn.panel.leak", "send"); await new Promise((s) => setTimeout(s, 30));
check("F16 the same code installed without the net capability can't send: the call is refused at run time", r.ok && net.length === 0);
await host.removeFunction("fn.panel.leak");

// A release whose own non-core slot could leak is refused too.
r = await host.apply(await release(2, { manifest: { layers: { main: H.tasks, helper: H.leak }, order: ["main", "helper"], keys: { ...KEYS, helper: { read: ["tasks."] } }, caps: { main: ["haptic"], helper: ["net"] } } }), fetchBlob);
check("F17 a company release with a non-core slot that reads personal data and can send it out is refused", !r.ok && r.code === "would_leak" && host.version === 1, r.reason);
r = await host.apply(await release(2, { directions: { panel: { ...PANEL, read: ["vault."] } } }), fetchBlob);
check("F18 a release can't offer secret data to functions", !r.ok && r.code === "malformed");
r = await host.apply(await release(2, { manifest: { keys: { main: { own: ["tasks.", "draft", "fn/"] } } } }), fetchBlob);
check("F19 a release can't claim the keys kept for people's functions", !r.ok && r.code === "malformed");

// ---------- the company updates; the person's function is untouched ----------
const fnBox = host.llp.slots.get("fn.panel.streak").box;
r = await host.apply(await release(2, { layer: H.tasks_v2 }), fetchBlob);
check("F20 a company release swaps only the company's code; the function keeps running untouched, data intact", r.ok && r.swapped.join() === "main" && host.llp.slots.get("fn.panel.streak").box === fnBox && /Tasks v2/.test(screen) && /Cheers: 2/.test(screen) && r.paused.length === 0);
r = await host.apply(await release(1), fetchBlob);
check("F21 replay protection covers the company's own version numbers", !r.ok && r.code === "stale");

// ---------- update, then undo by the person ----------
r = await host.installFunction(await sealFunction(fnDoc("streak", 1, H.streak_v2, { reads: ["tasks."] }), ana), fetchBlob);
check("F22 an update must carry a higher seq", !r.ok && r.code === "stale");
host.enrolPerson({ ...ben, name: "Ben" });
r = await host.installFunction(await sealFunction(fnDoc("streak", 2, H.streak_v2), ben), fetchBlob);
check("F23 another person on the device can't replace Ana's function", !r.ok && r.code === "untrusted");
r = await host.installFunction(await sealFunction(fnDoc("streak", 2, H.streak_v2), ana), fetchBlob);
await host.dispatch("fn.panel.streak", "cheer");
check("F24 the update runs and changed the form of the function's data (schema 2)", r.ok && host.kv.get("fn/panel/streak/points") === 30 && host.kv.get("fn/panel/streak/count") === -1 && /Points: 30/.test(screen));
r = await host.undoFunction("fn.panel.streak");
check("F25 the person undoes it on the device: old code AND old data are back, across the data-format change", r.ok && r.seq === 1 && host.running()["fn.panel.streak"] === H.streak && host.kv.get("fn/panel/streak/count") === 2 && host.kv.get("fn/panel/streak/points") === undefined && /Cheers: 2/.test(screen), `${r.ms} ms`);
await host.dispatch("fn.panel.streak", "cheer");
check("F26 the undone function works", host.kv.get("fn/panel/streak/count") === 3);
check("F27 the undo didn't touch the company's app or data", host.version === 2 && host.kv.get("tasks.0.text") === "Write spec" && host.kv.get("tasks.n") === 2);
r = await host.installFunction(await sealFunction(fnDoc("streak", 2, H.streak_v2), ana), fetchBlob);
check("F28 the undone version can't be pushed back by replaying its document", !r.ok && r.code === "stale");
check("F29 the record shows the undo under the person's name", host.changesBy(anaKid)[0].kind === "undo" && host.changesBy(anaKid)[0].from === 2);

// ---------- an AI agent, under a grant ----------
const grant = await sealGrant({ app, agent, directions: ["panel"], notAfter: now + 600_000, caps: [] }, ana);
r = await host.installFunction(await sealFunction(fnDoc("crash", 1, H.crash), agent), fetchBlob);
check("F30 an agent's key alone means nothing to the device", !r.ok && r.code === "untrusted");
r = await host.installFunction(await sealFunction(fnDoc("crash", 1, H.crash, { intent: "A helper the agent wrote" }), agent, grant), fetchBlob);
const g = host.ledger.at(-1);
check("F31 with a grant from Ana, the agent's function installs; the record names the agent's key, Ana as accountable, and the grant", r.ok && g.signers[0] === agent.kid && g.person.name === "Ana" && g.grant?.notAfter === now + 600_000);
r = await host.installFunction(await sealFunction(fnDoc("net1", 1, H.share, { reads: ["catalog."], caps: ["net"] }), agent, grant), fetchBlob);
check("F32 the agent can't use a capability the grant didn't pass on", !r.ok && r.code === "untrusted", r.reason);
r = await host.installFunction(await sealFunction(fnDoc("crash", 2, H.crash), stranger, grant), fetchBlob);
check("F33 someone else can't borrow the grant", !r.ok && r.code === "untrusted");
const forged = await sealGrant({ app, agent, directions: ["panel"], notAfter: now + 600_000 }, stranger);
r = await host.installFunction(await sealFunction(fnDoc("crash", 2, H.crash), agent, forged), fetchBlob);
check("F34 a grant signed by someone who isn't enrolled is refused", !r.ok && r.code === "untrusted");
now += 601_000;
r = await host.installFunction(await sealFunction(fnDoc("crash", 2, H.crash), agent, grant), fetchBlob);
check("F35 after its time limit the grant no longer works", !r.ok && r.code === "expired", r.reason);
now -= 601_000;
await host.revokeGrant(g.grant.id);
r = await host.installFunction(await sealFunction(fnDoc("crash", 2, H.crash), agent, grant), fetchBlob);
check("F36 the person can end a grant early on the device", !r.ok && r.code === "untrusted" && /revoked/.test(r.reason));

// ---------- a function that fails doesn't take the app down ----------
await host.dispatch("fn.panel.crash", "boom");
const st = host.inspect().functions.find((f) => f.id === "crash");
check("F37 a function whose code fails is paused; the app and the other function carry on; its failed write is dropped", st.state === "paused" && st.paused.code === "layer_failed" && !host.llp.slots.has("fn.panel.crash") && /Tasks v2/.test(screen) && /Cheers: 3/.test(screen) && host.kv.get("fn/panel/crash/ran") === undefined);
r = await host.undoFunction("fn.panel.crash");
check("F38 the person undoes the agent's change; nothing of it is left", r.ok && r.seq === null && !host.functions.has("fn.panel.crash") && ![...host.kv.keys()].some((k) => k.includes("fn/panel/crash") || k.includes("fn.panel.crash")));

// ---------- the company narrows or closes a direction ----------
r = await host.apply(await release(3, { layer: H.tasks_v2, directions: { panel: { ...PANEL, read: ["catalog."] } } }), fetchBlob);
check("F39 when a release stops offering what a function reads, the release still lands and the function is paused, data kept", r.ok && r.paused[0]?.slot === "fn.panel.streak" && r.paused[0].code === "exceeds_direction" && !host.llp.slots.has("fn.panel.streak") && host.kv.get("fn/panel/streak/count") === 3);
r = await host.apply(await release(4, { layer: H.tasks_v2 }), fetchBlob);
check("F40 when a later release offers it again, the function comes back with its data", r.ok && r.paused.length === 0 && /Cheers: 3/.test(screen));
r = await host.apply(await release(5, { layer: H.tasks_v2, directions: {} }), fetchBlob);
check("F41 the company can close a direction: functions there are paused, not deleted", r.ok && r.paused[0]?.code === "not_open" && host.functions.has("fn.panel.streak"));
await host.apply(await release(6, { layer: H.tasks_v2 }), fetchBlob);

// ---------- text fields belong to their slot ----------
r = await host.installFunction(await sealFunction(fnDoc("spoof", 1, H.spoof), ana), fetchBlob);
host.kv.set("vault.pin", "1234");
check("F42 a function's text field can't write a key the function doesn't own", r.ok && host.setBound("fn.panel.spoof", "vault.pin", "0000") === false && host.kv.get("vault.pin") === "1234" && host.setBound("fn.panel.spoof", "fn/panel/spoof/note", "hi") === true);
const spoofTree = host.tree.find((s) => s.slot === "fn.panel.spoof").tree;
check("F43 and a presenter doesn't show it a key the function can't read", host.bound("fn.panel.spoof", "vault.pin") === "" && !asText(spoofTree, (k) => host.bound("fn.panel.spoof", k)).includes("1234") && host.bound("fn.panel.spoof", "fn/panel/spoof/note") === "hi");
await host.removeFunction("fn.panel.spoof");

// ---------- personal data leaving needs the person's own yes ----------
await host.apply(await release(7, { layer: H.tasks_v2, directions: { panel: { ...PANEL, egress: "personal" } } }), fetchBlob);
const leakFn = await sealFunction(fnDoc("leak", 2, H.leak, { reads: ["tasks."], caps: ["net"] }), ana);
r = await host.installFunction(leakFn, fetchBlob);
check("F44 where the company allows personal data out, the function still needs the person's yes on the device", !r.ok && r.code === "needs_consent", r.reason);
r = await host.installFunction(leakFn, fetchBlob, { consent: true });
net.length = 0; await host.dispatch("fn.panel.leak", "send"); await new Promise((s) => setTimeout(s, 30));
check("F45 with that yes it installs and can send", r.ok && net.join() === "Write spec");
r = await host.apply(await release(8, { layer: H.tasks_v2 }), fetchBlob);
check("F46 when the company lowers the ceiling again, that function is paused at once", r.ok && r.paused.some((p) => p.slot === "fn.panel.leak" && p.code === "would_leak") && !host.llp.slots.has("fn.panel.leak"));

// ---------- removing ----------
r = await host.removeFunction("fn.panel.streak");
check("F47 removing a function removes its code and everything it stored", r.ok && !host.llp.slots.has("fn.panel.streak") && ![...host.kv.keys()].some((k) => k.includes("panel/streak") || k.includes("panel.streak")) && host.kv.get("tasks.n") === 2);
const ins = host.inspect();
check("F48 inspect() says what runs and under whose name", ins.release.version === 8 && ins.release.signers[0] === rel.kid && ins.directions.panel.max === 2 && ins.functions.length === 1 && ins.functions[0].person.name === "Ana" && ins.people.length === 2);
await host.forgetPerson(anaKid);
check("F49 forgetting a person removes their functions and those functions' data", host.functions.size === 0 && !host.people.has(anaKid));
host.close();

// ---------- a device with no trusted clock ----------
const off = await mk({ clock: "untrusted", now: () => 0 });
await off.apply(await release(1), fetchBlob);
off.enrolPerson({ ...ana, name: "Ana" });
r = await off.installFunction(await sealFunction(fnDoc("crash", 1, H.crash), agent, await sealGrant({ app, agent, directions: ["panel"], notAfter: 10 ** 15 }, ana)), fetchBlob);
check("F50 a device that can't tell the time doesn't accept grants (their point is the time limit)", !r.ok && r.code === "untrusted", r.reason);
r = await off.installFunction(await sealFunction(fnDoc("streak", 1, H.streak, { reads: ["tasks."] }), ana), fetchBlob);
check("F51 but the person can still sign directly", r.ok);
off.close();

done("functions");
