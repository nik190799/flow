// The three proofs that gate revision A1 (downgrade, root, time capsule), run in the JavaScript host.
// The Go host runs the same cases through the shared conformance vectors (conformance/).
import { readFileSync, readdirSync } from "node:fs";
import { check, done, outcome, keys } from "./lib.mjs";
import { trustFirstKeyring, nextKeyring, verifyRelease, kidOf } from "../src/index.js";
import { keyringDoc, sealKeyring, sealRelease, reveal } from "../src/author.js";
import { sha256hex, b64u } from "../src/bytes.js";

const app = "demo.tasks";
const [r1, r2, r3, r4, r5] = await keys("p256", 5);
const [q1, q2, q3, q4, spare1, spare2, spare3] = await keys("slh-dsa-sha2-128s", 7);
const [relP, relP2] = await keys("p256", 2);
const [relQ] = await keys("slh-dsa-sha2-128s", 1);
const [attacker] = await keys("p256", 1);

// Keyring 1: root = P-256 2-of-3 AND SLH-DSA 1-of-2. Release = P-256 1-of-1 AND SLH-DSA 1-of-1, so a
// release has two required signatures and stripping either must fail.
const k1doc = keyringDoc({ keyring: 1, app, spare: spare1,
  roles: { root: [{ keys: [r1, r2, r3], threshold: 2 }, { keys: [q1, q2], threshold: 1 }], release: [{ keys: [relP] }, { keys: [relQ] }] } });
const k1 = await trustFirstKeyring(await sealKeyring(k1doc, [r1, r2, q1]));
const manifest = { app, version: 1, layers: {} };

console.log("Proof 1: downgrade");
const full = await sealRelease({ app, manifest }, [relP, relQ]);
check("P1.1 a release carrying both required signatures is accepted", await outcome(() => verifyRelease(k1, full)) === "ok");
const strippedQ = { ...full, sigs: full.sigs.filter((s) => s.kid !== relQ.kid) };
const strippedP = { ...full, sigs: full.sigs.filter((s) => s.kid !== relP.kid) };
check("P1.2 the same release with the quantum-safe signature stripped off is refused", await outcome(() => verifyRelease(k1, strippedQ)) === "untrusted");
check("P1.3 the same release with the P-256 signature stripped off is refused", await outcome(() => verifyRelease(k1, strippedP)) === "untrusted");
const k1stripped = await sealKeyring(k1doc, [r1, r2]);
check("P1.4 a keyring with its root SLH-DSA signature stripped is refused", await outcome(() => trustFirstKeyring(k1stripped)) === "untrusted");

const k2doc = keyringDoc({ keyring: 2, app, spare: spare1,
  roles: { root: [{ keys: [r4, r5], threshold: 2 }, { keys: [q3, q4], threshold: 1 }], release: [{ keys: [relP] }, { keys: [relQ] }] } });
check("P1.5 a policy change signed only by the new keys (no old-policy signatures) is refused",
  await outcome(async () => nextKeyring(k1, await sealKeyring(k2doc, [r4, r5, q3]))) === "untrusted");
check("P1.6 a policy change signed by the old policy only (new keys didn't sign) is refused",
  await outcome(async () => nextKeyring(k1, await sealKeyring(k2doc, [r1, r2, q1]))) === "untrusted");
const k2env = await sealKeyring(k2doc, [r1, r2, q1, r4, r5, q3]);
const k2 = await nextKeyring(k1, k2env);
check("P1.7 replacing every root key (both suites) is accepted when signed under both the old and new policy", k2.keyring === 2);
check("P1.8 replaying the accepted keyring is refused as stale", await outcome(() => nextKeyring(k2, k2env)) === "stale");
const k2attack = await sealKeyring({ ...k1doc, keyring: 9, keys: { ...k1doc.keys, [attacker.kid]: { suite: "p256", pub: attacker.pub } },
  roles: { ...k1doc.roles, release: [{ suite: "p256", keys: [attacker.kid], threshold: 1 }] } }, [r1, attacker, q1]);
