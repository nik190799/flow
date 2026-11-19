// FlowHost: an LLP LiveHost whose trust decisions are made by FLOW.
//
// FLOW depends on LLP as a library and doesn't change it. The LLP host keeps doing everything it does
// today (fetching layers by hash, sandboxing, staging, migrating, atomic swap, rollback); FLOW decides
// what is allowed to reach it:
//   - releases arrive as FLOW envelopes and must meet the release policy of the device's keyring;
//   - the keyring changes only under the rules in keyring.js;
//   - every layer must stay within WebAssembly 1.0 (option wasm: "any" turns this off);
//   - on a device with no trustworthy clock (clock: "untrusted"), no decision depends on the time.
//
// Bridge: the LLP host verifies an LLP signature on every manifest and fails closed without one. FlowHost
// gives it a key that exists only in this process, and signs a manifest with it only after FLOW has
// accepted the release. So no LLP safety check is switched off, and nothing FLOW refused can reach
// the LLP host. When A1 moves into LLP itself, this bridge goes away.
import { LiveHost, generatePublisherKey, signManifest } from "live-layer-protocol/host/llp-core.js";
import { FlowError } from "./errors.js";
import { trustFirstKeyring, nextKeyring, verifyRelease } from "./keyring.js";
import { wasm1Problem } from "./wasm1.js";

export class FlowHost {
  static async create({ keyring, pin, clock = "trusted", wasm = "1.0", now = () => Date.now(), ...llpOptions }) {
    if (!["trusted", "untrusted"].includes(clock)) throw new Error('clock is "trusted" or "untrusted"');
    if (!["1.0", "any"].includes(wasm)) throw new Error('wasm is "1.0" or "any"');
    const kr = await trustFirstKeyring(keyring, { pin });
    const bridge = await generatePublisherKey();
    const llp = new LiveHost({
      ...llpOptions,
      app: kr.app,
      trustedKeys: [bridge.publicJwk],
      // Without a trusted clock, LLP's "too far ahead of now" check would depend on a wrong time.
      ...(clock === "untrusted" ? { maxVersionAheadMs: Number.MAX_SAFE_INTEGER } : {}),
    });
    llp.maxEpoch = kr.keyring; // an LLP manifest may claim an epoch up to the device's keyring number
    return new FlowHost(kr, llp, bridge.privateKey, { clock, wasm, now });
  }

  constructor(kr, llp, bridgeKey, opts) {
    this.keyring = kr;
    this.llp = llp;
    this.bridgeKey = bridgeKey;
    this.opts = opts;
    this.refusals = [];
  }

  refused(e) {
    if (!(e instanceof FlowError)) throw e;
    const r = { ok: false, code: e.code, reason: e.message };
    this.refusals.push(r);
    return r;
  }

  // A new trust policy. Refusals leave the current keyring in place.
  async updateKeyring(env) {
    try {
      const next = await nextKeyring(this.keyring, env);
      this.keyring = next;
      this.llp.maxEpoch = Math.max(this.llp.maxEpoch, next.keyring);
      return { ok: true, keyring: next.keyring, revealedSpare: next.revealedSpare };
    } catch (e) { return this.refused(e); }
  }

  // A release. fetchBlob(hash) returns layer bytes, from the network or from files.
  async apply(env, fetchBlob) {
    let rel;
    try { rel = await verifyRelease(this.keyring, env, { clock: this.opts.clock, now: this.opts.now() }); }
    catch (e) { return this.refused(e); }
    let tooNew = null;
    const fetch = async (hash) => {
      const bytes = await fetchBlob(hash);
      if (bytes && this.opts.wasm === "1.0") {
        const p = wasm1Problem(bytes);
        if (p) { tooNew = `layer ${hash.slice(0, 8)} ${p}`; return null; }
      }
      return bytes;
    };
    const sig = await signManifest(rel.manifest, this.bridgeKey);
    const r = await this.llp.apply(rel.manifest, sig, fetch);
    if (!r.ok && tooNew) return this.refused(new FlowError("not_wasm_1", tooNew));
    return r;
  }

  render() { return this.llp.render(); }
  dispatch(slot, id) { return this.llp.dispatch(slot, id); }
  get kv() { return this.llp.kv; }
  get version() { return this.llp.version; }
  running() { return this.llp.running(); }
  close() { return this.llp.close(); }
}
