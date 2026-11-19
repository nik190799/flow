// Runs one conformance vector against the JavaScript verifier and returns each step's outcome.
import { trustFirstKeyring, nextKeyring, verifyRelease } from "../src/index.js";

export async function runVector(v) {
  let kr = null;
  const got = [];
  for (const s of v.steps) {
    let code = "ok";
    try {
      if (s.op === "trust") kr = await trustFirstKeyring(s.doc, { pin: s.pin });
      else if (s.op === "keyring") kr = await nextKeyring(kr, s.doc);
      else if (s.op === "release") await verifyRelease(kr, s.doc, { clock: s.clock ?? "trusted", now: s.now ?? v.now });
      else throw new Error(`unknown op ${s.op}`);
    } catch (e) {
      if (!e.code) throw e;
      code = e.code;
    }
    got.push(code);
  }
  return got;
}
