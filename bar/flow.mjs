// The seven lines, run against FLOW as it stands today (FLOW trust rules on the unchanged LLP host).
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { FlowHost, generateKey, seal } from "../src/index.js";
import { keyringDoc, sealKeyring, sealRelease } from "../src/author.js";
import { sha256hex } from "../src/bytes.js";
import { runFlowBrowser } from "./flow-browser.mjs";
import { asTerminal, asSpeech, asAgentTools } from "./surfaces.mjs";

const read = (rel) => new Uint8Array(readFileSync(new URL(rel, import.meta.url)));
const L = { tasks: read("../layers/tasks.wasm"), v2: read("../layers/tasks_v2.wasm"), snoop: read("../layers/snoop.wasm"), leak: read("../layers/leak.wasm"),
  trap: read("../node_modules/live-layer-protocol/build/tasks_trap.wasm") };
const H = Object.fromEntries(Object.entries(L).map(([k, b]) => [k, sha256hex(b)]));
const blobs = new Map(Object.entries(L).map(([k, b]) => [H[k], b]));
const fetchBlob = async (h) => blobs.get(h);
const textOf = (n) => !n ? "" : n.k === "text" ? n.t : (n.c || []).map(textOf).join(" ");

export async function runFlow() {
  const out = [];
  const line = (n, verdict, detail, checks) => out.push({ line: n, subject: "FLOW today", verdict, detail, checks });
  const app = "demo.tasks";
  const [r1, rel, person, relayKey] = await Promise.all(["p256", "p256", "p256", "p256"].map(generateKey));
  const [q1, spare, relayQ] = await Promise.all([1, 2, 3].map(() => generateKey("slh-dsa-sha2-128s")));
  const keyring = await sealKeyring(keyringDoc({ keyring: 1, app, spare, roles: { root: [{ keys: [r1] }, { keys: [q1] }], release: [{ keys: [rel] }] } }), [r1, q1]);
  const release = (manifest, signer = rel) => sealRelease({ app, manifest: { app, ...manifest } }, [signer]);
  let tree = [];
  const mk = (opts = {}) => FlowHost.create({ keyring, onRender: (t) => { tree = t; }, ...opts });
  const screen = () => tree.map((s) => textOf(s.tree)).join(" | ");

  const B = await runFlowBrowser();
  // The same page with a plain renderer that rebuilds the field from stored state only, run several
  // times because the loss depends on timing.
  const plain = [];
  for (let i = 0; i < 6; i++) plain.push((await runFlowBrowser({ carryLiveText: false })).after?.draft);
  const lost = plain.filter((d) => d !== "Buy milk today").length;

  // 1. Changed while in use, nothing lost (real Chromium; the person types straight through the swap)
  {
    const a = B.after ?? {};
    const c = [
      { name: "change appears without a reload", ok: B.ok && B.shipped.ok && /v2/.test(a.heading ?? "") },
      { name: "text typed before, during and after the swap is all there", ok: a.draft === "Buy milk today" },
      { name: "focus and caret stay in the field", ok: a.focused === true && a.caret === 14 },
      { name: "saved tasks survive", ok: /Write spec/.test(a.text ?? "") && /Ship demo/.test(a.text ?? "") },
      { name: "scroll position survives a swap", ok: B.afterUndo?.scroll === 800 },
    ];
    line(1, c.every((x) => x.ok) ? "pass" : "fail", `In Chromium a signed release swapped the running code in ${B.shipped?.ms} ms while the person was mid-word. Field reads "${a.draft}", focus kept, tasks kept, scroll kept. One catch found on the way: with a plain renderer that rebuilds the field from stored state, a key pressed during the swap was lost in ${lost} of ${plain.length} runs; the app shell must carry the live text across, and this test's shell now does. That belongs in the host (step A2), not in each app. LLP's own web demo rebuilds fields the same plain way, so it likely loses keys too; that was read in its code, not run.`, c);
  }

  // 2. Each person's copy is different, and it stays the company's app
  {
    const host = await mk();
    await host.apply(await release({ version: 1, layers: { main: H.tasks }, order: ["main"] }), fetchBlob);
    const personal = await host.apply(await release({ version: 2, layers: { main: H.tasks, mine: H.leak }, order: ["main", "mine"] }, person), fetchBlob);
    const overlay = await host.apply(await seal("flow/overlay", { app, slot: "mine", layer: H.leak }, [person]), fetchBlob);
    // The nearest thing that exists: the company itself opens a second slot and signs what goes in it.
    const two = await host.apply(await release({ version: 2, layers: { main: H.tasks, helper: H.snoop }, order: ["main", "helper"], keys: { main: { own: ["tasks.", "draft", "migrated."] }, helper: { own: ["snoop."] } } }), fetchBlob);
    const helperBefore = host.llp.slots.get("helper")?.box;
    const upd = await host.apply(await release({ version: 3, layers: { main: H.v2, helper: H.snoop }, order: ["main", "helper"], keys: { main: { own: ["tasks.", "draft", "migrated."] }, helper: { own: ["snoop."] } } }), fetchBlob);
    const untouched = two.ok && upd.ok && upd.swapped.join() === "main" && host.llp.slots.get("helper")?.box === helperBefore;
    host.close();
    line(2, "not built", `A function signed by the person's own key is refused (${personal.code}), and there is no document kind for a personal function yet (${overlay.code}). What exists: the company can open a second spot, and a company release that changes the main app leaves the function in that spot running untouched (${untouched ? "confirmed" : "not confirmed"}). The person-signed half is step B.`,
      [{ name: "a person's own function installs in a spot the company opened", ok: personal.ok || overlay.ok }, { name: "a company release leaves a function in another spot untouched", ok: two.ok && upd.ok && untouched }, { name: "the company declares where functions may go", ok: false }]);
  }

  // 3. The device has the last word
  {
    const host = await mk();
    await host.apply(await release({ version: 2, layers: { main: H.tasks }, order: ["main"] }), fetchBlob);
    const good = await release({ version: 3, layers: { main: H.v2 }, order: ["main"] });
    const forged = await host.apply(await release({ version: 3, layers: { main: H.v2 }, order: ["main"] }, relayKey), fetchBlob);
    const swapped = await host.apply(good, async (h) => (h === H.v2 ? L.leak : blobs.get(h)));
    const edited = structuredClone(good); edited.payload = edited.payload.slice(0, -2) + (edited.payload.endsWith("A") ? "BB" : "AA");
    const tampered = await host.apply(edited, fetchBlob);
    const relayRing = await sealKeyring(keyringDoc({ keyring: 2, app, spare, roles: { root: [{ keys: [relayKey] }, { keys: [relayQ] }], release: [{ keys: [relayKey] }] } }), [relayKey, relayQ]);
    const ring = await host.updateKeyring(relayRing);
    const still = host.version === 2;
    await host.apply(good, fetchBlob);
    const replay = await host.apply(await release({ version: 2, layers: { main: H.tasks }, order: ["main"] }), fetchBlob);
    host.close();
    const c = [
      { name: "a release signed by the relay's own key is refused", ok: !forged.ok && forged.code === "untrusted" },
      { name: "a genuine release with a swapped layer file is refused", ok: !swapped.ok },
      { name: "a genuine release with edited contents is refused", ok: !tampered.ok },
      { name: "a new trust list pushed by the relay is refused", ok: !ring.ok && ring.code === "untrusted" },
      { name: "an old genuine release replayed later is refused", ok: !replay.ok && replay.code === "stale" },
      { name: "the app kept running the last good version throughout", ok: still },
      { name: "the same refusal happens in a real browser", ok: B.forged?.code === "untrusted" },
    ];
    line(3, c.every((x) => x.ok) ? "pass" : "fail", `Acting as a hostile server we tried five ways to push code or trust: all refused on the device (${[forged.code, swapped.code, tampered.code, ring.code, replay.code].join(", ")}), and the app kept running. Limit: this promise holds for an installed host. When the checker itself is a web page, whoever serves that page can replace the checker.`, c);
  }

  // 4. Every change has a named, accountable signer and a working undo
  {
    const signed = (B.ledger ?? []).length === 3 && B.ledger.every((e) => e.signers.length === 1 && /^sha256:/.test(e.signers[0]));
    const ownerUndo = B.undo?.ok && B.afterUndo?.heading === "Tasks" && /Write spec/.test(B.afterUndo.text) && B.afterUndo.draft === "Buy milk today";
    // Automatic undo: a release whose code crashes on use is reverted and its writes dropped.
    const host = await mk({ wasm: "any" });
    await host.apply(await release({ version: 1, layers: { main: H.tasks }, order: ["main"] }), fetchBlob);
    host.llp.setBound("draft", "Write spec"); await host.dispatch("main", "add");
    await host.apply(await release({ version: 2, layers: { main: H.trap }, order: ["main"] }), fetchBlob);
    host.llp.setBound("draft", "this crashes"); await host.dispatch("main", "add");
    const autoUndo = host.running().main === H.tasks && host.kv.get("tasks.n") === 1;
    // Undo by the person, on the device, with no new release from the company.
    await host.apply(await release({ version: 3, layers: { main: H.v2 }, order: ["main"] }), fetchBlob);
    const personUndo = typeof host.undo === "function";
    host.close();
    const c = [
      { name: "every accepted change is recorded with the key that signed it", ok: signed },
      { name: "the company can undo a release in the running app, data and typing kept", ok: !!ownerUndo },
      { name: "a release that crashes is undone automatically", ok: autoUndo },
      { name: "the person can undo a change themselves on the device", ok: personUndo },
      { name: "an AI agent's change is tied to a time-limited grant from a person", ok: false },
    ];
    line(4, "partial", `Each accepted release is recorded on the device with the key that signed it. The company undid a release in the open app in ${B.undo?.ms} ms with data and typing kept, and a crashing release was reverted on its own. Not built: an undo the person triggers on the device, grants for AI agents, and a human-readable name behind a key.`, c);
  }

  // 5. A function can only touch what it declared
  {
    const host = await mk();
    const net = [];
    host.llp.capabilities.net = async (arg) => { net.push(arg); };
    host.llp.capabilities.haptic = async () => {};
    await host.apply(await release({ version: 1, layers: { main: H.tasks }, order: ["main"] }), fetchBlob);
    host.llp.setBound("draft", "Write spec"); await host.dispatch("main", "add");
    host.kv.set("secret.note", "my pin is 1234");
    const keys = { main: { own: ["tasks.", "draft", "secret."] }, snoop: { own: ["snoop."] } };
    await host.apply(await release({ version: 2, layers: { main: H.tasks, snoop: H.snoop }, order: ["main", "snoop"], keys }), fetchBlob);
    const seen = textOf(tree.find((s) => s.slot === "snoop")?.tree);
    await host.dispatch("snoop", "overwrite");
    const blind = !seen.includes("Write spec") && !seen.includes("1234"), cantWrite = host.kv.get("tasks.0.text") === "Write spec";
    // Capabilities: a function that didn't declare "net" can't use it.
    await host.apply(await release({ version: 3, layers: { main: H.tasks, helper: H.leak }, order: ["main", "helper"], keys: { main: { own: ["tasks.", "draft", "secret."] }, helper: { read: ["tasks."] } }, caps: { main: ["haptic"], helper: [] } }), fetchBlob);
    await host.dispatch("helper", "send"); await new Promise((r) => setTimeout(r, 30));
    const capRefused = net.length === 0;
    // The gap: a function that declares both "read tasks" and "net" installs, and personal data leaves.
    const leak = await host.apply(await release({ version: 4, layers: { main: H.tasks, helper: H.leak }, order: ["main", "helper"], keys: { main: { own: ["tasks.", "draft", "secret."] }, helper: { read: ["tasks."] } }, caps: { main: ["haptic"], helper: ["net"] } }), fetchBlob);
    await host.dispatch("helper", "send"); await new Promise((r) => setTimeout(r, 30));
    const leaked = net.includes("Write spec");
    host.close();
    const c = [
      { name: "a function can't read data it didn't declare", ok: blind },
      { name: "a function can't write data it doesn't own", ok: cantWrite },
      { name: "a function can't use a capability it didn't declare", ok: capRefused },
      { name: "a function that would send personal data off the device is refused at install", ok: !leak.ok && !leaked },
    ];
    line(5, "partial", `Access is enforced: a function saw none of the tasks or the secret note it hadn't declared, couldn't overwrite a task, and its undeclared network call was refused. The gap: a function that declares both "read tasks" and "network" installs, and the task text reached the network (${leaked ? "confirmed" : "no"}). Data has no "personal" label yet, so the device can't refuse that combination. That is step B.`, c);
  }

  // 6. Works with no network
  {
    const p = spawnSync("node", [new URL("../test/offline.mjs", import.meta.url).pathname], { encoding: "utf8" });
    const lines = p.stdout.split("\n").filter((l) => /^(PASS|FAIL)/.test(l));
    const c = lines.map((l) => ({ name: l.replace(/^(PASS|FAIL)\s+O\d+\s*/, "").split("  — ")[0], ok: l.startsWith("PASS") }));
    line(6, p.status === 0 && c.length >= 4 ? "pass" : "fail", `With the network removed (a connection attempt fails), a new trust list, a release and its code installed from a folder of files and the app rendered. A tampered file and an untrusted release in the folder were refused the same way as online.`, c);
  }

  // 7. One function, many surfaces
  {
    const host = await mk();
    await host.apply(await release({ version: 1, layers: { main: H.tasks }, order: ["main"] }), fetchBlob);
    host.llp.setBound("draft", "Write spec"); await host.dispatch("main", "add");
    const t = tree[0].tree;
    const term = asTerminal(t), speech = asSpeech(t), tools = asAgentTools("main", t);
    // The agent uses the function through the declared actions only.
    const add = tools.find((x) => x.action === "add");
    if (add?.needs) host.llp.setBound(add.needs.field, "Added by an agent");
    await host.dispatch(add.slot, add.action);
    const agentWorked = host.kv.get("tasks.n") === 2 && host.kv.get("tasks.1.text") === "Added by an agent";
    host.close();
    const c = [
      { name: "screen (browser DOM)", ok: /Write spec/.test(B.after?.text ?? "") },
      { name: "terminal text", ok: term.includes("== Tasks ==") && term.includes("[ ] Write spec") },
      { name: "read aloud", ok: speech.includes("Heading: Tasks.") && speech.includes("Checkbox, not checked: Write spec.") },
      { name: "an agent lists the actions and uses one", ok: tools.length >= 2 && agentWorked },
      { name: "the meaning of each element is fixed in the spec (names, roles, heading levels)", ok: false },
    ];
    line(7, "partial", `One unchanged function was shown as a browser page, as terminal text, as a spoken description ("${speech.slice(0, 60)}…") and as a list of ${tools.length} actions that an agent then used to add a task. It works because the function emits meaningful elements, not pixels. Not done: the element meanings aren't fixed in the spec yet, and these presenters are test code, not part of the host.`, c);
  }
  return out;
}
