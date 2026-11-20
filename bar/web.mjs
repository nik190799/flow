// The seven lines, run against the ordinary web app in real Chromium.
import { createRequire } from "node:module";
import { startWebApp } from "./webapp/server.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

// A person's own customisation, done the only way the web allows: a script injected into the page
// (a browser extension or user script). It stars every task. It can also read everything the page can.
const userScript = `
window.addEventListener("load", () => {
  for (const li of document.querySelectorAll("li.task")) li.textContent = "★ " + li.textContent;
  window.__stars = document.querySelectorAll("li.task").length;
  window.__canRead = localStorage.getItem("tasks");
  fetch("/sink", { method: "POST", body: "from-user-script:" + localStorage.getItem("tasks") });
});`;

export async function runWeb() {
  const web = startWebApp();
  const browser = await chromium.launch();
  const out = [];
  const line = (n, verdict, detail, checks) => out.push({ line: n, subject: "web app", verdict, detail, checks });
  try {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(web.url);
    for (const t of ["Write spec", "Ship demo"]) { await p.fill("#draft", t); await p.click("#add"); }

    // 1. Changed while in use, nothing lost
    await p.fill("#draft", ""); await p.type("#draft", "Buy mi");
    await p.evaluate(() => window.scrollTo(0, 800));
    web.state.deployed = 2;
    await p.waitForTimeout(1500);
    const liveWithoutReload = (await p.textContent("h1")) === "Tasks v2";
    await p.reload();
    const afterReload = { v2: (await p.textContent("h1")) === "Tasks v2", draft: await p.inputValue("#draft"), scroll: await p.evaluate(() => window.scrollY), tasks: await p.locator("li").count() };
    line(1, "fail", `New version did not appear in the open page (${liveWithoutReload ? "it did" : "still v1 after 1.5 s"}). After the reload that brings it: half-typed text ${afterReload.draft === "" ? "lost" : "kept"}, saved tasks ${afterReload.tasks === 2 ? "kept" : "lost"}.`,
      [{ name: "change appears without a reload", ok: liveWithoutReload }, { name: "half-typed text survives getting the change", ok: afterReload.draft === "Buy mi" }, { name: "saved tasks survive", ok: afterReload.tasks === 2 }]);

    // 2. Each person's copy is different, and the company's releases don't break it
    web.state.deployed = 1;
    const ctx2 = await browser.newContext(); await ctx2.addInitScript(userScript);
    const p2 = await ctx2.newPage();
    await p2.goto(web.url);
    await p2.evaluate(() => { localStorage.setItem("tasks", JSON.stringify([{ text: "Write spec" }, { text: "Ship demo" }])); });
    await p2.reload(); await p2.waitForFunction(() => window.__stars !== undefined);
    const starsV1 = await p2.evaluate(() => window.__stars);
    web.state.deployed = 2;
    await p2.reload(); await p2.waitForFunction(() => window.__stars !== undefined);
    const starsV2 = await p2.evaluate(() => window.__stars);
    await p2.waitForTimeout(300);
    const exfil = web.state.sink.some((s) => s.startsWith("from-user-script:") && s.includes("Write spec"));
    line(2, "fail", `A user script starred ${starsV1} tasks on v1. After the company shipped v2 (it renamed one CSS class), it starred ${starsV2}: the person's change broke silently. The company has no way to say where such changes may go.`,
      [{ name: "a person can change their own copy", ok: starsV1 === 2 }, { name: "the change survives a company release", ok: starsV2 === 2 }, { name: "the company declares where changes may go", ok: false }]);

    // 3. The device has the last word
    web.state.deployed = "evil"; web.state.sink.length = 0;
    await p.reload(); await p.waitForFunction(() => window.__appVersion === "evil");
    await p.waitForTimeout(200);
    const ranEvil = (await p.title()) === "pwned", leaked = web.state.sink.some((s) => s.includes("Write spec"));
    line(3, "fail", `The server swapped the script for a hostile one. The browser ran it on the next load${leaked ? " and it sent the person's tasks to the server" : ""}. Nothing on the device checked it.`,
      [{ name: "code the server swapped in is refused", ok: !ranEvil }]);

    // 4. Every change has a named signer and a working undo
    web.state.deployed = 2; await p.reload();
    web.state.deployed = 1; // the company "rolls back"
    await p.waitForTimeout(1500);
    const stillV2 = (await p.textContent("h1")) === "Tasks v2";
    const dataStillMigrated = await p.evaluate(() => JSON.parse(localStorage.getItem("tasks")).every((t) => t.pri === 1));
    line(4, "fail", `Nothing in the page says who is accountable for the running code. After the company rolled back, the open page kept running v2 (${stillV2 ? "confirmed" : "it changed"}), and the data v2 rewrote stayed rewritten (${dataStillMigrated ? "confirmed" : "no"}).`,
      [{ name: "the running code names its signer", ok: false }, { name: "a rollback reaches the open app", ok: !stillV2 }]);

    // 5. A function can only touch what it declared
    const canRead = await p2.evaluate(() => window.__canRead);
    line(5, "fail", `The user script declared nothing, read all of the app's stored data, and sent it off the device. The server received it: ${exfil ? "yes" : "no"}.`,
      [{ name: "added code can't read data it didn't declare", ok: !(canRead && canRead.includes("Write spec")) }, { name: "added code can't send personal data off the device", ok: !exfil }]);

    // 6. Works with no network
    web.state.deployed = 2;
    await ctx.setOffline(true);
    const offlineLoad = await p.reload().then(() => true, () => false);
    await ctx.setOffline(false);
    line(6, "fail", `With the network off the app could not even load, and there is no way to hand it a new version from a file. (A service worker can cache the current version; it can't accept a new one offline.)`,
      [{ name: "a change can arrive without a network", ok: offlineLoad }]);

    // 7. One function, many surfaces
    await p.reload();
    const role = await p.getByRole("button", { name: "Add" }).count();
    line(7, "partial", `The browser gives a screen and, through its accessibility tree, a screen reader (button "Add" found by role: ${role === 1 ? "yes" : "no"}). There is no declared list of actions an AI agent can call; an agent has to guess from the page.`,
      [{ name: "screen", ok: true }, { name: "read aloud", ok: role === 1 }, { name: "usable by an agent through declared actions", ok: false }]);
  } finally { await browser.close(); web.close(); }
  return out;
}
