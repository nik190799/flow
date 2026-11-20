// The bar: seven things an ordinary app or web app can't do. Runs every line against an ordinary web
// app and against FLOW as it stands, prints both, and writes bar/RESULTS.json.
//   node bar/run.mjs
import { writeFileSync } from "node:fs";
import { runWeb } from "./web.mjs";
import { runFlow } from "./flow.mjs";

const LINES = ["Changed while in use, nothing lost", "Each person's copy is different, and it stays the company's app", "The device has the last word",
  "Every change has a named, accountable signer and a working undo", "A function can only touch what it declared", "It works with no network", "One function, many surfaces"];
const web = await runWeb(), flow = await runFlow();
for (let i = 1; i <= 7; i++) {
  console.log(`\n${i}. ${LINES[i - 1]}`);
  for (const r of [web.find((x) => x.line === i), flow.find((x) => x.line === i)]) {
    console.log(`   ${r.subject.padEnd(11)} ${r.verdict.toUpperCase()}`);
    for (const c of r.checks) console.log(`      ${c.ok ? "yes" : "no "}  ${c.name}`);
    console.log(`      ${r.detail}`);
  }
}
const tally = (rs) => rs.reduce((t, r) => ({ ...t, [r.verdict]: (t[r.verdict] ?? 0) + 1 }), {});
console.log("\nweb app:", tally(web), "\nFLOW today:", tally(flow));
writeFileSync(new URL("./RESULTS.json", import.meta.url), JSON.stringify({ lines: LINES, web, flow }, null, 1) + "\n");
