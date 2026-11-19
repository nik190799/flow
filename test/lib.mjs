// Tiny test harness: each check prints PASS or FAIL, and the process fails if any check failed.
import { generateKey } from "../src/index.js";

const results = [];
export function check(name, cond, detail = "") {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
export function done(title) {
  const failed = results.filter((r) => !r).length;
  console.log(`\n${title}: ${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}
// Runs fn, which may throw a FlowError; returns its code, or "ok".
export async function outcome(fn) {
  try { await fn(); return "ok"; } catch (e) { if (e.code) return e.code; throw e; }
}
export const keys = async (suite, n) => Promise.all(Array.from({ length: n }, () => generateKey(suite)));
