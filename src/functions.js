// Revision B1: directions, data labels, personal functions and grants.
//
// The company's release may open DIRECTIONS: named spots in the app where a person's own functions may
// run. For each it says what a function there may read, which capabilities it may use, and how
// sensitive the data is that may leave the device through it. The release also labels data
// (public, personal or secret) and says which capabilities carry data off the device.
//
// A FUNCTION is a small signed layer that fills one direction. It is signed by a person enrolled on
// this device, or by an agent holding a time-limited GRANT from such a person. The device checks it
// against the direction before any of its code runs. The company never signs it and never sees it.
//
// Everything here is a pure check; FlowHost (host.js) holds the state and applies the result.
import { refuse } from "./errors.js";
import { parseStrict } from "./json.js";
import { unwrap, validSigners } from "./envelope.js";
import { checkRequires } from "./keyring.js";
import { b64u } from "./bytes.js";
import { kidOf, implemented, SUITES } from "./suites.js";

export const FUNCTION = "flow/function";
export const GRANT = "flow/grant";

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const LEVEL = { none: 0, public: 1, personal: 2, secret: 3 };
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const prefixes = (v, what) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 64 || !v.every((p) => typeof p === "string" && p.length > 0 && p.length <= 256)) refuse("malformed", `${what} must be a list of up to 64 key prefixes`);
  return v;
};
const names = (v, what) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 64 || !v.every((p) => typeof p === "string" && p.length > 0 && p.length <= 64)) refuse("malformed", `${what} must be a list of up to 64 names`);
  return v;
};
const overlaps = (a, b) => a.startsWith(b) || b.startsWith(a);
export const FN_KEYS = "fn/";   // state under this prefix belongs to people's functions
export const FN_SLOTS = "fn.";  // slot names with this prefix are people's functions

// ---------- what the release declares ----------

// Reads the FLOW parts of a release payload: data labels, capability descriptions, core slots, directions.
export function readPolicy(doc) {
  const policy = { data: null, capabilities: new Map(), core: null, directions: new Map() };
  if (doc.data !== undefined) {
    if (!isObj(doc.data)) refuse("malformed", "data must be an object of key prefix -> label");
    policy.data = new Map();
    for (const [p, label] of Object.entries(doc.data)) {
      if (!p || !["public", "personal", "secret"].includes(label)) refuse("malformed", `data.${p} must be public, personal or secret`);
      // What a person's functions store is the person's, and always counts as personal.
      if (overlaps(p, FN_KEYS)) refuse("malformed", `data.${p}: keys under ${FN_KEYS} belong to people's functions and can't be relabelled`);
      policy.data.set(p, label);
    }
  }
  if (doc.capabilities !== undefined) {
    if (!isObj(doc.capabilities)) refuse("malformed", "capabilities must be an object of name -> { egress, returns }");
    for (const [name, c] of Object.entries(doc.capabilities)) {
      if (!isObj(c) || (c.egress !== undefined && typeof c.egress !== "boolean") || (c.returns !== undefined && !Object.hasOwn(LEVEL, c.returns)))
        refuse("malformed", `capabilities.${name} must be { egress: true | false, returns: none | public | personal | secret }`);
      policy.capabilities.set(name, { egress: c.egress === true, returns: c.returns ?? "none" });
    }
  }
  if (doc.core !== undefined) policy.core = new Set(names(doc.core, "core"));
  if (doc.directions !== undefined) {
    if (!isObj(doc.directions)) refuse("malformed", "directions must be an object");
    const m = doc.manifest;
    if (Object.keys(doc.directions).length && (!isObj(m.keys) || !isObj(m.caps))) refuse("malformed", "a release that opens directions must declare keys and caps for its own slots, so functions are kept apart from them");
    for (const [name, d] of Object.entries(doc.directions)) {
      if (!ID_RE.test(name) || !isObj(d)) refuse("malformed", `directions.${name} is badly formed`);
      const read = prefixes(d.read, `directions.${name}.read`), caps = names(d.caps, `directions.${name}.caps`);
      const egress = d.egress ?? "none";
      if (!["none", "public", "personal"].includes(egress)) refuse("malformed", `directions.${name}.egress must be none, public or personal`);
      const max = d.max ?? 8;
      if (!Number.isSafeInteger(max) || max < 1 || max > 64) refuse("malformed", `directions.${name}.max must be between 1 and 64`);
      if (d.after !== undefined && !Object.hasOwn(m.layers ?? {}, d.after)) refuse("malformed", `directions.${name}.after names a slot the release doesn't have`);
      // Secret data is never offered to a function, whatever else the direction says.
      for (const p of read) if (labelOf(policy, p) === "secret") refuse("malformed", `directions.${name} offers "${p}", which is labelled secret`);
      for (const c of caps) if (gives(policy, c) === "secret") refuse("malformed", `directions.${name} offers the ${c} capability, which returns secret data`);
      policy.directions.set(name, { read, caps, egress, max, after: d.after ?? null });
    }
  }
  return policy;
}

