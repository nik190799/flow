// FlowHost: an LLP LiveHost whose trust decisions are made by FLOW.
//
// FLOW depends on LLP as a library and doesn't change it. The LLP host keeps doing everything it does
// today (fetching layers by hash, sandboxing, staging, migrating, atomic swap, rollback); FLOW decides
// what is allowed to reach it:
//   - releases arrive as FLOW envelopes and must meet the release policy of the device's keyring;
//   - the keyring changes only under the rules in keyring.js;
//   - every layer must stay within WebAssembly 1.0 (option wasm: "any" turns this off);
//   - on a device with no trustworthy clock (clock: "untrusted"), no decision depends on the time;
//   - (B1) a person enrolled on the device may add their own functions in the directions the release
//     opened, checked against the release's data labels; they can undo or remove them at any time.
//
// Bridge: the LLP host verifies an LLP signature on every manifest and fails closed without one. FlowHost
// gives it a key that exists only in this process. What the LLP host runs is the EFFECTIVE manifest:
// the company's manifest plus one slot per running function, each fenced into its own keys and the
// capabilities its direction allows. FLOW signs that with the bridge key only after every check
// passed, so no LLP safety check is switched off and nothing FLOW refused can reach the LLP host.
// The LLP host sees a private, rising counter as the version; FLOW keeps the company's own
// (epoch, version) and applies the same replay rules to it.
import { LiveHost, generatePublisherKey, signManifest } from "live-layer-protocol/host/llp-core.js";
import { FlowError, refuse } from "./errors.js";
import { trustFirstKeyring, nextKeyring, verifyRelease } from "./keyring.js";
import { wasm1Problem } from "./wasm1.js";
import { readPolicy, checkReleaseFlow, verifyFunction, fits, slotOf, ownPrefix, FN_SLOTS } from "./functions.js";
import { b64u } from "./bytes.js";
import { kidOf, implemented, SUITES } from "./suites.js";
import { asTools } from "./present/tools.js";

const YEAR_MS = 365 * 24 * 3600 * 1000;
const under = (prefixes, k) => prefixes.some((p) => k.startsWith(p));

export class FlowHost {
  static async create({ keyring, pin, clock = "trusted", wasm = "1.0", now = () => Date.now(), onRender = null, onLog = null, onConsent = null, ...llpOptions }) {
    if (!["trusted", "untrusted"].includes(clock)) throw new Error('clock is "trusted" or "untrusted"');
    if (!["1.0", "any"].includes(wasm)) throw new Error('wasm is "1.0" or "any"');
    const kr = await trustFirstKeyring(keyring, { pin });
    const bridge = await generatePublisherKey();
    const flow = new FlowHost(kr, bridge.privateKey, { clock, wasm, now, onConsent });
    flow.onRender = onRender;
    flow.onLog = onLog;
    flow.llp = new LiveHost({
      ...llpOptions,
      app: kr.app,
      trustedKeys: [bridge.publicJwk],
      // The LLP host sees FLOW's private counter, so its "too far ahead of now" check has nothing to judge.
      maxVersionAheadMs: Number.MAX_SAFE_INTEGER,
      onRender: (t) => { flow.tree = t; flow.onRender?.(t); },
      onLog: (e) => { if ((e.kind === "rollback" || e.kind === "error") && e.slot?.startsWith(FN_SLOTS)) flow.crashed.set(e.slot, e.msg); flow.onLog?.(e); },
    });
    return flow;
  }

  constructor(kr, bridgeKey, opts) {
    this.keyring = kr;
    this.bridgeKey = bridgeKey;
    this.opts = opts;
    this.refusals = [];
    this.ledger = [];            // every accepted change: what, who signed, who answers for it
    this.company = null;         // { epoch, version, manifest, policy, signers }
    this.people = new Map();     // kid -> { suite, pub, name }: the people enrolled on this device
    this.functions = new Map();  // slot -> { fn, consented, history: [{ fn, before, consented }], paused }
    this.seqs = new Map();       // slot -> { owner, highest }: kept after removal, so an old version can't come back
    this.revoked = new Set();    // grant ids the person revoked
    this.crashed = new Map();    // function slots whose code failed since the last settle
    this.live = new Map();       // key -> { value, n }: text typed but not yet in stored state
    this.liveN = 0;
    this.tree = [];
    this.queue = Promise.resolve();
  }

  refused(e) {
    if (!(e instanceof FlowError)) throw e;
    const r = { ok: false, code: e.code, reason: e.message };
    this.refusals.push(r);
    return r;
  }
  // Changes to what runs happen one at a time.
  serial(fn) { const r = this.queue.then(fn); this.queue = r.catch(() => {}); return r; }
  record(entry) { this.ledger.push({ at: this.opts.now(), ...entry }); }
  who(kid) { return { kid, name: this.people.get(kid)?.name ?? null }; }