check("P1.9 an attacker holding one P-256 root key can't add their own release key", await outcome(() => nextKeyring(k1, k2attack)) === "untrusted");

// Retire a suite on purpose: release role drops SLH-DSA, signed under both policies, so it's allowed.
const k2b = keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: k1doc.roles.root.map((g, i) => ({ keys: [[r1, r2, r3], [q1, q2]][i], threshold: g.threshold })), release: [{ keys: [relP2] }] } });
const k2bk = await nextKeyring(k1, await sealKeyring(k2b, [r1, r2, q1]));
check("P1.10 the root can deliberately replace the release suites (two groups to one new key)", await outcome(async () => verifyRelease(k2bk, await sealRelease({ app, manifest }, [relP2]))) === "ok");
check("P1.11 after that, the old release keys no longer work", await outcome(() => verifyRelease(k2bk, full)) === "untrusted");

const k3future = { ...keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: k1doc.roles.root.map((g, i) => ({ keys: [[r1, r2, r3], [q1, q2]][i], threshold: g.threshold })), release: [{ keys: [relP] }] } }) };
const futureKid = kidOf("ml-dsa-65", new Uint8Array(1952));
k3future.keys[futureKid] = { suite: "ml-dsa-65", pub: b64u.enc(new Uint8Array(1952)) };
k3future.roles.release.push({ suite: "ml-dsa-65", keys: [futureKid], threshold: 1 });
check("P1.12 a keyring needing a suite this host lacks reports host_too_old",
  await outcome(async () => nextKeyring(k1, await sealKeyring(k3future, [r1, r2, q1]))) === "host_too_old");

console.log("\nProof 2: root");
const classicalOnly = keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: [{ keys: [r1, r2, r3], threshold: 2 }, { keys: [q1, q2], threshold: 1 }], release: [{ keys: [relP2] }] } });
check("P2.1 a device at keyring 1 refuses keyring 2 signed with classical root keys only",
  await outcome(async () => nextKeyring(k1, await sealKeyring(classicalOnly, [r1, r2, r3]))) === "untrusted");
const dropsPq = keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: [{ keys: [r1, r2, r3], threshold: 2 }], release: [{ keys: [relP2] }] } });
check("P2.2 a keyring 2 that drops the quantum-safe root group is refused even when fully signed",
  await outcome(async () => nextKeyring(k1, await sealKeyring(dropsPq, [r1, r2, q1]))) === "weak_root");
const replaceR1 = keyringDoc({ keyring: 2, app, spare: spare1, roles: { root: [{ keys: [r2, r3, r4], threshold: 2 }, { keys: [q1, q2], threshold: 1 }], release: [{ keys: [relP] }] } });
check("P2.3 lose one P-256 root key (r1): r2 and r3 rotate to a keyring that replaces it with r4",
  await outcome(async () => nextKeyring(k1, await sealKeyring(replaceR1, [r2, r3, q2]))) === "ok");

// A strict root: SLH-DSA 2-of-2, so losing one quantum-safe key would lock the device out without the spare.
const strictDoc = keyringDoc({ keyring: 1, app, spare: spare1, roles: { root: [{ keys: [r1, r2], threshold: 1 }, { keys: [q1, q2], threshold: 2 }], release: [{ keys: [relP] }] } });
const strict = await trustFirstKeyring(await sealKeyring(strictDoc, [r1, q1, q2]));
const afterLoss = keyringDoc({ keyring: 2, app, spare: spare2, roles: { root: [{ keys: [r1, r2], threshold: 1 }, { keys: [q1, spare1], threshold: 2 }], release: [{ keys: [relP] }] } });
check("P2.4 with q2 lost and a 2-of-2 SLH-DSA root, rotation without the spare is refused",
  await outcome(async () => nextKeyring(strict, await sealKeyring(afterLoss, [r1, q1]))) === "untrusted");
