// FLOW in real Chromium: the verifier and the LLP host run inside the page. Used by lines 1, 3 and 4.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = new URL("..", import.meta.url).pathname;
const types = { js: "text/javascript", mjs: "text/javascript", wasm: "application/wasm", html: "text/html" };

export async function runFlowBrowser({ carryLiveText = true } = {}) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    try { const b = readFileSync(root + (path === "/" ? "bar/flow-page.html" : path.slice(1))); res.setHeader("content-type", types[path.split(".").pop()] ?? "text/html"); res.end(b); }
    catch { res.statusCode = 404; res.end(); }
  }).listen(0);
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    if (!carryLiveText) await p.addInitScript(() => { window.__noKeep = true; });
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    const first = await p.evaluate(() => window.flow.first);
    const input = "#in-main-draft";
    for (const t of ["Write spec", "Ship demo"]) { await p.fill(input, t); await p.click('button[data-act="add"]'); }
    await p.click(input);
    await p.type(input, "Buy mi");
    // The release lands while the person is mid-word; they keep typing straight through it.
    const shipping = p.evaluate(() => window.flow.ship("v2"));
    await p.type(input, "lk", { delay: 15 });
    const shipped = await shipping;
    await p.type(input, " today", { delay: 5 });
    const after = await p.evaluate((sel) => ({
      heading: document.querySelector("h1")?.textContent, draft: document.querySelector(sel)?.value, focused: document.activeElement?.id === sel.slice(1),
      caret: document.querySelector(sel)?.selectionStart, scroll: window.scrollY, text: document.getElementById("screen").textContent,
    }), input);
    const forged = await p.evaluate(() => window.flow.ship("forged"));
    // The owner undoes v2 by releasing the earlier code again, while the person has scrolled down the page.
    await p.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 800); });
    const undo = await p.evaluate(() => window.flow.ship("back"));
    const afterUndo = await p.evaluate((sel) => ({ heading: document.querySelector("h1")?.textContent, draft: document.querySelector(sel)?.value, scroll: window.scrollY, text: document.getElementById("screen").textContent }), input);
    const ledger = await p.evaluate(() => window.flow.ledger());
    return { ok: true, errors, first, shipped, after, forged, undo, afterUndo, ledger, version: await p.evaluate(() => window.flow.version()) };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { await browser.close(); server.close(); }
}
