// The trust policy (the keyring) and the documents it governs.
//
// A keyring lists keys and, for each role, groups of the form { suite, keys, threshold }. A document
// is valid for a role only if EVERY group of that role meets its threshold. Trust comes only from the
// keyring the device already holds, never from what an incoming message says about itself, so an
// attacker can't strip the stronger signature off and still pass.
//
// Rules this module enforces:
//   - The root role must contain at least one quantum-safe group, from keyring 1 on.
//   - A new keyring is accepted only if it is signed under the FULL current root policy and the FULL
//     new root policy, and its number is higher. So an attacker who can't satisfy today's policy can't
//     change it, while the root can still deliberately add, replace or retire a suite.
//   - Each keyring commits to one spare root key by kid. The spare's signature may stand in for one
//     missing key of its suite when moving to the next keyring; once revealed it must be replaced.
//   - Unknown fields are ignored. A feature that must be understood goes in `requires`; a host that
//     doesn't implement every listed feature refuses with host_too_old instead of guessing.
import { b64u, sha256hex } from "./bytes.js";
import { refuse } from "./errors.js";
import { parseStrict } from "./json.js";
import { SUITES, implemented, kidOf } from "./suites.js";
import { unwrap, validSigners } from "./envelope.js";

export const KEYRING = "flow/keyring";
export const RELEASE = "flow/release";

// Features this host implements that a document may list in `requires`. Revision A1 defines none;
// later revisions add names here, and older hosts refuse documents that need them.
export const FEATURES = new Set();

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const KID_RE = /^sha256:[0-9a-f]{64}$/;

export function checkRequires(doc, what) {
  if (doc.requires === undefined) return [];
  if (!Array.isArray(doc.requires) || !doc.requires.every((r) => typeof r === "string")) refuse("malformed", `${what}: requires must be a list of feature names`);
  const missing = doc.requires.filter((r) => !FEATURES.has(r));
  if (missing.length) refuse("host_too_old", `${what} requires ${missing.join(", ")}, which this host doesn't implement`);
  return doc.requires;
}

// Structural check of a keyring payload. Returns a normalised keyring.
export function readKeyring(doc) {
  checkRequires(doc, "keyring");
  if (!Number.isSafeInteger(doc.keyring) || doc.keyring < 1) refuse("malformed", "keyring must be a positive integer");
  if (typeof doc.app !== "string" || !doc.app) refuse("malformed", "keyring must name its app");
  if (!isObj(doc.keys)) refuse("malformed", "keyring.keys must be an object of kid -> { suite, pub }");
  const keys = new Map();
  for (const [kid, k] of Object.entries(doc.keys)) {
    if (!KID_RE.test(kid) || !isObj(k) || typeof k.suite !== "string") refuse("malformed", `keys.${kid} is badly formed`);
    let pub;
    try { pub = b64u.dec(k.pub); } catch { refuse("malformed", `keys.${kid}.pub is not base64url`); }
    if (kidOf(k.suite, pub) !== kid) refuse("malformed", `keys.${kid} doesn't match its suite and public key`);
    if (implemented(k.suite) && pub.length !== SUITES[k.suite].pubBytes) refuse("malformed", `keys.${kid} has the wrong length for ${k.suite}`);
    keys.set(kid, { suite: k.suite, pub });
  }
  if (!isObj(doc.roles)) refuse("malformed", "keyring.roles must be an object");
  const roles = {};
  for (const [role, groups] of Object.entries(doc.roles)) {
    if (!Array.isArray(groups) || groups.length === 0) refuse("malformed", `roles.${role} must be a non-empty list of groups`);
    roles[role] = groups.map((g, i) => {
      const at = `roles.${role}[${i}]`;
      if (!isObj(g) || typeof g.suite !== "string" || !Array.isArray(g.keys) || g.keys.length === 0) refuse("malformed", `${at} must be { suite, keys, threshold }`);
      if (new Set(g.keys).size !== g.keys.length) refuse("malformed", `${at} lists a key twice`);
      for (const kid of g.keys) {
        if (!keys.has(kid)) refuse("malformed", `${at} names ${kid}, which isn't in keys`);
        if (keys.get(kid).suite !== g.suite) refuse("malformed", `${at} is a ${g.suite} group but ${kid} is ${keys.get(kid).suite}`);
      }
      if (!Number.isSafeInteger(g.threshold) || g.threshold < 1 || g.threshold > g.keys.length) refuse("malformed", `${at}.threshold must be between 1 and ${g.keys.length}`);
      return { suite: g.suite, keys: [...g.keys], threshold: g.threshold };
    });
  }
  for (const r of ["root", "release"]) if (!roles[r]) refuse("malformed", `keyring must define the ${r} role`);
  if (!isObj(doc.spare) || typeof doc.spare.suite !== "string" || !KID_RE.test(doc.spare.kid ?? "")) refuse("malformed", "keyring must commit to a spare root key: spare { suite, kid }");
  if (keys.has(doc.spare.kid)) refuse("malformed", "the spare root key must not be an active key");
  // A host can't judge a group whose suite it lacks. Say so plainly rather than call it malformed.
  for (const [role, groups] of Object.entries(roles)) for (const g of groups) {
    if (!implemented(g.suite) && (role === "root" || role === "release")) refuse("host_too_old", `roles.${role} uses the ${g.suite} suite, which this host doesn't implement`);
  }
  if (!roles.root.some((g) => SUITES[g.suite].quantumSafe)) refuse("weak_root", "the root role must include a quantum-safe group");
  return { keyring: doc.keyring, app: doc.app, keys, roles, spare: { suite: doc.spare.suite, kid: doc.spare.kid }, requires: doc.requires ?? [], doc };
}