  // ---------- trust ----------

  // A new trust policy. Refusals leave the current keyring in place.
  updateKeyring(env) {
    return this.serial(async () => {
      try {
        const next = await nextKeyring(this.keyring, env);
        this.keyring = next;
        return { ok: true, keyring: next.keyring, revealedSpare: next.revealedSpare };
      } catch (e) { return this.refused(e); }
    });
  }

  // The same replay rules the LLP host applies, here applied to the company's own numbers.
  checkVersion(m) {
    const v = m.version, e = m.epoch ?? 0;
    if (!Number.isSafeInteger(v) || v < 1) refuse("bad_version", `version must be a positive safe integer, got ${JSON.stringify(v)}`);
    if (!Number.isSafeInteger(e) || e < 0) refuse("bad_version", `epoch must be a non-negative safe integer, got ${JSON.stringify(e)}`);
    if (e > this.keyring.keyring) refuse("bad_version", `epoch ${e} is beyond the trusted keyring (${this.keyring.keyring})`);
    const ce = this.company?.epoch ?? 0, cv = this.company?.version ?? 0;
    if (e < ce) refuse("stale", `stale epoch ${e} < ${ce}`);
    if (e === ce && v <= cv) refuse("stale", `stale version ${v} ≤ ${cv}`);
    if (this.opts.clock === "trusted") {
      const base = Math.max(e === ce ? cv : 0, this.opts.now());
      if (v > base + YEAR_MS) refuse("bad_version", `version ${v} is too far ahead (limit ${base + YEAR_MS}); it would block every later release`);
    }
  }

  // ---------- what the LLP host is given ----------

  // The company's manifest plus one fenced slot per running function.
  compose(manifest, policy, recs) {
    const m = structuredClone(manifest);
    delete m.epoch;
    m.version = this.llp.version + 1;
    if (!recs.length) return m;
    const order = [...(m.order ?? Object.keys(m.layers).sort())];
    for (const { fn } of recs) {
      const slot = slotOf(fn), d = policy.directions.get(fn.direction);
      m.layers[slot] = fn.layer;
      m.keys[slot] = { own: [ownPrefix(fn)], read: [...fn.reads] };
      m.caps[slot] = [...fn.caps];
      // A direction's functions appear after its anchor slot, in the order they were installed.
      let at = d.after ? order.indexOf(d.after) + 1 : order.length;
      while (at < order.length && order[at].startsWith(`${FN_SLOTS}${fn.direction}.`)) at++;
      order.splice(at, 0, slot);
    }
    m.order = order;
    return m;
  }

  async push(manifest, policy, recs, fetchBlob) {
    const m = this.compose(manifest, policy, recs);
    let tooNew = null;
    const fetch = async (hash) => {
      const bytes = await fetchBlob?.(hash);
      if (bytes && this.opts.wasm === "1.0") {
        const p = wasm1Problem(bytes);
        if (p) { tooNew = `layer ${hash.slice(0, 8)} ${p}`; return null; }
      }
      return bytes;
    };
    const r = await this.llp.apply(m, await signManifest(m, this.bridgeKey), fetch);
    if (!r.ok && tooNew) return this.refused(new FlowError("not_wasm_1", tooNew));
    return r;
  }

  running_() { return [...this.functions.values()].filter((r) => !r.paused); }

  // ---------- the company's releases ----------

  // A release. fetchBlob(hash) returns layer bytes, from the network or from files.
  apply(env, fetchBlob) {
    return this.serial(async () => {
      let rel, policy;
      try {
        rel = await verifyRelease(this.keyring, env, { clock: this.opts.clock, now: this.opts.now() });
        policy = readPolicy(rel.doc);
        checkReleaseFlow(rel.doc, policy);
        this.checkVersion(rel.manifest);
      } catch (e) { return this.refused(e); }
      // A release can't break a person's function, and a function can't block a release: each
      // function is checked against the new directions, and one that no longer fits is paused with
      // its data kept, while the release goes ahead.
      const verdict = new Map();
      for (const [slot, rec] of this.functions) verdict.set(slot, this.judge(policy, rec));
      const recs = [...this.functions].filter(([slot]) => !verdict.get(slot)).map(([, rec]) => rec);
      const r = await this.push(rel.manifest, policy, recs, fetchBlob);
      if (!r.ok) return { ...r, version: rel.manifest.version };
      this.company = { epoch: rel.manifest.epoch ?? 0, version: rel.manifest.version, manifest: rel.manifest, policy, signers: rel.signers };
      const paused = [];
      for (const [slot, rec] of this.functions) {
        const was = rec.paused; rec.paused = verdict.get(slot);
        if (rec.paused) paused.push({ slot, ...rec.paused });
        if (rec.paused && !was) this.record({ kind: "paused", slot, code: rec.paused.code, reason: rec.paused.reason });
        if (!rec.paused && was) this.record({ kind: "resumed", slot });
      }
      this.record({ kind: "release", version: rel.manifest.version, epoch: this.company.epoch, keyring: this.keyring.keyring, signers: rel.signers, layers: { ...rel.manifest.layers } });
      await this.settleNow();
      return { ...r, version: rel.manifest.version, swapped: r.swapped, signers: rel.signers, paused };
    });
  }

