// Micro-benchmark for the paper: signature cost per suite and envelope verification.
// Run from the repo root: node paper/bench-crypto.mjs
import { SUITES, generateKey } from "../src/suites.js";
import { seal, unwrap, pae } from "../src/envelope.js";
import { b64u } from "../src/bytes.js";
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const time = async (n, f) => { const t = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); await f(); t.push(performance.now() - t0); } return t; };
const msg = pae("flow/release", new TextEncoder().encode(JSON.stringify({ app: "bench", x: "y".repeat(1000) })));
for (const [suite, n] of [["p256", 200], ["slh-dsa-sha2-128s", 7]]) {
  const k = await generateKey(suite);
  const sec = b64u.dec(k.secret), pub = b64u.dec(k.pub);
  const sigs = await time(n, () => SUITES[suite].sign(msg, sec));
  const sig = await SUITES[suite].sign(msg, sec);
  const ver = await time(Math.max(n, 30), () => SUITES[suite].verify(sig, msg, pub));
  console.log(`${suite}: sign p50 ${med(sigs).toFixed(2)} ms (n=${n}), verify p50 ${med(ver).toFixed(2)} ms (n=${Math.max(n, 30)}), sig ${sig.length} B, pub ${pub.length} B`);
}
const p = await generateKey("p256"), q = await generateKey("slh-dsa-sha2-128s");
const env = await seal("flow/release", { app: "bench" }, [p, q]);
console.log(`envelope with one p256 + one slh-dsa signature: ${JSON.stringify(env).length} B as JSON`);
console.log(`node ${process.version}, ${(await import("node:os")).cpus().length} cpus, ${(await import("node:os")).cpus()[0].model}`);
