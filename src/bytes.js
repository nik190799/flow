// Small byte helpers shared by every FLOW module. No Node-only APIs: the verifier runs in browsers too.
import { sha256 } from "@noble/hashes/sha2.js";

export const te = new TextEncoder();
export const td = new TextDecoder("utf-8", { fatal: true });

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VAL = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) VAL[ALPHA.charCodeAt(i)] = i;

export const b64u = {
  enc(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      s += ALPHA[a >> 2] + ALPHA[((a & 3) << 4) | ((b ?? 0) >> 4)];
      if (i + 1 < bytes.length) s += ALPHA[((b & 15) << 2) | ((c ?? 0) >> 6)];
      if (i + 2 < bytes.length) s += ALPHA[c & 63];
    }
    return s;
  },
  // Strict: only the unpadded base64url alphabet, and it must round-trip, so one value has one spelling.
  dec(s) {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new TypeError("not base64url");
    const out = new Uint8Array(Math.floor((s.length * 3) / 4));
    let o = 0;
    for (let i = 0; i < s.length; i += 4) {
      const a = VAL[s.charCodeAt(i)], b = VAL[s.charCodeAt(i + 1)], c = i + 2 < s.length ? VAL[s.charCodeAt(i + 2)] : 0, d = i + 3 < s.length ? VAL[s.charCodeAt(i + 3)] : 0;
      out[o++] = (a << 2) | (b >> 4);
      if (i + 2 < s.length) out[o++] = ((b & 15) << 4) | (c >> 2);
      if (i + 3 < s.length) out[o++] = ((c & 3) << 6) | d;
    }
    if (b64u.enc(out) !== s) throw new TypeError("non-canonical base64url");
    return out;
  },
};

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
export const sha256hex = (bytes) => { let s = ""; for (const b of sha256(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))) s += HEX[b]; return s; };

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
