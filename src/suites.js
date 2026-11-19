// Signature suites. A suite is one fixed signature method; every key belongs to exactly one suite and
// is identified by a kid derived from its suite and public bytes, so a kid can't be re-pointed.
//
//   p256               ECDSA over P-256 with SHA-256 (the method LLP v1 uses). Public key: the 65-byte
//                      uncompressed point. Signature: 64 bytes, r || s.
//   slh-dsa-sha2-128s  SLH-DSA, FIPS 205, pure mode with an empty context. Quantum-safe, hash-based.
//                      Public key 32 bytes, signature 7,856 bytes. Used for root keys.
import { webcrypto } from "node:crypto";
import { slh_dsa_sha2_128s } from "@noble/post-quantum/slh-dsa.js";
import { te, concat, sha256hex, b64u } from "./bytes.js";

const subtle = webcrypto.subtle;
const P256 = { name: "ECDSA", namedCurve: "P-256" };
const P256SIG = { name: "ECDSA", hash: "SHA-256" };

export const SUITES = {
  "p256": {
    quantumSafe: false,
    pubBytes: 65,
    sigBytes: 64,
    async keygen() {
      const kp = await subtle.generateKey(P256, true, ["sign", "verify"]);
      return {
        pub: new Uint8Array(await subtle.exportKey("raw", kp.publicKey)),
        secret: new Uint8Array(await subtle.exportKey("pkcs8", kp.privateKey)),
      };
    },
    async sign(msg, secret) {
      const k = await subtle.importKey("pkcs8", secret, P256, false, ["sign"]);
      return new Uint8Array(await subtle.sign(P256SIG, k, msg));
    },
    async verify(sig, msg, pub) {
      if (sig.length !== 64 || pub.length !== 65 || pub[0] !== 4) return false;
      try {
        const k = await subtle.importKey("raw", pub, P256, false, ["verify"]);
        return await subtle.verify(P256SIG, k, sig, msg);
      } catch { return false; }
    },
  },
  "slh-dsa-sha2-128s": {
    quantumSafe: true,
    pubBytes: 32,
    sigBytes: 7856,
    async keygen() {
      const k = slh_dsa_sha2_128s.keygen();
      return { pub: k.publicKey, secret: k.secretKey };
    },
    async sign(msg, secret) { return slh_dsa_sha2_128s.sign(msg, secret); },
    async verify(sig, msg, pub) {
      if (sig.length !== 7856 || pub.length !== 32) return false;
      try { return slh_dsa_sha2_128s.verify(sig, msg, pub); } catch { return false; }
    },
  },
};

export const implemented = (suite) => Object.hasOwn(SUITES, suite);

// kid = "sha256:" + hex(SHA-256(suite || 0x00 || public key bytes))
export function kidOf(suite, pub) {
  return "sha256:" + sha256hex(concat(te.encode(suite), new Uint8Array([0]), pub));
}

export async function generateKey(suite) {
  const s = SUITES[suite];
  if (!s) throw new Error(`unknown suite ${suite}`);
  const { pub, secret } = await s.keygen();
  return { suite, kid: kidOf(suite, pub), pub: b64u.enc(pub), secret: b64u.enc(secret) };
}

export const publicPart = ({ suite, pub }) => ({ suite, pub });
