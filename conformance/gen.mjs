// Writes the A1 conformance vectors. Each step states its expected outcome independently; the
// generator refuses to write anything unless the JS verifier already agrees.
//
//   node conformance/gen.mjs                   writes conformance/vectors/ (a scratch set)
//   node conformance/gen.mjs --freeze          writes the frozen capsule conformance/capsule-a1/ + LOCK.json
//                                              (refuses if the capsule already exists: it must never change)
//
// Keys are generated fresh and thrown away; vectors hold only public keys and signatures.
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { generateKey, seal, kidOf } from "../src/index.js";
import { keyringDoc, sealKeyring, sealRelease, reveal } from "../src/author.js";
import { sha256hex, b64u, te } from "../src/bytes.js";
import { runVector } from "./runner.mjs";

const freeze = process.argv.includes("--freeze");
const outDir = new URL(freeze ? "./capsule-a1/" : "./vectors/", import.meta.url);
if (freeze && existsSync(outDir) && readdirSync(outDir).some((f) => f !== "LOCK.json" && f.endsWith(".json"))) {
  console.error("capsule-a1 already exists and must never change. Add new vectors to a new set instead."); process.exit(1);
}

const gen = (suite, n) => Promise.all(Array.from({ length: n }, () => generateKey(suite)));
const app = "demo.tasks";
const NOW = Date.UTC(2026, 10, 19);
const [r1, r2, r3, r4, r5, attacker] = await gen("p256", 6);
const [q1, q2, q3, q4, spare1, spare2, spare3] = await gen("slh-dsa-sha2-128s", 7);
const [relP, relP2] = await gen("p256", 2);
const [relQ] = await gen("slh-dsa-sha2-128s", 1);

const root1 = [{ keys: [r1, r2, r3], threshold: 2 }, { keys: [q1, q2], threshold: 1 }];
const k1doc = keyringDoc({ keyring: 1, app, spare: spare1, roles: { root: root1, release: [{ keys: [relP] }, { keys: [relQ] }] } });
const k1 = await sealKeyring(k1doc, [r1, r2, q1]);
const trust = { op: "trust", doc: k1, expect: "ok" };
const manifest = { app, version: 1, layers: {} };
const fullRel = await sealRelease({ app, manifest }, [relP, relQ]);
const strip = (env, kid) => ({ ...env, sigs: env.sigs.filter((s) => s.kid !== kid) });

const V = [];
const add = (name, about, steps) => V.push({ name, about, now: NOW, steps });

// Envelope and first keyring
add("trust-ok", "A first keyring signed under its own root policy is trusted.", [trust]);
add("trust-pinned", "A first keyring matching its pinned SHA-256 is trusted.", [{ ...trust, pin: sha256hex(b64u.dec(k1.payload)) }]);
add("trust-pin-mismatch", "A first keyring with the wrong pin is refused.", [{ ...trust, pin: "0".repeat(64), expect: "untrusted" }]);
add("trust-stripped-pq", "Root SLH-DSA signature stripped from the first keyring.", [{ op: "trust", doc: strip(k1, q1.kid), expect: "untrusted" }]);
add("trust-weak-root", "A root policy with no quantum-safe group is refused.", [{ op: "trust", doc: await sealKeyring(keyringDoc({ keyring: 1, app, spare: spare1, roles: { root: [{ keys: [r1, r2], threshold: 2 }], release: [{ keys: [relP] }] } }), [r1, r2]), expect: "weak_root" }]);
add("wrapper-reformatted", "Reordered, re-indented wrapper with an extra field: the wrapper isn't signed.", [{ op: "trust", doc: JSON.parse(JSON.stringify({ x: 1, sigs: k1.sigs, payload: k1.payload, type: k1.type, flow: 1 }, null, 3)), expect: "ok" }]);
add("wrapper-future-format", "Envelope format 2 is reported as host_too_old.", [{ op: "trust", doc: { ...k1, flow: 2 }, expect: "host_too_old" }]);
add("wrapper-bad-base64", "Padded (non-canonical) base64url payload.", [{ op: "trust", doc: { ...k1, payload: k1.payload + "=" }, expect: "malformed" }]);
add("payload-duplicate-key", "A signed payload repeating a key in one object.", [{ op: "trust", doc: await seal("flow/keyring", JSON.stringify(k1doc).replace('"keyring":1', '"keyring":1,"keyring":2'), [r1, r2, q1]), expect: "malformed" }]);
add("payload-not-utf8", "A signed payload that isn't UTF-8.", [{ op: "trust", doc: await seal("flow/keyring", new Uint8Array([0x7b, 0xff, 0x7d]), [r1]), expect: "malformed" }]);
const twice = await sealKeyring(k1doc, [r1, q1]); twice.sigs.push(twice.sigs[0]);
add("same-key-twice", "One P-256 key signing twice counts once, so 2-of-3 isn't met.", [{ op: "trust", doc: twice, expect: "untrusted" }]);
const badKid = structuredClone(k1doc); badKid.keys[r1.kid].pub = r3.pub;
add("kid-mismatch", "A kid that doesn't match its suite and public key.", [{ op: "trust", doc: await sealKeyring(badKid, [r1, r2, q1]), expect: "malformed" }]);

