// Drives the reference app in real Chromium, pressing the same buttons a visitor would.
//   node examples/workorders/test.mjs [screenshot.png]
import { createRequire } from "node:module";
import { serve } from "../../tools/serve.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const server = serve("examples/workorders/index.html");
await new Promise((r) => server.on("listening", r));
const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}/`);
  await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  const app = () => p.textContent("#app"), say = () => p.textContent("#say");
  const press = async (id) => { const before = await p.evaluate(() => window.__host.ledger.length + window.__host.refusals.length); await p.click(id); await p.waitForFunction((n) => window.__host.ledger.length + window.__host.refusals.length > n, before); await p.waitForTimeout(50); };
  check("E1 the company's app shows the jobs", /Work orders/.test(await app()) && /Boiler service/.test(await app()));

  await p.click('#app [data-act="job:0"]');
  await p.waitForFunction(() => /1 of 3 finished/.test(document.getElementById("app").textContent));
  const draft = '#app input[data-bind="draft"]';
  await p.click(draft); await p.type(draft, "Inspect roof fan");
  await press("#b-mine");
  check("E2 Ana's own function appears beside the company's app, and what she was typing is still there", /My van checklist/.test(await app()) && /2 open jobs/.test(await app()) && (await p.inputValue(draft)) === "Inspect roof fan", `field reads "${await p.inputValue(draft)}", app: ${(await app()).slice(0, 160)}`);

  const mine = '#app input[data-bind="fn/side/checklist/draft"]';
  for (const item of ["Ladder", "Filter cartridges"]) { await p.fill(mine, item); await p.press(mine, "Enter"); await p.waitForFunction((t) => document.getElementById("app").textContent.includes(t), item); }
  await p.click('#app [data-act="item:0"]');
  await p.click(mine); await p.type(mine, "Torque wr");
  const shipping = p.evaluate(() => document.getElementById("b-company").click());
  await p.type(mine, "ench", { delay: 10 });
  await shipping; await p.waitForFunction(() => /open jobs first|finished today/.test(document.getElementById("app").textContent));
  check("E3 the company ships release 2 while Ana types in HER function: the app changes, her text and her list don't", /finished today/.test(await app()) && (await p.inputValue(mine)) === "Torque wrench" && /Ladder/.test(await app()) && (await p.inputValue(draft)) === "Inspect roof fan", await say());

  await p.fill(mine, "");
  await press("#b-mine2");
  check("E4 Ana updates her function; it converts her list to its new form", /1 of 2 packed/.test(await app()) && /Untick all/.test(await app()));
  await p.click('#app [data-act="reset"]');
  await p.waitForFunction(() => /0 of 2 packed/.test(document.getElementById("app").textContent));
  await p.click('#running button:has-text("Undo")');
  await p.waitForFunction(() => /Before leaving for/.test(document.getElementById("app").textContent));
  const ticked = await p.getAttribute('#app [data-act="item:0"]', "aria-checked");
  check("E5 Ana presses Undo: the old function is back with the old list, tick included, although version 2 had rewritten and then unticked it", ticked === "true" && /Ladder/.test(await app()) && /Filter cartridges/.test(await app()) && !/Untick all/.test(await app()));

  await press("#b-agent");
  const rows = await p.textContent("#running");
  check("E6 an AI agent adds a function under Ana's ten-minute grant, and the device shows Ana answers for it", /Next up/.test(await app()) && /Boiler service/.test(await app()) && /through her grant to the AI agent/.test(rows));

  await press("#b-leak");
  check("E7 a function that would upload customer addresses is refused before it runs", /would_leak/.test(await say()) && !/Export my jobs/.test(await app()), await say());
  await press("#b-forged");
  check("E8 a release signed by a stranger is refused; the app carries on", /untrusted/.test(await say()) && /Work orders/.test(await app()));
  check("E9 the device's record names who signed and who answers for each change", /Company release 2/.test(await p.textContent("#ledger")) && /AI agent/.test(await p.textContent("#ledger")) && /Undo of checklist/.test(await p.textContent("#ledger")));
  check("E10 no script errors on the page", errors.length === 0, errors.join("; "));
  if (process.argv[2]) await p.screenshot({ path: process.argv[2], fullPage: true });
} finally { await browser.close(); server.close(); }
const failed = results.filter((r) => !r).length;
console.log(`\nexample: ${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
