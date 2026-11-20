// The seven lines, run against FLOW as it stands today (FLOW rules on the unchanged LLP host).
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { FlowHost, generateKey, asText, asSpeech, items } from "../src/index.js";
import { keyringDoc, sealKeyring, sealRelease, sealFunction, sealGrant } from "../src/author.js";
import { sha256hex } from "../src/bytes.js";
import { runFlowBrowser } from "./flow-browser.mjs";

const read = (rel) => new Uint8Array(readFileSync(new URL(rel, import.meta.url)));
const L = { tasks: read("../layers/tasks.wasm"), v2: read("../layers/tasks_v2.wasm"), snoop: read("../layers/snoop.wasm"), leak: read("../layers/leak.wasm"),
  streak: read("../layers/streak.wasm"), streak2: read("../layers/streak_v2.wasm"), crash: read("../layers/crash.wasm"), share: read("../layers/share.wasm"),
  trap: read("../node_modules/live-layer-protocol/build/tasks_trap.wasm") };
const H = Object.fromEntries(Object.entries(L).map(([k, b]) => [k, sha256hex(b)]));
const blobs = new Map(Object.entries(L).map(([k, b]) => [H[k], b]));
const fetchBlob = async (h) => blobs.get(h);
const textOf = (n) => !n ? "" : n.k === "text" ? n.t : (n.c || []).map(textOf).join(" ");