  // Why a function can't run under a policy, or null. A function that crashed stays paused until the
  // person resumes, updates or undoes it.
  judge(policy, rec) {
    const f = fits(policy, rec.fn);
    if (f.problem) return f.problem;
    if (f.consent && !rec.consented) return { code: "needs_consent", reason: `it could now send ${f.consent.sensitivity} data out through ${f.consent.caps.join(", ")}; the person hasn't agreed to that` };
    return rec.paused?.code === "layer_failed" ? rec.paused : null;
  }

  // ---------- people ----------

  // Enrolment is a local act on the device (how the device knows it is really this person, a
  // passkey or a PIN, is the embedder's job). It lets that person's key sign functions and grants here.
  enrolPerson({ suite, pub, name = null }) {
    if (!implemented(suite)) throw new Error(`unknown suite ${suite}`);
    const bytes = typeof pub === "string" ? b64u.dec(pub) : pub;
    if (bytes.length !== SUITES[suite].pubBytes) throw new Error("public key has the wrong length");
    const kid = kidOf(suite, bytes);
    this.people.set(kid, { suite, pub: bytes, name });
    this.record({ kind: "enrol", person: { kid, name } });
    return kid;
  }
  // Forgetting a person removes their functions and the data those functions stored.
  async forgetPerson(kid) {
    for (const [slot, rec] of [...this.functions]) if (rec.fn.owner === kid) await this.removeFunction(slot);
    this.record({ kind: "forget", person: this.who(kid) });
    return this.people.delete(kid);
  }

  // ---------- a person's functions ----------

  ctx() { return { app: this.keyring.app, people: this.people, policy: this.company.policy, clock: this.opts.clock, now: this.opts.now(), revoked: this.revoked }; }

  // The function's own state: its keys and the schema number the LLP host keeps for its slot.
  snapshot(fn) {
    const p = ownPrefix(fn), kv = this.llp.kv;
    return { schema: kv.get(`__schema.${slotOf(fn)}`), keys: [...kv.entries()].filter(([k]) => k.startsWith(p)) };
  }
  restore(fn, snap) {
    return this.llp.exclusive(() => {
      const p = ownPrefix(fn), kv = this.llp.kv, s = `__schema.${slotOf(fn)}`;
      for (const k of [...kv.keys()]) if (k.startsWith(p)) kv.delete(k);
      for (const [k, v] of snap?.keys ?? []) kv.set(k, v);
      if (snap?.schema === undefined) kv.delete(s); else kv.set(s, snap.schema);
    });
  }
  // The running set with one slot replaced (or, with rec null, left out), order kept.
  withSlot(slot, rec) {
    const out = []; let placed = false;
    for (const [s, r] of this.functions) {
      if (s === slot) { if (rec) out.push(rec); placed = true; }
      else if (!r.paused) out.push(r);
    }
    if (rec && !placed) out.push(rec);
    return out;
  }