// The label of everything a read prefix could reach: the most sensitive label among overlapping
// declared prefixes. Data nobody labelled counts as personal.
export function labelOf(policy, prefix) {
  let level = 0, covered = false;
  for (const [p, label] of policy.data ?? []) {
    if (!overlaps(prefix, p)) continue;
    level = Math.max(level, LEVEL[label]);
    if (prefix.startsWith(p)) covered = true;
  }
  if (!covered) level = Math.max(level, LEVEL.personal);
  return Object.keys(LEVEL).find((k) => LEVEL[k] === level);
}

// A capability the release didn't describe is assumed to carry data off the device, and to hand
// personal data to whoever calls it.
const leaves = (policy, cap) => policy.capabilities.get(cap)?.egress ?? true;
const gives = (policy, cap) => policy.capabilities.get(cap)?.returns ?? "personal";

// What is the most sensitive data this code can get at (by reading state or by calling a capability
// that returns data), and can it send anything out?
export function flowOf(policy, reads, caps) {
  let sens = reads.reduce((l, p) => Math.max(l, LEVEL[labelOf(policy, p)]), 0);
  for (const c of caps) sens = Math.max(sens, LEVEL[gives(policy, c)]);
  const out = caps.filter((c) => leaves(policy, c));
  return { sensitivity: Object.keys(LEVEL).find((k) => LEVEL[k] === sens), egress: out };
}

// Release-time check for the company's own non-core slots: once a release labels its data, a slot that
// can read personal or secret data and also holds a capability that leaves the device is refused,
// unless the release names the slot as core (the company's own app, which it answers for).
export function checkReleaseFlow(doc, policy) {
  const m = doc.manifest;
  // The company's own slots stay out of the space kept for people's functions.
  for (const slot of Object.keys(isObj(m.layers) ? m.layers : {})) {
    if (slot.startsWith(FN_SLOTS)) refuse("malformed", `slot ${slot}: names starting "${FN_SLOTS}" are kept for people's functions`);
    for (const p of (isObj(m.keys) && isObj(m.keys[slot]) && Array.isArray(m.keys[slot].own)) ? m.keys[slot].own : [])
      if (typeof p === "string" && overlaps(p, FN_KEYS)) refuse("malformed", `slot ${slot} claims "${p}": keys under ${FN_KEYS} belong to people's functions`);
  }
  if (!policy.data) return;
  for (const slot of Object.keys(m.layers ?? {})) {
    if (policy.core?.has(slot)) continue;
    const k = isObj(m.keys) ? m.keys[slot] ?? {} : null;
    if (!k) refuse("malformed", "a release that labels data must declare keys for its slots");
    const reads = [...(k.own ?? []), ...(k.read ?? [])];
    const caps = isObj(m.caps) ? m.caps[slot] ?? [] : null;
    if (!caps) refuse("malformed", "a release that labels data must declare caps for its slots");
    const f = flowOf(policy, reads, caps);
    if (f.egress.length && LEVEL[f.sensitivity] >= LEVEL.personal) refuse("would_leak", `slot ${slot} can read ${f.sensitivity} data and use ${f.egress.join(", ")}, which leaves the device; name it in core if that is the company's own code`);
  }
}

// ---------- grants ----------

// A grant: a person passes a narrower slice of their authority to an agent's key, for a limited time.
//   payload { app, agent: { suite, pub }, directions: [names], notAfter: ms, caps?: [names] }
// Returns the checked grant, or refuses. `people` is the device's map of enrolled person keys.
export async function verifyGrant(env, { app, people, clock, now, revoked }) {
  const u = unwrap(env, GRANT);
  const ok = await validSigners(u, (kid) => people.get(kid) ?? null);
  const person = [...ok.keys()][0];
  if (!person) refuse("untrusted", "this grant isn't signed by a person enrolled on this device");
  const doc = parseStrict(u.payload, "grant");
  checkRequires(doc, "grant");
  if (doc.app !== app) refuse("wrong_app", `grant is for ${doc.app}`);
  if (!isObj(doc.agent) || typeof doc.agent.suite !== "string") refuse("malformed", "grant.agent must be { suite, pub }");
  let pub;
  try { pub = b64u.dec(doc.agent.pub); } catch { refuse("malformed", "grant.agent.pub is not base64url"); }
  if (!implemented(doc.agent.suite)) refuse("host_too_old", `grant names an agent key in the ${doc.agent.suite} suite, which this host doesn't implement`);
  if (pub.length !== SUITES[doc.agent.suite].pubBytes) refuse("malformed", "grant.agent.pub has the wrong length");
  const directions = names(doc.directions, "grant.directions");
  if (!Number.isSafeInteger(doc.notAfter)) refuse("malformed", "a grant must carry notAfter, in milliseconds since 1970");
  // A grant's whole point is its time limit, so a device that can't tell the time doesn't accept grants.
  if (clock !== "trusted") refuse("untrusted", "this device has no trusted clock, so it can't check a grant's time limit; the person must sign directly");
  if (now > doc.notAfter) refuse("expired", `the grant expired at ${new Date(doc.notAfter).toISOString()}`);
  const id = kidOf("grant", u.payload);
  if (revoked.has(id)) refuse("untrusted", "this grant was revoked on this device");
  return { id, person, agent: { kid: kidOf(doc.agent.suite, pub), suite: doc.agent.suite, pub }, directions, caps: doc.caps === undefined ? null : names(doc.caps, "grant.caps"), notAfter: doc.notAfter };
}