// Releases (proof 1)
add("release-ok", "Release with both required signatures.", [trust, { op: "release", doc: fullRel, expect: "ok" }]);
add("release-stripped-pq", "Proof 1: quantum-safe release signature stripped.", [trust, { op: "release", doc: strip(fullRel, relQ.kid), expect: "untrusted" }]);
add("release-stripped-p256", "Proof 1: P-256 release signature stripped.", [trust, { op: "release", doc: strip(fullRel, relP.kid), expect: "untrusted" }]);
add("release-wrong-type", "A keyring presented as a release.", [trust, { op: "release", doc: k1, expect: "wrong_type" }]);
add("release-relabelled", "A release relabelled as another kind: signatures break.", [trust, { op: "release", doc: { ...k1, type: "flow/release" }, expect: "untrusted" }]);
add("release-wrong-app", "A release for another app.", [trust, { op: "release", doc: await sealRelease({ app: "other", manifest: { app: "other" } }, [relP, relQ]), expect: "wrong_app" }]);
const expired = await sealRelease({ app, manifest, expires: NOW - 1 }, [relP, relQ]);
add("release-expired", "Expired release, trusted clock.", [trust, { op: "release", doc: expired, expect: "expired" }]);
add("release-expired-no-clock", "Expired release on a device with no trusted clock: only signatures decide.", [trust, { op: "release", doc: expired, clock: "untrusted", expect: "ok" }]);
add("release-invented-fields", "Proof 3: invented fields, including an invented sensitivity label.", [trust, { op: "release", doc: await sealRelease({ app, manifest, labels: { "menu.price": "biometric-v9" }, budget: { cpuMs: 3 } }, [relP, relQ]), expect: "ok" }]);
add("release-requires-unknown", "Proof 3: requires a feature this host lacks.", [trust, { op: "release", doc: await sealRelease({ app, manifest, requires: ["labels-v1"] }, [relP, relQ]), expect: "host_too_old" }]);

// Keyring changes (proofs 1 and 2)
const k2doc = keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: [{ keys: [r4, r5], threshold: 2 }, { keys: [q3, q4], threshold: 1 }], release: [{ keys: [relP] }, { keys: [relQ] }] } });
const k2both = await sealKeyring(k2doc, [r1, r2, q1, r4, r5, q3]);
add("rotate-new-keys-only", "Proof 1: policy change with no old-policy signatures.", [trust, { op: "keyring", doc: await sealKeyring(k2doc, [r4, r5, q3]), expect: "untrusted" }]);
add("rotate-old-keys-only", "Policy change the new root didn't sign.", [trust, { op: "keyring", doc: await sealKeyring(k2doc, [r1, r2, q1]), expect: "untrusted" }]);
add("rotate-all-roots", "Proof 1: replace every root key in both suites, signed under both policies; then replay it.", [trust, { op: "keyring", doc: k2both, expect: "ok" }, { op: "keyring", doc: k2both, expect: "stale" }]);
add("rotate-attacker-one-root", "An attacker with one P-256 root key adds their own release key.", [trust, { op: "keyring", doc: await sealKeyring({ ...k1doc, keyring: 9, keys: { ...k1doc.keys, [attacker.kid]: { suite: "p256", pub: attacker.pub } }, roles: { ...k1doc.roles, release: [{ suite: "p256", keys: [attacker.kid], threshold: 1 }] } }, [r1, attacker, q1]), expect: "untrusted" }]);
const k2rel = keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: root1, release: [{ keys: [relP2] }] } });
add("retire-release-suite", "The root deliberately replaces the release groups; old release keys stop working.", [trust,
  { op: "keyring", doc: await sealKeyring(k2rel, [r1, r2, q1]), expect: "ok" },
  { op: "release", doc: fullRel, expect: "untrusted" },
  { op: "release", doc: await sealRelease({ app, manifest }, [relP2]), expect: "ok" }]);
const future = keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: root1, release: [{ keys: [relP] }] } });
const fkid = kidOf("ml-dsa-65", new Uint8Array(1952));
future.keys[fkid] = { suite: "ml-dsa-65", pub: b64u.enc(new Uint8Array(1952)) };
future.roles.release.push({ suite: "ml-dsa-65", keys: [fkid], threshold: 1 });
add("rotate-unknown-suite", "Proof 1: a keyring needing a suite this host lacks.", [trust, { op: "keyring", doc: await sealKeyring(future, [r1, r2, q1]), expect: "host_too_old" }]);
add("rotate-classical-only", "Proof 2: keyring 2 signed with classical root keys only.", [trust, { op: "keyring", doc: await sealKeyring(k2rel, [r1, r2, r3]), expect: "untrusted" }]);
add("rotate-drops-pq-root", "Proof 2: a fully signed keyring that drops the quantum-safe root group.", [trust, { op: "keyring", doc: await sealKeyring(keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: [{ keys: [r1, r2, r3], threshold: 2 }], release: [{ keys: [relP] }] } }), [r1, r2, q1]), expect: "weak_root" }]);
add("rotate-after-losing-r1", "Proof 2: r1 lost; r2 and r3 replace it with r4.", [trust, { op: "keyring", doc: await sealKeyring(keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: [{ keys: [r2, r3, r4], threshold: 2 }, { keys: [q1, q2], threshold: 1 }], release: [{ keys: [relP] }] } }), [r2, r3, q2]), expect: "ok" }]);
add("rotate-wrong-app", "A keyring for another app.", [trust, { op: "keyring", doc: await sealKeyring({ ...k2rel, app: "other" }, [r1, r2, q1]), expect: "wrong_app" }]);