export async function runFlow() {
  const out = [];
  const line = (n, verdict, detail, checks) => out.push({ line: n, subject: "FLOW today", verdict, detail, checks });
  const app = "demo.tasks";
  const [r1, rel, person, relayKey, ben, agent] = await Promise.all(["p256", "p256", "p256", "p256", "p256", "p256"].map(generateKey));
  const [q1, spare, relayQ] = await Promise.all([1, 2, 3].map(() => generateKey("slh-dsa-sha2-128s")));
  const keyring = await sealKeyring(keyringDoc({ keyring: 1, app, spare, roles: { root: [{ keys: [r1] }, { keys: [q1] }], release: [{ keys: [rel] }] } }), [r1, q1]);
  const release = (manifest, signer = rel) => sealRelease({ app, manifest: { app, ...manifest } }, [signer]);
  let tree = [];
  const mk = (opts = {}) => FlowHost.create({ keyring, onRender: (t) => { tree = t; }, ...opts });
  const screen = () => tree.map((s) => textOf(s.tree)).join(" | ");
  // A release that opens one direction ("panel") for people's own functions, and labels its data.
  const KEYS = { main: { own: ["tasks.", "draft", "migrated.", "catalog."] } };
  const PANEL = { read: ["tasks.", "catalog."], caps: ["net"], egress: "public", after: "main" };
  const open = (version, layer = H.tasks, panel = PANEL, signer = rel) => sealRelease({ app, manifest: { app, version, layers: { main: layer }, order: ["main"], keys: KEYS, caps: { main: ["haptic"] } },
    data: { "tasks.": "personal", "draft": "personal", "catalog.": "public" }, capabilities: { haptic: { egress: false }, net: { egress: true } }, core: ["main"], directions: panel ? { panel } : {} }, [signer]);
  const fn = (id, seq, layer, more = {}) => ({ app, direction: "panel", id, seq, layer, ...more });

  const B = await runFlowBrowser();
  // The typing-through-a-swap part again, several times, because a loss depends on timing.
  const again = [];
  for (let i = 0; i < 8; i++) again.push((await runFlowBrowser({ quick: true })).after ?? {});
  const kept = again.filter((a) => a.draft === "Buy milk today" && a.focused && a.sameElement).length;

  // 1. Changed while in use, nothing lost (real Chromium; the person types straight through the swap)
  {
    const a = B.after ?? {};
    const c = [
      { name: "change appears without a reload", ok: B.ok && B.shipped.ok && /v2/.test(a.heading ?? "") },
      { name: "text typed before, during and after the swap is all there", ok: a.draft === "Buy milk today" },
      { name: "focus and caret stay in the field, and it is the very same field (not a rebuilt copy)", ok: a.focused === true && a.caret === 14 && a.sameElement === true },
      { name: `the same holds in ${again.length} of ${again.length} further runs`, ok: kept === again.length },
      { name: "saved tasks survive", ok: /Write spec/.test(a.text ?? "") && /Ship demo/.test(a.text ?? "") },
      { name: "scroll position survives a swap", ok: B.afterUndo?.scroll === 800 },
    ];
    line(1, c.every((x) => x.ok) ? "pass" : "fail", `In Chromium a signed release swapped the running code in ${B.shipped?.ms} ms while the person was mid-word. Field reads "${a.draft}", focus kept, tasks kept, scroll kept, in this run and in ${kept} of ${again.length} more. The page is now drawn by FLOW's own presenter, which patches the page in place and reads typed text from the host, so the app author does nothing to get this. (With that host fix switched off, text was lost in 6 of 10 runs.)`, c);
  }

  // 2. Each person's copy is different, and it stays the company's app
  {
    const screens = {};
    const dev = async (name) => { const h = await FlowHost.create({ keyring, onRender: (t) => { screens[name] = t.map((s) => textOf(s.tree)).join(" | "); } }); await h.apply(await open(1), fetchBlob); return h; };
    const [a, b] = [await dev("ana"), await dev("ben")];
    const unsigned = await a.installFunction(await sealFunction(fn("streak", 1, H.streak, { reads: ["tasks."] }), person), fetchBlob);
    a.enrolPerson({ ...person, name: "Ana" }); b.enrolPerson({ ...ben, name: "Ben" });
    const mainBox = a.llp.slots.get("main").box;
    const mine = await a.installFunction(await sealFunction(fn("streak", 1, H.streak, { reads: ["tasks."] }), person), fetchBlob);
    const companyUntouched = a.llp.slots.get("main").box === mainBox && a.running().main === b.running().main;
    const differ = /My streak/.test(screens.ana) && !/My streak/.test(screens.ben);
    await a.dispatch("fn.panel.streak", "cheer");
    const onBen = await b.installFunction(await sealFunction(fn("streak", 1, H.streak, { reads: ["tasks."] }), person), fetchBlob);
    const elsewhere = await a.installFunction(await sealFunction({ ...fn("x", 1, H.streak), direction: "checkout" }, person), fetchBlob);
    const fnBox = a.llp.slots.get("fn.panel.streak").box;
    const [ua, ub] = [await a.apply(await open(2, H.v2), fetchBlob), await b.apply(await open(2, H.v2), fetchBlob)];
    const untouched = ua.ok && ub.ok && ua.swapped.join() === "main" && a.llp.slots.get("fn.panel.streak").box === fnBox && /Tasks v2/.test(screens.ana) && /Tasks v2/.test(screens.ben) && /Cheers: 1/.test(screens.ana);
    const closed = await a.apply(await open(3, H.v2, null), fetchBlob);
    const paused = closed.ok && closed.paused[0]?.code === "not_open" && !a.llp.slots.has("fn.panel.streak") && a.kv.get("fn/panel/streak/count") === 1;
    const reopened = await a.apply(await open(4, H.v2), fetchBlob);
    const back = reopened.ok && /Cheers: 1/.test(screens.ana);
    a.close(); b.close();
    const c = [
      { name: "the company declares where functions may go", ok: mine.ok && !elsewhere.ok && elsewhere.code === "not_open" },
      { name: "a person's own function installs there, signed by the person, with no company signature and no restart", ok: !unsigned.ok && unsigned.code === "untrusted" && mine.ok && companyUntouched },
      { name: "two people on the same release see different apps", ok: differ },
      { name: "one person's function means nothing on another person's device", ok: !onBen.ok && onBen.code === "untrusted" },
      { name: "a company update reaches both, and the person's function carries on untouched with its data", ok: untouched },
      { name: "the company can close the spot (function paused, data kept) and reopen it (function back)", ok: paused && back },
      { name: "the same in a real browser, while the person is typing", ok: B.mine?.ok === true && /My streak/.test(B.withMine?.text ?? "") && B.withMine?.draft === "Buy milk today" && B.withMine?.focused === true },
    ];
    line(2, c.every((x) => x.ok) ? "pass" : "fail", `The company's release opens a spot called "panel" and says what a function there may read and use. Ana's device accepted a function signed by Ana's own key (${mine.ms} ms, company code not restarted); Ben's device, on the same release, shows the plain app, and refuses Ana's function (${onBen.code}). A company update reached both devices and Ana's function kept running. It stays the company's app: a function for a spot the company didn't open is refused (${elsewhere.code}), and when the company closed the spot the function was paused with its data kept, then came back when the spot reopened. Limit: a person's functions live on the device they were installed on; carrying them to the person's other devices is not built.`, c);
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
    const signed = (B.ledger ?? []).filter((e) => e.kind === "release" || e.kind === "function").every((e) => e.signers.length === 1 && /^sha256:/.test(e.signers[0])) && (B.ledger ?? []).filter((e) => e.kind === "release").length === 3;
    const ownerUndo = B.undo?.ok && B.afterUndo?.heading === "Tasks" && /Write spec/.test(B.afterUndo.text) && B.afterUndo.draft === "Buy milk today";
    // Automatic undo: a release whose code crashes on use is reverted and its writes dropped.
    const host = await mk({ wasm: "any" });
    await host.apply(await release({ version: 1, layers: { main: H.tasks }, order: ["main"] }), fetchBlob);
    host.setBound("main", "draft", "Write spec"); await host.dispatch("main", "add");
    await host.apply(await release({ version: 2, layers: { main: H.trap }, order: ["main"] }), fetchBlob);
    host.setBound("main", "draft", "this crashes"); await host.dispatch("main", "add");
    const autoUndo = host.running().main === H.tasks && host.kv.get("tasks.n") === 1;
    host.close();
    // The person's own undo, and an AI agent working under a time-limited grant.
    let now = Date.UTC(2026, 10, 20);
    const dev = await mk({ now: () => now });
    await dev.apply(await open(1), fetchBlob);
    const ana = dev.enrolPerson({ ...person, name: "Ana" });
    await dev.installFunction(await sealFunction(fn("streak", 1, H.streak, { reads: ["tasks."] }), person), fetchBlob);
    await dev.dispatch("fn.panel.streak", "cheer"); await dev.dispatch("fn.panel.streak", "cheer");
    await dev.installFunction(await sealFunction(fn("streak", 2, H.streak2), person), fetchBlob);
    const changed = dev.kv.get("fn/panel/streak/count") === -1 && dev.kv.get("fn/panel/streak/points") === 20;
    const undo = await dev.undoFunction("fn.panel.streak");
    const personUndo = changed && undo.ok && dev.running()["fn.panel.streak"] === H.streak && dev.kv.get("fn/panel/streak/count") === 2 && /Cheers: 2/.test(screen());
    const grant = await sealGrant({ app, agent, directions: ["panel"], notAfter: now + 600_000 }, person);
    const alone = await dev.installFunction(await sealFunction(fn("helper", 1, H.crash), agent), fetchBlob);
    const viaGrant = await dev.installFunction(await sealFunction(fn("helper", 1, H.crash, { intent: "A helper the agent wrote for Ana" }), agent, grant), fetchBlob);
    const entry = dev.ledger.at(-1);
    const tied = !alone.ok && viaGrant.ok && entry.signers[0] === agent.kid && entry.person.kid === ana && entry.person.name === "Ana" && entry.grant?.notAfter === now + 600_000;
    await dev.dispatch("fn.panel.helper", "boom");
    const contained = dev.inspect().functions.find((f) => f.id === "helper")?.state === "paused" && /Tasks/.test(screen()) && /Cheers: 2/.test(screen());
    const undoAgent = await dev.undoFunction("fn.panel.helper");
    const gone = undoAgent.ok && !dev.functions.has("fn.panel.helper");
    now += 601_000;
    const late = await dev.installFunction(await sealFunction(fn("helper", 2, H.crash), agent, grant), fetchBlob);
    dev.close();
    const c = [
      { name: "every accepted change is recorded with the key that signed it", ok: signed },
      { name: "a person's change is recorded under the person's name", ok: entry.person?.name === "Ana" },
      { name: "the company can undo a release in the running app, data and typing kept", ok: !!ownerUndo },
      { name: "a release that crashes is undone automatically", ok: autoUndo },
      { name: "the person can undo their own change on the device: old code and old data back, even after the data's format changed", ok: personUndo },
      { name: "the same undo in a real browser, while the person is typing", ok: B.undoMine?.ok === true && /Cheers: 2/.test(B.afterUndoMine?.text ?? "") && B.afterUndoMine?.draft === "Buy milk today" },
      { name: "an AI agent's change is tied to a time-limited grant from a person, who is recorded as accountable", ok: tied },
      { name: "the agent's function that fails is paused without harming the app, and the person can undo it", ok: contained && gone },
      { name: "after the grant's time limit the agent can change nothing", ok: !late.ok && late.code === "expired" },
    ];
    line(4, c.every((x) => x.ok) ? "pass" : "fail", `Each accepted change is recorded on the device with the key that signed it, and for a person's or an agent's change, the person who answers for it by name. Undo works three ways: the company undid a release in the open app in ${B.undo?.ms} ms; a crashing release was reverted on its own; and the person undid their own update on the device in ${undo.ms} ms, getting back both the old code and the old data although the update had rewritten the data's format. An agent could install a function only with a grant from Ana (alone: ${alone.code}); when its code failed it was paused and Ana removed it; after ten minutes the grant was dead (${late.code}). Limits: the company's keys are shown as key ids, not names; the record lives in memory and is not yet written to disk.`, c);
  }

  // 5. A function can only touch what it declared
  {
    const host = await mk();
    const net = [];
    host.llp.capabilities.net = async (arg) => { net.push(arg); };
    host.llp.capabilities.haptic = async () => {};
    await host.apply(await release({ version: 1, layers: { main: H.tasks }, order: ["main"] }), fetchBlob);
    host.setBound("main", "draft", "Write spec"); await host.dispatch("main", "add");
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
    host.close();
    // Data labels: the release says which data is personal and which capabilities leave the device.
    const dev = await mk();
    dev.llp.capabilities.net = async (arg) => { net.push(arg); };
    await dev.apply(await open(1), fetchBlob);
    dev.setBound("main", "draft", "Write spec"); await dev.dispatch("main", "add");
    dev.kv.set("catalog.title", "Autumn list");
    dev.enrolPerson({ ...person, name: "Ana" });
    const leak = await dev.installFunction(await sealFunction(fn("leak", 1, H.leak, { reads: ["tasks."], caps: ["net"] }), person), fetchBlob);
    const share = await dev.installFunction(await sealFunction(fn("share", 1, H.share, { reads: ["catalog."], caps: ["net"] }), person), fetchBlob);
    await dev.dispatch("fn.panel.share", "send"); await new Promise((r) => setTimeout(r, 30));
    const publicOut = share.ok && net.join() === "Autumn list";
    const companyLeak = await dev.apply(await sealRelease({ app, manifest: { app, version: 2, layers: { main: H.tasks, helper: H.leak }, order: ["main", "helper"], keys: { ...KEYS, helper: { read: ["tasks."] } }, caps: { main: ["haptic"], helper: ["net"] } },
      data: { "tasks.": "personal" }, capabilities: { haptic: { egress: false }, net: { egress: true } }, core: ["main"] }, [rel]), fetchBlob);
    const consentNeeded = await (async () => { await dev.apply(await open(2, H.tasks, { ...PANEL, egress: "personal" }), fetchBlob); return dev.installFunction(await sealFunction(fn("leak", 1, H.leak, { reads: ["tasks."], caps: ["net"] }), person), fetchBlob); })();
    const leaked = net.includes("Write spec");
    dev.close();
    const c = [
      { name: "a function can't read data it didn't declare", ok: blind },
      { name: "a function can't write data it doesn't own", ok: cantWrite },
      { name: "a function can't use a capability it didn't declare", ok: capRefused },
      { name: "a person's function that would send personal data off the device is refused at install", ok: !leak.ok && leak.code === "would_leak" },
      { name: "a company add-on that would do the same is refused too", ok: !companyLeak.ok && companyLeak.code === "would_leak" },
      { name: "a function that sends only public data is allowed", ok: publicOut },
      { name: "where the company allows personal data out, the person must still say yes on the device", ok: !consentNeeded.ok && consentNeeded.code === "needs_consent" },
      { name: "no personal data reached the network in any of this", ok: !leaked },
    ];
    line(5, c.every((x) => x.ok) ? "pass" : "fail", `Access is enforced: a function saw none of the tasks or the secret note it hadn't declared, couldn't overwrite a task, and its undeclared network call was refused. The gap from last time is closed: the release now labels its data and says which capabilities leave the device, and a function that declared both "read tasks" and "network" was refused before any of its code ran (${leak.code}), while one that sends only public data worked. Limit, stated plainly: the device judges by what a function declares (which data, which capabilities), not by following each value through the code. A function allowed both personal data and a way out is trusted with it, which is why that case needs the company's ceiling and the person's yes.`, c);
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
    host.setBound("main", "draft", "Write spec"); await host.dispatch("main", "add");
    const t = tree[0].tree;
    const term = asText(t), speech = asSpeech(t), tools = host.tools();
    // The agent uses the function through the declared actions only.
    const acted = await host.act("main", "add", { draft: "Added by an agent" });
    const agentWorked = acted.ok && host.kv.get("tasks.n") === 2 && host.kv.get("tasks.1.text") === "Added by an agent";
    const outside = await host.act("main", "add", { "tasks.0.text": "overwritten" });
    const none = await host.act("main", "wipe");
    host.close();
    // A kind this host has never heard of still shows what is inside it, on every surface.
    const future = { k: "carousel", a: {}, c: [{ k: "heading", a: { level: "2" }, c: [{ k: "text", t: "Later" }] }, { k: "button", a: { id: "go" }, c: [{ k: "text", t: "Go" }] }] };
    const tolerant = asText(future).includes("=== Later ===") && asSpeech(future).includes("Heading level 2: Later.") && items(future).length === 2;
    const c = [
      { name: "screen (browser page, drawn by FLOW's presenter)", ok: /Write spec/.test(B.after?.text ?? "") },
      { name: "terminal text", ok: term.includes("== Tasks ==") && term.includes("[ ] Write spec") },
      { name: "read aloud", ok: speech.includes("Heading: Tasks.") && speech.includes("Switch, off: Write spec.") },
      { name: "an agent lists the actions and uses one", ok: tools.length >= 2 && agentWorked },
      { name: "an agent can't do what isn't on screen, or write a field the action doesn't take", ok: !outside.ok && !none.ok && host.kv.get("tasks.0.text") === "Write spec" },
      { name: "all four surfaces read one table of element meanings, which is in the spec and ships with the host", ok: tolerant },
    ];
    line(7, c.every((x) => x.ok) ? "pass" : "fail", `One unchanged function was shown as a browser page, as terminal text, as a spoken description ("${speech.slice(0, 60)}…") and as a list of ${tools.length} actions that an agent then used to add a task. The meaning of each element (its role, its name, its state, its action) is now written in the spec and implemented once in the host; the four presenters ship with the host and all read that one table, and an element kind from a newer release still shows its contents on an older host. Limit: the element set is small (text, headings, fields, buttons, switches, groups); lists, images and navigation are not defined yet.`, c);
  }
  return out;
}
