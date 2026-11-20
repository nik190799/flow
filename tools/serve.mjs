// A small static file server over the repository, used by the reference app and the browser tests.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const types = { js: "text/javascript", mjs: "text/javascript", wasm: "application/wasm", html: "text/html" };

export function serve(index, port = 0) {
  return createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.includes("..")) { res.statusCode = 400; return res.end(); }
    try { const b = readFileSync(root + (path === "/" ? index : path.slice(1))); res.setHeader("content-type", types[path.split(".").pop()] ?? "text/html"); res.end(b); }
    catch { res.statusCode = 404; res.end(); }
  }).listen(port, "127.0.0.1");
}
