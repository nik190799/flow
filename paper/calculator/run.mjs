// The calculator worked example from the paper, run end to end on the FLOW host in Node.
//   node paper/calculator/run.mjs        (from the repo root; rebuild layers with paper/calculator/build.sh)
// The company ships a calculator that brings data (the display number) and primitives (digits, operators).
// It opens one direction, "fx", where people's own functions may read that number and draw their own UI.
import { readFileSync } from "node:fs";
import { FlowHost, generateKey, asText, asSpeech } from "../../src/index.js";
import { keyringDoc, sealKeyring, sealRelease, sealFunction, sealGrant } from "../../src/author.js";
import { sha256hex } from "../../src/bytes.js";

const H = {}, blobs = new Map();
for (const n of ["pad_v1", "pad_v2", "deg", "split", "send"]) {
  const b = new Uint8Array(readFileSync(new URL(`./${n}.wasm`, import.meta.url)));
  H[n] = sha256hex(b); blobs.set(H[n], b);
}
const fetchBlob = async (h) => blobs.get(h);
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const show = (title, s) => console.log(`\n--- ${title} ---\n${s}\n`);

const app = "example.calculator";
const [root, rel, ana, agent] = await Promise.all(["p256", "p256", "p256", "p256"].map(generateKey));
const [q, spare] = await Promise.all([generateKey("slh-dsa-sha2-128s"), generateKey("slh-dsa-sha2-128s")]);
const keyring = await sealKeyring(keyringDoc({ keyring: 1, app, spare, roles: { root: [{ keys: [root] }, { keys: [q] }], release: [{ keys: [rel] }] } }), [root, q]);
const release = (version, layer) => sealRelease({ app,
  manifest: { app, version, layers: { pad: layer }, order: ["pad"], keys: { pad: { own: ["calc."] } }, caps: { pad: [] } },
  data: { "calc.": "personal" },                 // the person's numbers
  capabilities: { net: { egress: true } },
  core: ["pad"],
  directions: { fx: { read: ["calc."], caps: [], egress: "none", max: 8, after: "pad" } },   // read the number, draw, send nothing
}, [rel]);

let now = Date.UTC(2026, 10, 21, 9, 0);
const host = await FlowHost.create({ keyring, now: () => now, capabilities: { net: async () => {} } });
const tree = () => (host.tree ?? []).flatMap((s) => (s.tree ? [s.tree] : []));
const screen = () => tree().map((t) => asText(t, (k) => host.bound("fn.fx.split", k))).join("\n\n");
const press = async (slot, ...ids) => { for (const id of ids) await host.dispatch(slot, id); };
const t = async (f) => { const t0 = performance.now(); const r = await f(); return [r, +(performance.now() - t0).toFixed(1)]; };

// 1. The company's calculator: 3 0 and nothing else.
let [r, ms] = await t(async () => host.apply(await release(1, H.pad_v1), fetchBlob));
check("C1 the company's calculator (release 1) runs", r.ok, `${ms} ms`);
await press("pad", "d3", "d0");
check("C2 its own primitives work: 3 0 shows 30", host.kv.get("calc.x") === 30);
await press("pad", "sin");
check("C3 its sin works in radians, as the company built it", Math.abs(host.kv.get("calc.x") - Math.sin(30)) < 1e-12, `sin(30 rad) = ${host.kv.get("calc.x").toFixed(6)}`);
await press("pad", "clr", "d3", "d0");

// 2. Ana asks for "sin and cos in degrees". She (or an agent writing for her) produces a function; she signs it.
const anaKid = host.enrolPerson({ ...ana, name: "Ana" });
[r, ms] = await t(async () => host.installFunction(await sealFunction({ app, direction: "fx", id: "deg", seq: 1, layer: H.deg, reads: ["calc."], intent: "Show sin and cos in degrees" }, ana), fetchBlob));
check("C4 Ana's own function installs beside the calculator, with no company signature and no restart", r.ok && host.running().pad === H.pad_v1, `${ms} ms`);
check("C5 it reads the calculator's number and draws its own UI: sin 30° = 0.5", /sin 30° = 0\.5\b/.test(screen()) && /cos 30° = 0\.866025/.test(screen()));
show("screen after Ana's degrees function", screen());

