// Runs every conformance vector (the frozen A1 capsule and any later sets) against the JS verifier.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { runVector } from "./runner.mjs";

const sets = ["capsule-a1", "vectors"].filter((d) => existsSync(new URL(`./${d}/`, import.meta.url)));
let pass = 0, fail = 0;
for (const set of sets) {
  const dir = new URL(`./${set}/`, import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "LOCK.json").sort()) {
    const v = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const got = await runVector(v);
    const want = v.steps.map((s) => s.expect);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${set}/${v.name}${ok ? "" : `  — want ${want.join(",")} got ${got.join(",")}`}`);
  }
}
console.log(`\nconformance (js): ${pass}/${pass + fail} vectors passed`);
if (fail || pass === 0) process.exitCode = 1;