const recovered = await outcome(async () => nextKeyring(strict, await sealKeyring(afterLoss, [r1, q1, reveal(spare1)])));
check("P2.5 revealing the spare (signature + public key) stands in for the lost key and rotation works", recovered === "ok");
const reuse = { ...afterLoss, spare: { suite: spare1.suite, kid: spare1.kid } , keys: { ...afterLoss.keys } };
delete reuse.keys[spare1.kid]; reuse.roles = { root: [{ suite: "p256", keys: [r1.kid, r2.kid], threshold: 1 }, { suite: q1.suite, keys: [q1.kid, q3.kid], threshold: 1 }], release: afterLoss.roles.release };
reuse.keys[q3.kid] = { suite: q3.suite, pub: q3.pub };
check("P2.6 after revealing the spare, the next keyring must commit to a new spare",
  await outcome(async () => nextKeyring(strict, await sealKeyring(reuse, [r1, q1, q3, reveal(spare1)]))) === "malformed");
const forged = await sealKeyring(afterLoss, [r1, q1, reveal(spare1)]);
forged.sigs.find((s) => s.kid === spare1.kid).pub = spare3.pub;
check("P2.7 a revealed spare whose public key doesn't match the committed kid is ignored (refused)", await outcome(() => nextKeyring(strict, forged)) === "untrusted");
const wrongSpare = await sealKeyring(afterLoss, [r1, q1, reveal(spare3)]);
check("P2.8 an uncommitted key presenting itself as the spare is refused", await outcome(() => nextKeyring(strict, wrongSpare)) === "untrusted");

console.log("\nProof 3: time capsule");
// Invented fields everywhere a later revision might add them, including an invented sensitivity label.
const futureDoc = { ...k1doc, keyring: 2, "labels": { "menu.price": "regulated-v9" }, "purposes": ["display"], "x-anything": { nested: [1, 2] } };
const futureEnv = await sealKeyring(futureDoc, [r1, r2, q1]);
futureEnv.sigs = futureEnv.sigs.map((s) => ({ ...s, "alg-hint": "ignored", "ts": 1 }));
futureEnv["route"] = "usb";
check("P3.1 a keyring with invented fields (payload, wrapper, signature entries, a sensitivity label) is accepted", await outcome(() => nextKeyring(k1, futureEnv)) === "ok");
const futureRel = await sealRelease({ app, manifest, "labels": { "menu.price": "biometric-v9" }, "budget": { cpuMs: 3 } }, [relP, relQ]);
check("P3.2 a release with invented fields is accepted", await outcome(() => verifyRelease(k1, futureRel)) === "ok");
const needs = await sealRelease({ app, manifest, requires: ["labels-v1"] }, [relP, relQ]);
check("P3.3 a release that requires a feature this host lacks reports host_too_old", await outcome(() => verifyRelease(k1, needs)) === "host_too_old");
const needsKr = await sealKeyring({ ...k1doc, keyring: 2, requires: ["grants-v1"] }, [r1, r2, q1]);
check("P3.4 a keyring that requires a feature this host lacks reports host_too_old", await outcome(() => nextKeyring(k1, needsKr)) === "host_too_old");

// The frozen capsule: vectors written on the day A1 shipped. Their bytes are locked; later revisions
// must keep passing them unchanged (conformance/run-js.mjs runs them; this checks the lock).
const dir = new URL("../conformance/capsule-a1/", import.meta.url);
const lock = JSON.parse(readFileSync(new URL("LOCK.json", dir), "utf8"));
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "LOCK.json").sort();
const drift = files.filter((f) => sha256hex(readFileSync(new URL(f, dir))) !== lock[f]);
check("P3.5 the A1 capsule vectors are unchanged since they were frozen", files.length > 0 && files.length === Object.keys(lock).length && drift.length === 0, drift.length ? `changed: ${drift.join(", ")}` : `${files.length} files`);

done("proofs");