// 3. An AI agent writes a second function for her under a 10-minute grant: split the bill.
const grant = await sealGrant({ app, agent, directions: ["fx"], notAfter: now + 10 * 60e3 }, ana);
[r, ms] = await t(async () => host.installFunction(await sealFunction({ app, direction: "fx", id: "split", seq: 1, layer: H.split, reads: ["calc."], intent: "Split the bill, optional 15% tip" }, agent, grant), fetchBlob));
const rec = host.ledger.at(-1);
check("C6 the agent's function installs under Ana's grant; the device records Ana as answering for it", r.ok && rec.person?.kid === anaKid && rec.grant, `${ms} ms`);
await press("pad", "clr", "d1", "d2", "d0");            // a 120 bill
const tools = host.tools().filter((x) => x.slot === "fn.fx.split");
r = await host.act("fn.fx.split", "go", { "fn/fx/split/n": "4" });
await host.act("fn.fx.split", "tip");
check("C7 an agent (or a person) uses the new UI through the same declared actions: 120 between 4 with tip is 34.5 each", r.ok && /Each pays 34\.5\b/.test(screen()), tools.map((x) => x.action + (x.fields.length ? `(${x.fields.map((f) => f.hint)})` : "")).join(", "));
show("the split function, read aloud", asSpeech(tree()[2], (k) => host.bound("fn.fx.split", k)));

// 4. A function that wants to send the numbers out is refused before its code runs.
r = await host.installFunction(await sealFunction({ app, direction: "fx", id: "send", seq: 1, layer: H.send, reads: ["calc."], caps: ["net"] }, ana), fetchBlob);
check("C8 a function asking for the network is refused: this direction offers no way out", !r.ok && r.code === "exceeds_direction", `${r.code}: ${r.reason}`);

// 5. The company ships release 2 (√ and %) while both functions run.
[r, ms] = await t(async () => host.apply(await release(2, H.pad_v2), fetchBlob));
check("C9 the company's release 2 lands; both people's functions keep running, untouched", r.ok && host.running()["fn.fx.deg"] === H.deg && host.running()["fn.fx.split"] === H.split && /Each pays 34\.5\b/.test(screen()), `${ms} ms`);
await press("pad", "clr", "d1", "d4", "d4", "sqrt");
check("C10 the new primitive works and the functions follow the number: √144 = 12, 12 between 4 with tip is 3.45", host.kv.get("calc.x") === 12 && /Each pays 3\.45\b/.test(screen()) && /sin 12° = 0\.207912/.test(screen()));
show("screen after the company's release 2", screen());

// 6. Ana changes his mind: undo the agent's function on the device.
[r, ms] = await t(() => host.undoFunction("fn.fx.split"));
check("C11 Ana undoes the agent's function on the device; it and its data are gone, the calculator untouched", r.ok && !host.running()["fn.fx.split"] && ![...host.kv.keys()].some((k) => k.startsWith("fn/fx/split/")) && host.running().pad === H.pad_v2, `${ms} ms`);
now += 11 * 60e3;
r = await host.installFunction(await sealFunction({ app, direction: "fx", id: "split", seq: 2, layer: H.split, reads: ["calc."] }, agent, grant), fetchBlob);
check("C12 after ten minutes the agent can change nothing", !r.ok && r.code === "expired");
console.log("\nrecord:", host.ledger.map((e) => `${e.kind}${e.person ? " by " + e.person.name : ""}${e.grant ? " (agent under grant)" : ""}`).join("; "));
await host.close();
const failed = results.filter((x) => !x).length;
console.log(`\ncalculator: ${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