  // Installs or updates a function. The envelope is signed by an enrolled person, or by an agent
  // whose grant from such a person rides along. consent: true means the device has just asked the
  // person and they agreed to this function sending personal data out (see needs_consent).
  installFunction(env, fetchBlob, { consent = false } = {}) {
    return this.serial(async () => {
      let v, fn, slot, rec;
      try {
        if (!this.company) refuse("not_open", "no release is running on this device yet");
        v = await verifyFunction(env, this.ctx());
        if (v.problem) refuse(v.problem.code, v.problem.reason);
        fn = v.fn; slot = slotOf(fn); rec = this.functions.get(slot);
        const seen = this.seqs.get(slot);
        if (seen && seen.owner !== fn.owner) refuse("untrusted", `${fn.direction}/${fn.id} belongs to another person on this device`);
        if (seen && fn.seq <= seen.highest) refuse("stale", `seq ${fn.seq} isn't newer than ${seen.highest}`);
        const d = this.company.policy.directions.get(fn.direction);
        if (!rec && [...this.functions.values()].filter((r) => r.fn.direction === fn.direction).length >= d.max) refuse("not_open", `${fn.direction} already holds its limit of ${d.max} functions`);
        if (v.consent) {
          const yes = consent === true || (await this.opts.onConsent?.({ fn, ...v.consent, person: this.who(fn.owner) })) === true;
          if (!yes) refuse("needs_consent", `it reads ${v.consent.sensitivity} data and uses ${v.consent.caps.join(", ")}, which leaves the device; the person must agree to that on the device first`);
        }
      } catch (e) { return this.refused(e); }
      const entry = { fn, before: this.snapshot(fn), consented: !!v.consent };
      const next = { fn, consented: entry.consented, history: [...(rec?.history ?? []), entry], paused: null };
      const r = await this.push(this.company.manifest, this.company.policy, this.withSlot(slot, next), fetchBlob);
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      this.functions.set(slot, next);
      this.seqs.set(slot, { owner: fn.owner, highest: fn.seq });
      const grant = v.grant ? { id: v.grant.id, notAfter: v.grant.notAfter } : null;
      this.record({ kind: "function", slot, seq: fn.seq, layer: fn.layer, signers: [fn.signer], person: this.who(fn.owner), grant, intent: fn.intent, reads: fn.reads, caps: fn.caps });
      await this.settleNow();
      return { ok: true, ms: r.ms, slot, seq: fn.seq, signer: fn.signer, person: this.who(fn.owner), grant };
    });
  }

  // Undo, by the person, on the device: the function goes back to the version before, and its data
  // goes back to what it was just before that update. Undoing the first version removes it.
  // No signature is needed and nothing is asked of the company.
  undoFunction(slot) {
    return this.serial(async () => {
      const rec = this.functions.get(slot);
      if (!rec) return { ok: false, code: "not_open", reason: `no function called ${slot} on this device` };
      const top = rec.history.at(-1), rest = rec.history.slice(0, -1), now = this.snapshot(rec.fn);
      let next = null;
      if (rest.length) {
        const back = rest.at(-1);
        next = { fn: back.fn, consented: back.consented, history: rest, paused: null };
        next.paused = this.judge(this.company.policy, next);
      }
      await this.restore(rec.fn, top.before);
      const r = await this.push(this.company.manifest, this.company.policy, this.withSlot(slot, next?.paused ? null : next), null);
      if (!r.ok) { await this.restore(rec.fn, now); return { ok: false, code: r.code, reason: r.reason }; }
      if (next) this.functions.set(slot, next); else this.functions.delete(slot);
      this.crashed.delete(slot);
      this.record({ kind: "undo", slot, from: rec.fn.seq, to: next?.fn.seq ?? null, person: this.who(rec.fn.owner) });
      return { ok: true, ms: r.ms, slot, seq: next?.fn.seq ?? null, paused: next?.paused ?? null };
    });
  }

  // Removes a function and everything it stored.
  removeFunction(slot) {
    return this.serial(async () => {
      const rec = this.functions.get(slot);
      if (!rec) return { ok: false, code: "not_open", reason: `no function called ${slot} on this device` };
      if (!rec.paused) {
        const r = await this.push(this.company.manifest, this.company.policy, this.withSlot(slot, null), null);
        if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      }
      await this.restore(rec.fn, null);
      this.functions.delete(slot);
      this.crashed.delete(slot);
      this.record({ kind: "remove", slot, person: this.who(rec.fn.owner) });
      return { ok: true, slot };
    });
  }

  // Starts a paused function again, if it fits the running release.
  resumeFunction(slot, { consent = false } = {}) {
    return this.serial(async () => {
      const rec = this.functions.get(slot);
      if (!rec) return { ok: false, code: "not_open", reason: `no function called ${slot} on this device` };
      if (!rec.paused) return { ok: true, slot };
      const f = fits(this.company.policy, rec.fn);
      if (f.problem) return { ok: false, ...f.problem };
      if (f.consent && !rec.consented && consent !== true) return { ok: false, code: "needs_consent", reason: `it reads ${f.consent.sensitivity} data and uses ${f.consent.caps.join(", ")}, which leaves the device` };
      const next = { ...rec, consented: rec.consented || !!f.consent, paused: null };
      const r = await this.push(this.company.manifest, this.company.policy, this.withSlot(slot, next), null);
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      next.history.at(-1).consented = next.consented;
      this.functions.set(slot, next);
      this.record({ kind: "resumed", slot });
      await this.settleNow();
      return { ok: true, slot };
    });
  }