// Does the set of valid signers meet every group? `spare` may stand in for one missing key.
export function meets(groups, signers, spare = null) {
  let spareUsed = false;
  const short = [];
  for (const g of groups) {
    let n = g.keys.filter((kid) => signers.get(kid) === g.suite).length;
    if (n < g.threshold && spare && !spareUsed && spare.suite === g.suite && signers.get(spare.kid) === g.suite) { n++; spareUsed = true; }
    if (n < g.threshold) short.push(`${g.suite} ${n}/${g.threshold}`);
  }
  return { ok: short.length === 0, short, spareUsed };
}

const lookupIn = (kr) => (kid) => kr.keys.get(kid) ?? null;

// The first keyring a device trusts. It ships with the host (or is pinned by its SHA-256 at install),
// and must be signed under its own root policy.
export async function trustFirstKeyring(env, { pin } = {}) {
  const u = unwrap(env, KEYRING);
  if (pin && sha256hex(u.payload) !== pin) refuse("untrusted", "this keyring doesn't match the pinned hash");
  const kr = readKeyring(parseStrict(u.payload, "keyring"));
  const m = meets(kr.roles.root, await validSigners(u, lookupIn(kr)));
  if (!m.ok) refuse("untrusted", `keyring ${kr.keyring} isn't signed under its own root policy (${m.short.join(", ")})`);
  return kr;
}

// Moves from the keyring the device holds to the next one, or refuses.
export async function nextKeyring(cur, env) {
  const u = unwrap(env, KEYRING);
  // Verify first, under the policy the device already holds. The spare may stand in for one key.
  const old = meets(cur.roles.root, await validSigners(u, lookupIn(cur), new Map([[cur.spare.kid, cur.spare.suite]])), cur.spare);
  if (!old.ok) refuse("untrusted", `not signed under the current root policy (keyring ${cur.keyring}: ${old.short.join(", ")})`);
  // Parse second.
  const next = readKeyring(parseStrict(u.payload, "keyring"));
  if (next.app !== cur.app) refuse("wrong_app", `keyring is for ${next.app}, this device runs ${cur.app}`);
  if (next.keyring <= cur.keyring) refuse("stale", `keyring ${next.keyring} isn't newer than ${cur.keyring}`);
  const fresh = meets(next.roles.root, await validSigners(u, lookupIn(next)));
  if (!fresh.ok) refuse("untrusted", `not signed under its own new root policy (${fresh.short.join(", ")})`);
  if (old.spareUsed && next.spare.kid === cur.spare.kid) refuse("malformed", "the spare was revealed, so the next keyring must commit to a new spare");
  return { ...next, revealedSpare: old.spareUsed };
}

// A release: an LLP manifest wrapped in the envelope and signed by the release role.
//   payload { app, manifest, requires?, expires? }
// clock "trusted": a past `expires` refuses. clock "untrusted" (a device with no reliable time):
// expiry is not judged, and only signatures and rising numbers decide.
export async function verifyRelease(kr, env, { clock = "trusted", now = Date.now() } = {}) {
  const u = unwrap(env, RELEASE);
  const valid = await validSigners(u, lookupIn(kr));
  const m = meets(kr.roles.release, valid);
  if (!m.ok) refuse("untrusted", `release isn't signed under the release policy of keyring ${kr.keyring} (${m.short.join(", ")})`);
  const doc = parseStrict(u.payload, "release");
  checkRequires(doc, "release");
  if (doc.app !== kr.app) refuse("wrong_app", `release is for ${doc.app}, this device runs ${kr.app}`);
  if (!isObj(doc.manifest) || doc.manifest.app !== doc.app) refuse("malformed", "release.manifest must be an LLP manifest for the same app");
  if (doc.expires !== undefined) {
    if (!Number.isSafeInteger(doc.expires)) refuse("malformed", "expires must be milliseconds since 1970");
    if (clock === "trusted" && now > doc.expires) refuse("expired", `release expired at ${new Date(doc.expires).toISOString()}`);
  }
  // signers: the release-role keys that validly signed, so the device can always say who is accountable.
  const releaseKids = new Set(kr.roles.release.flatMap((g) => g.keys));
  return { app: doc.app, manifest: doc.manifest, expires: doc.expires ?? null, signers: [...valid.keys()].filter((k) => releaseKids.has(k)) };
}