// ---------- functions ----------

// A function document:
//   payload { app, direction, id, seq, layer, reads?, caps?, intent? }
// signed by an enrolled person, or by an agent whose grant rides in the (unsigned) wrapper as `grant`.
// Verify first: signatures are settled before the payload is parsed.
export async function verifyFunction(env, { app, people, policy, clock, now, revoked }) {
  const u = unwrap(env, FUNCTION);
  let grant = null, signer, owner;
  if (env.grant !== undefined) {
    grant = await verifyGrant(env.grant, { app, people, clock, now, revoked });
    const ok = await validSigners(u, (kid) => (kid === grant.agent.kid ? grant.agent : null));
    if (!ok.has(grant.agent.kid)) refuse("untrusted", "this function isn't signed by the agent its grant names");
    signer = grant.agent.kid; owner = grant.person;
  } else {
    const ok = await validSigners(u, (kid) => people.get(kid) ?? null);
    signer = owner = [...ok.keys()][0];
    if (!owner) refuse("untrusted", "this function isn't signed by a person enrolled on this device");
  }
  const doc = parseStrict(u.payload, "function");
  checkRequires(doc, "function");
  if (doc.app !== app) refuse("wrong_app", `function is for ${doc.app}`);
  if (typeof doc.direction !== "string" || !ID_RE.test(doc.id ?? "")) refuse("malformed", "a function needs a direction and an id (lowercase letters, digits, dashes)");
  if (!Number.isSafeInteger(doc.seq) || doc.seq < 1) refuse("malformed", "seq must be a positive integer");
  if (typeof doc.layer !== "string" || !HASH_RE.test(doc.layer)) refuse("malformed", "layer must be a lowercase hex SHA-256");
  const reads = prefixes(doc.reads, "reads"), caps = names(doc.caps, "caps");
  if (doc.intent !== undefined && (typeof doc.intent !== "string" || doc.intent.length > 2000)) refuse("malformed", "intent must be text of at most 2000 characters");
  if (grant) {
    if (!grant.directions.includes(doc.direction)) refuse("untrusted", `the grant doesn't cover the ${doc.direction} direction`);
    if (grant.caps && !caps.every((c) => grant.caps.includes(c))) refuse("untrusted", "the function asks for a capability its grant doesn't pass on");
  }
  const fn = { direction: doc.direction, id: doc.id, seq: doc.seq, layer: doc.layer, reads, caps, intent: doc.intent ?? null, owner, signer, grant: grant?.id ?? null };
  return { fn, grant, ...fits(policy, fn) };
}

// Does a function fit the directions of a release? Used at install and again on every company release.
// Returns { problem: null | { code, reason }, consent: null | { cap, sensitivity } }.
export function fits(policy, fn) {
  const d = policy?.directions.get(fn.direction);
  if (!d) return { problem: { code: "not_open", reason: `the app has no open direction called ${fn.direction}` }, consent: null };
  const badRead = fn.reads.find((p) => !d.read.some((q) => p.startsWith(q)));
  if (badRead !== undefined) return { problem: { code: "exceeds_direction", reason: `${fn.direction} doesn't offer "${badRead}"` }, consent: null };
  const badCap = fn.caps.find((c) => !d.caps.includes(c));
  if (badCap !== undefined) return { problem: { code: "exceeds_direction", reason: `${fn.direction} doesn't offer the ${badCap} capability` }, consent: null };
  const f = flowOf(policy, fn.reads, fn.caps);
  if (f.egress.length && LEVEL[f.sensitivity] > LEVEL[d.egress]) {
    return { problem: { code: "would_leak", reason: `it reads ${f.sensitivity} data and uses ${f.egress.join(", ")}, which leaves the device; ${fn.direction} allows ${d.egress === "none" ? "nothing" : "only " + d.egress + " data"} to leave` }, consent: null };
  }
  // Allowed by the company's ceiling, but personal data leaving still needs the person's own yes.
  const consent = f.egress.length && LEVEL[f.sensitivity] >= LEVEL.personal ? { caps: f.egress, sensitivity: f.sensitivity } : null;
  return { problem: null, consent };
}

export const slotOf = (fn) => `fn.${fn.direction}.${fn.id}`;
export const ownPrefix = (fn) => `fn/${fn.direction}/${fn.id}/`;
