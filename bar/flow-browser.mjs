// FLOW in real Chromium: the verifier, the LLP host and FLOW's page presenter run inside the page.
// Used by lines 1, 2, 3 and 4.
import { createRequire } from "node:module";
import { serve } from "../tools/serve.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

// quick: only the typing-through-a-swap part, for repeated runs.
export async function runFlowBrowser({ quick = false } = {}) {
  const server = serve("bar/flow-page.html");
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    const first = await p.evaluate(() => window.flow.first);
    const input = 'input[data-bind="draft"]';
    const look = () => p.evaluate((sel) => { const el = document.querySelector(sel); return {
      heading: document.querySelector("h1")?.textContent, draft: el?.value, focused: !!el && document.activeElement === el,
      caret: el?.selectionStart, scroll: window.scrollY, text: document.getElementById("screen").textContent }; }, input);
    for (const t of ["Write spec", "Ship demo"]) { await p.fill(input, t); await p.click('button[data-act="add"]'); }
    await p.click(input);
    await p.evaluate((sel) => { window.__field = document.querySelector(sel); }, input);
    await p.type(input, "Buy mi");
    // The release lands while the person is mid-word; they keep typing straight through it.
    const shipping = p.evaluate(() => window.flow.ship("v2"));
    await p.type(input, "lk", { delay: 15 });
    const shipped = await shipping;
    await p.type(input, " today", { delay: 5 });
    const after = { ...(await look()), sameElement: await p.evaluate((sel) => window.__field === document.querySelector(sel), input) };
    if (quick) return { ok: true, errors, shipped, after };
    const forged = await p.evaluate(() => window.flow.ship("forged"));
    // The person adds their own function while still mid-sentence, updates it, then undoes the update.
    const mine = await p.evaluate(() => window.flow.mine("v1"));
    await p.click('button[data-act="cheer"]'); await p.click('button[data-act="cheer"]');
    await p.click(input);
    const withMine = await look();
    const mine2 = await p.evaluate(() => window.flow.mine("v2"));
    const withMine2 = await look();
    const undoMine = await p.evaluate(() => window.flow.undoMine());
    const afterUndoMine = await look();
    // The owner undoes v2 by releasing the earlier code again, while the person has scrolled down the page.
    await p.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 800); });
    const undo = await p.evaluate(() => window.flow.ship("back"));
    const afterUndo = await look();
    const ledger = await p.evaluate(() => window.flow.ledger());
    return { ok: true, errors, first, shipped, after, forged, mine, withMine, mine2, withMine2, undoMine, afterUndoMine, undo, afterUndo, ledger, version: await p.evaluate(() => window.flow.version()) };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { await browser.close(); server.close(); }
}
