// Unit checks for the envelope, the strict JSON reader and the keyring grammar.
import { check, done, outcome, keys } from "./lib.mjs";
import { seal, cosign, unwrap, trustFirstKeyring, verifyRelease, readKeyring, kidOf, FEATURES } from "../src/index.js";
import { keyringDoc, sealKeyring, sealRelease } from "../src/author.js";
import { parseStrict } from "../src/json.js";
import { te, b64u } from "../src/bytes.js";

const [r1, r2, r3] = await keys("p256", 3);
const [q1, q2, qSpare] = await keys("slh-dsa-sha2-128s", 3);
const [rel] = await keys("p256", 1);
const app = "demo.tasks";
const doc1 = keyringDoc({ keyring: 1, app, spare: qSpare,
  roles: { root: [{ keys: [r1, r2, r3], threshold: 2 }, { keys: [q1, q2], threshold: 1 }], release: [{ keys: [rel] }] } });
const env1 = await sealKeyring(doc1, [r1, r2, q1]);
const kr = await trustFirstKeyring(env1);
check("U1 a keyring signed under its own root policy (P-256 2-of-3 and SLH-DSA 1-of-2) is trusted", kr.keyring === 1);
check("U2 an SLH-DSA-SHA2-128s signature is 7,856 bytes", b64u.dec(env1.sigs[2].sig).length === 7856);

// The wrapper is not signed: reformatting it changes nothing.
const reformatted = JSON.parse(JSON.stringify({ sigs: env1.sigs, payload: env1.payload, type: env1.type, flow: 1, "note": "added by a relay" }, null, 4));
check("U3 the same envelope with reordered, re-indented and extra wrapper fields still verifies", await outcome(() => trustFirstKeyring(reformatted)) === "ok");

// The document kind is signed.
check("U4 a keyring presented where a release is expected is refused as wrong_type", await outcome(() => verifyRelease(kr, env1)) === "wrong_type");
const relabelled = { ...env1, type: "flow/release" };
check("U5 relabelling an envelope's type breaks its signatures (refused, untrusted)", await outcome(() => verifyRelease(kr, relabelled)) === "untrusted");

// Payload byte changes break signatures.
const p = b64u.dec(env1.payload); const p2 = new Uint8Array(p); p2[p2.length - 2] ^= 1;
check("U6 one changed payload byte breaks the signatures", await outcome(() => trustFirstKeyring({ ...env1, payload: b64u.enc(p2) })) !== "ok");

// The same key counted twice is still one key.
const twice = await sealKeyring(doc1, [r1, q1]);
twice.sigs.push(twice.sigs[0]);
check("U7 one key signing twice counts once (P-256 threshold 2 not met)", await outcome(() => trustFirstKeyring(twice)) === "untrusted");

// Strict JSON.
check("U8 a payload repeating a key in one object is refused", await outcome(() => parseStrict(te.encode('{"a":1,"b":{"x":1,"x":2}}'))) === "malformed");
check("U9 the same key name in different objects is fine", await outcome(() => parseStrict(te.encode('{"a":{"x":1},"b":{"x":2},"c":[{"x":1},{"x":2}],"d":"\\"x\\""}'))) === "ok");
check("U10 a payload that isn't UTF-8 is refused", await outcome(() => parseStrict(new Uint8Array([0x7b, 0xff, 0x7d]))) === "malformed");
check("U11 non-canonical base64url is refused", await outcome(() => unwrap({ ...env1, payload: env1.payload + "=" })) === "malformed");

// Keyring grammar.
const badKid = structuredClone(doc1); const k0 = Object.keys(badKid.keys)[0]; badKid.keys[k0].pub = r3.pub;
check("U12 a keyring whose kid doesn't match its public key is refused", await outcome(() => readKeyring(badKid)) === "malformed");
const noSpare = structuredClone(doc1); delete noSpare.spare;
check("U13 a keyring without a spare root key is refused", await outcome(() => readKeyring(noSpare)) === "malformed");
const spareActive = structuredClone(doc1); spareActive.spare = { suite: r1.suite, kid: r1.kid };
check("U14 the spare must not also be an active key", await outcome(() => readKeyring(spareActive)) === "malformed");
const classical = keyringDoc({ keyring: 1, app, spare: qSpare, roles: { root: [{ keys: [r1, r2], threshold: 2 }], release: [{ keys: [rel] }] } });
check("U15 a keyring whose root has no quantum-safe group is refused (weak_root), even as the first keyring", await outcome(async () => trustFirstKeyring(await sealKeyring(classical, [r1, r2]))) === "weak_root");
const thr = structuredClone(doc1); thr.roles.root[0].threshold = 4;
check("U16 a threshold above the group size is refused", await outcome(() => readKeyring(thr)) === "malformed");
check("U17 a pinned first keyring with the wrong hash is refused", await outcome(() => trustFirstKeyring(env1, { pin: "0".repeat(64) })) === "untrusted");
check("U18 kid is sha256 over suite, a zero byte and the public key", kidOf("p256", b64u.dec(r1.pub)) === r1.kid);

// Releases.
const relDoc = { app, manifest: { app, version: 1, layers: {} } };
check("U19 a release signed by the release key verifies", await outcome(async () => verifyRelease(kr, await sealRelease(relDoc, [rel]))) === "ok");
check("U20 a release signed by a root key but not the release key is refused", await outcome(async () => verifyRelease(kr, await sealRelease(relDoc, [r1, r2, q1]))) === "untrusted");
check("U21 a release for another app is refused", await outcome(async () => verifyRelease(kr, await sealRelease({ app: "other", manifest: { app: "other" } }, [rel]))) === "wrong_app");
const past = { ...relDoc, expires: Date.now() - 1000 };
check("U22 an expired release is refused on a device with a trusted clock", await outcome(async () => verifyRelease(kr, await sealRelease(past, [rel]))) === "expired");
check("U23 the same release is judged only by signatures on a device with no trusted clock", await outcome(async () => verifyRelease(kr, await sealRelease(past, [rel]), { clock: "untrusted" })) === "ok");
check("U24 a newer envelope format is reported as host_too_old, not malformed", await outcome(() => unwrap({ ...env1, flow: 2 })) === "host_too_old");
check("U25 revision A1 defines no required features", FEATURES.size === 0);
const cosigned = await cosign(await sealRelease(relDoc, []), [rel]);
check("U26 signatures can be added later by another party (cosign)", await outcome(() => verifyRelease(kr, cosigned)) === "ok");

done("unit");
