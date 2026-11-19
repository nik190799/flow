// The FLOW envelope: one wrapper for every signed document.
//
//   { "flow": 1, "type": "<document kind>", "payload": "<base64url bytes>", "sigs": [{ "kid", "sig" }] }
//
// Signatures cover exact bytes, never re-serialised JSON. The signed bytes are
//
//   "FLOWv1" SP len(type) SP type SP len(payload) SP payload
//
// where len is the byte length in ASCII decimal (the DSSE construction, with FLOW's own prefix). The
// document kind is inside the signature, so a signature over a keyring can't be replayed as a release.
// The wrapper itself is never signed: reformatting it, reordering it or adding fields to it changes
// nothing, and a verifier ignores wrapper fields it doesn't know.
//
// Verify first, parse second: the payload is parsed only after its signatures have been counted.
import { te, concat, b64u } from "./bytes.js";
import { refuse } from "./errors.js";
import { SUITES, kidOf } from "./suites.js";

export const ENVELOPE_VERSION = 1;
export const MAX_PAYLOAD = 1 << 20;
export const MAX_SIGS = 64;
const TYPE_RE = /^[a-z0-9][a-z0-9./-]{0,63}$/;
const KID_RE = /^sha256:[0-9a-f]{64}$/;

export function pae(type, payload) {
  const t = te.encode(type);
  return concat(te.encode(`FLOWv1 ${t.length} `), t, te.encode(` ${payload.length} `), payload);
}

export async function seal(type, payload, keys) {
  if (!TYPE_RE.test(type)) throw new Error(`bad document type ${type}`);
  const bytes = typeof payload === "string" ? te.encode(payload) : payload instanceof Uint8Array ? payload : te.encode(JSON.stringify(payload));
  const msg = pae(type, bytes);
  const sigs = [];
  for (const k of keys) sigs.push(await sigEntry(msg, k));
  return { flow: ENVELOPE_VERSION, type, payload: b64u.enc(bytes), sigs };
}

// A key marked { reveal: true } (a spare root key being used for the first time) also carries its
// public key, because the verifier holds only its kid.
async function sigEntry(msg, k) {
  const e = { kid: k.kid, sig: b64u.enc(await SUITES[k.suite].sign(msg, b64u.dec(k.secret))) };
  if (k.reveal) e.pub = k.pub;
  return e;
}

// Adds signatures to an existing envelope without touching its payload (for multi-party signing).
export async function cosign(env, keys) {
  const msg = pae(env.type, b64u.dec(env.payload));
  const sigs = [...env.sigs];
  for (const k of keys) sigs.push(await sigEntry(msg, k));
  return { ...env, sigs };
}

// Reads the wrapper and returns { type, payload, sigs } with decoded bytes, or refuses.
export function unwrap(env, expectType) {
  if (!env || typeof env !== "object" || Array.isArray(env)) refuse("malformed", "envelope must be a JSON object");
  if (env.flow !== ENVELOPE_VERSION) {
    if (Number.isSafeInteger(env.flow) && env.flow > ENVELOPE_VERSION) refuse("host_too_old", `envelope format ${env.flow}; this host reads format ${ENVELOPE_VERSION}`);
    refuse("malformed", "envelope must say flow: 1");
  }
  if (typeof env.type !== "string" || !TYPE_RE.test(env.type)) refuse("malformed", "envelope type is missing or badly formed");
  if (expectType && env.type !== expectType) refuse("wrong_type", `expected a ${expectType} document, got ${env.type}`);
  let payload;
  try { payload = b64u.dec(env.payload); } catch { refuse("malformed", "payload is not base64url"); }
  if (payload.length > MAX_PAYLOAD) refuse("malformed", `payload is over ${MAX_PAYLOAD} bytes`);
  if (!Array.isArray(env.sigs) || env.sigs.length > MAX_SIGS) refuse("malformed", `sigs must be a list of at most ${MAX_SIGS}`);
  const sigs = env.sigs.map((s, i) => {
    if (!s || typeof s !== "object" || typeof s.kid !== "string" || !KID_RE.test(s.kid)) refuse("malformed", `sigs[${i}] needs a kid of the form sha256:<hex>`);
    let sig, pub;
    try { sig = b64u.dec(s.sig); } catch { refuse("malformed", `sigs[${i}].sig is not base64url`); }
    // pub is only read for a key the verifier doesn't already hold (a revealed spare); it is bound by the kid.
    if (s.pub !== undefined) { try { pub = b64u.dec(s.pub); } catch { refuse("malformed", `sigs[${i}].pub is not base64url`); } }
    return { kid: s.kid, sig, pub };
  });
  return { type: env.type, payload, sigs };
}

// Returns the set of kids whose signature over (type, payload) is valid. `lookup(kid)` gives
// { suite, pub: Uint8Array } for keys the caller already trusts as candidates, or null. A key the
// caller doesn't hold can still be checked when `extra` allows its kid and the sig entry carries pub.
// Signatures by unknown kids, or by suites this host lacks, are ignored, never fatal: whether they
// were needed is the trust policy's question.
export async function validSigners(u, lookup, extra = new Map()) {
  const msg = pae(u.type, u.payload);
  const ok = new Map(); // kid -> suite
  for (const s of u.sigs) {
    if (ok.has(s.kid)) continue; // the same key counts once
    let key = lookup(s.kid);
    if (!key && extra.has(s.kid) && s.pub) {
      const suite = extra.get(s.kid);
      if (kidOf(suite, s.pub) === s.kid) key = { suite, pub: s.pub };
    }
    if (!key || !SUITES[key.suite]) continue;
    if (await SUITES[key.suite].verify(s.sig, msg, key.pub)) ok.set(s.kid, key.suite);
  }
  return ok;
}