  // Ends a grant early. Functions already installed under it stay unless remove is true.
  async revokeGrant(id, { remove = false } = {}) {
    this.revoked.add(id);
    this.record({ kind: "revoke", grant: id });
    const slots = [...this.functions].filter(([, rec]) => rec.fn.grant === id).map(([slot]) => slot);
    if (remove) for (const slot of slots) await this.removeFunction(slot);
    return { ok: true, functions: slots, removed: remove };
  }

  // A function whose code failed is paused: the app carries on without it, and its data is kept.
  async settleNow() {
    if (!this.crashed.size) return;
    const hit = [...this.crashed]; this.crashed.clear();
    let changed = false;
    for (const [slot, msg] of hit) {
      const rec = this.functions.get(slot);
      if (!rec || rec.paused) continue;
      rec.paused = { code: "layer_failed", reason: msg };
      this.record({ kind: "paused", slot, code: "layer_failed", reason: msg });
      changed = true;
    }
    if (changed) await this.push(this.company.manifest, this.company.policy, this.running_(), null);
  }
  settle() { return this.crashed.size ? this.serial(() => this.settleNow()) : Promise.resolve(); }

  // What is running and under whose name: the company's release, the open directions, and each
  // function with its owner, signer, declared reach and state.
  inspect() {
    const c = this.company;
    return {
      app: this.keyring.app,
      keyring: this.keyring.keyring,
      release: c ? { version: c.version, epoch: c.epoch, signers: c.signers } : null,
      directions: c ? Object.fromEntries([...c.policy.directions].map(([n, d]) => [n, { ...d }])) : {},
      people: [...this.people].map(([kid, p]) => ({ kid, name: p.name })),
      functions: [...this.functions].map(([slot, { fn, paused, history }]) => ({
        slot, direction: fn.direction, id: fn.id, seq: fn.seq, layer: fn.layer, intent: fn.intent, reads: fn.reads, caps: fn.caps,
        person: this.who(fn.owner), signer: fn.signer, grant: fn.grant, versions: history.length, state: paused ? "paused" : "running", ...(paused ? { paused } : {}),
      })),
    };
  }
  // The changes made under one person's name (their own and their agents'), newest first.
  changesBy(kid) { return this.ledger.filter((e) => e.person?.kid === kid).reverse(); }

  // ---------- using the app ----------

  render() { return this.llp.render(); }
  async dispatch(slot, id, value = "") { await this.llp.dispatch(slot, id, value); await this.settle(); }

  // Text typed into a field bound to state. A slot's field can only write keys that slot owns.
  // The text is visible through bound() at once, even while a swap is in flight and the write to
  // stored state is waiting behind it, so a presenter never shows the person older text than they typed.
  setBound(slot, key, value) {
    const rule = this.llp.keyRules?.get(slot);
    if (!this.llp.slots.has(slot) || (rule && !under(rule.own, key))) return false;
    const n = ++this.liveN;
    this.live.set(key, { value, n });
    this.llp.setBound(key, value);
    const landed = () => { if (this.live.get(key)?.n === n) this.live.delete(key); };
    if (this.llp.pending) this.llp.exclusive(landed); else landed();
    return true;
  }
  // The current text of a bound field, for a presenter. A slot's field shows only keys that slot may read.
  bound(slot, key) {
    const rule = this.llp.keyRules?.get(slot);
    if (rule && !under(rule.own, key) && !under(rule.read, key)) return "";
    const v = this.live.get(key)?.value ?? this.llp.kv.get(key);
    return v === undefined || v === null ? "" : String(v);
  }

  // The actions on screen, as tools for an AI agent, and a way to call one. An agent can do through
  // these exactly what the person can do by hand.
  tools() { return (this.tree ?? []).flatMap((s) => (s.tree ? asTools(s.slot, s.tree) : [])); }
  async act(slot, action, fields = {}) {
    const t = this.tools().find((x) => x.slot === slot && x.action === action);
    if (!t) return { ok: false, code: "not_open", reason: `no action ${action} on ${slot} right now` };
    for (const [k, v] of Object.entries(fields)) {
      if (!t.fields.some((f) => f.field === k) || !this.setBound(slot, k, String(v))) return { ok: false, code: "exceeds_direction", reason: `${action} takes no field called ${k}` };
    }
    await this.dispatch(slot, action);
    return { ok: true };
  }

  get kv() { return this.llp.kv; }
  get version() { return this.company?.version ?? 0; }
  running() { return this.llp.running(); }
  close() { return this.llp.close(); }
}
