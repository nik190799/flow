// Small byte helpers shared by every FLOW module.
import { createHash } from "node:crypto";

export const te = new TextEncoder();
export const td = new TextDecoder("utf-8", { fatal: true });

export const b64u = {
  enc: (bytes) => Buffer.from(bytes).toString("base64url"),
  // Strict: only the unpadded base64url alphabet, and it must round-trip, so one value has one spelling.
  dec(s) {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new TypeError("not base64url");
    const b = new Uint8Array(Buffer.from(s, "base64url"));
    if (Buffer.from(b).toString("base64url") !== s) throw new TypeError("non-canonical base64url");
    return b;
  },
};

export const sha256hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