const strictDoc = keyringDoc({ keyring: 1, app, spare: spare1, roles: { root: [{ keys: [r1, r2], threshold: 1 }, { keys: [q1, q2], threshold: 2 }], release: [{ keys: [relP] }] } });
const strictTrust = { op: "trust", doc: await sealKeyring(strictDoc, [r1, q1, q2]), expect: "ok" };
const afterLoss = keyringDoc({ keyring: 2, app, spare: spare2, roles: { root: [{ keys: [r1, r2], threshold: 1 }, { keys: [q1, spare1], threshold: 2 }], release: [{ keys: [relP] }] } });
add("spare-needed", "Proof 2: q2 lost under a 2-of-2 SLH-DSA root; no spare, no rotation.", [strictTrust, { op: "keyring", doc: await sealKeyring(afterLoss, [r1, q1]), expect: "untrusted" }]);
add("spare-revealed", "Proof 2: the revealed spare stands in for q2 and rotation works.", [strictTrust, { op: "keyring", doc: await sealKeyring(afterLoss, [r1, q1, reveal(spare1)]), expect: "ok" }]);
const reuse = keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: [{ keys: [r1, r2], threshold: 1 }, { keys: [q1, q3], threshold: 1 }], release: [{ keys: [relP] }] } });
add("spare-not-replaced", "After revealing the spare, the next keyring must commit to a new one.", [strictTrust, { op: "keyring", doc: await sealKeyring(reuse, [r1, q1, q3, reveal(spare1)]), expect: "malformed" }]);
const forged = await sealKeyring(afterLoss, [r1, q1, reveal(spare1)]); forged.sigs.find((s) => s.kid === spare1.kid).pub = spare3.pub;
add("spare-forged-pub", "A revealed spare whose public key doesn't match the committed kid.", [strictTrust, { op: "keyring", doc: forged, expect: "untrusted" }]);
add("spare-impostor", "A key that wasn't committed presents itself as the spare.", [strictTrust, { op: "keyring", doc: await sealKeyring(afterLoss, [r1, q1, reveal(spare3)]), expect: "untrusted" }]);

// Tolerance (proof 3)
const inv = await sealKeyring({ ...k1doc, keyring: 2, labels: { "menu.price": "regulated-v9" }, purposes: ["display"], "x-anything": { nested: [1, 2] } }, [r1, r2, q1]);
inv.sigs = inv.sigs.map((s) => ({ ...s, "alg-hint": "ignored", ts: 1 })); inv.route = "usb";
add("keyring-invented-fields", "Proof 3: invented fields in payload, wrapper and signature entries.", [trust, { op: "keyring", doc: inv, expect: "ok" }]);
add("keyring-requires-unknown", "Proof 3: a keyring requiring a feature this host lacks.", [trust, { op: "keyring", doc: await sealKeyring({ ...k1doc, keyring: 2, requires: ["grants-v1"] }, [r1, r2, q1]), expect: "host_too_old" }]);
const pkid = kidOf("passkey-v1", te.encode("a future passkey"));
const unknownRole = await sealKeyring({ ...k1doc, keyring: 2, keys: { ...k1doc.keys, [pkid]: { suite: "passkey-v1", pub: b64u.enc(te.encode("a future passkey")) } },
  roles: { ...k1doc.roles, enrolment: [{ suite: "passkey-v1", keys: [pkid], threshold: 1 }] } }, [r1, r2, q1]);
add("keyring-unknown-role", "Proof 3: a role this host doesn't use, with a suite it doesn't implement, is carried but not judged.", [trust, { op: "keyring", doc: unknownRole, expect: "ok" }]);

// Check every expectation against the JS verifier before writing anything.
let bad = 0;
for (const v of V) {
  const got = await runVector(v), want = v.steps.map((s) => s.expect);
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.error(`MISMATCH ${v.name}: want ${want} got ${got}`); }
}
if (bad) { console.error(`${bad} vectors disagree with the JS verifier; nothing written.`); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const lock = {};
V.forEach((v, i) => {
  const f = `${String(i + 1).padStart(2, "0")}-${v.name}.json`;
  const text = JSON.stringify(v, null, 1) + "\n";
  writeFileSync(new URL(f, outDir), text);
  lock[f] = sha256hex(te.encode(text));
});
if (freeze) writeFileSync(new URL("LOCK.json", outDir), JSON.stringify(lock, null, 2) + "\n");
console.log(`wrote ${V.length} vectors to ${outDir.pathname}`);
