// Every refusal carries a stable code an agent or a tool can act on, plus a sentence for people.
export const CODES = Object.freeze([
  "malformed",      // the document can't be read, or breaks a structural rule
  "wrong_type",     // a valid envelope of a different document kind than was expected
  "untrusted",      // the signatures don't meet the trust policy
  "host_too_old",   // the document needs a feature or signature suite this host doesn't implement
  "weak_root",      // a keyring whose root policy has no quantum-safe group
  "stale",          // a keyring number or release that isn't newer than what the device holds
  "wrong_app",      // signed for another app
  "expired",        // past its expiry, on a device whose clock is trusted
  "not_wasm_1",     // a layer that uses WebAssembly features beyond the 1.0 feature set
]);

export class FlowError extends Error {
  constructor(code, message) {
    super(message);
    if (!CODES.includes(code)) throw new Error(`unknown FLOW error code ${code}`);
    this.code = code;
  }
}
export const refuse = (code, message) => { throw new FlowError(code, message); };
