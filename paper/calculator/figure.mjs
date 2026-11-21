// Captures the calculator figure: FLOW's own page presenter drawing the company core and two people's
// functions, at three moments. node paper/calculator/figure.mjs  -> paper/figures/calc-{1,2,3}.png
import { createRequire } from "node:module";
import { serve } from "../../tools/serve.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const server = serve("paper/calculator/figure.html");
await new Promise((r) => server.on("listening", r));
const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 424, height: 900 }, deviceScaleFactor: 2 });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}/`);
  await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  for (const [i, s] of [[1, "one"], [2, "two"], [3, "three"]]) {
    await p.evaluate((s) => window.step[s](), s); await p.waitForTimeout(150);
    await p.locator("body").screenshot({ path: `paper/figures/calc-${i}.png` });
  }
  console.log(errs.length ? "page errors: " + errs.join("; ") : "ok, no page errors");
} finally { await browser.close(); server.close(); }
