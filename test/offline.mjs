// Install from files with no network: the bundle is written here, then `flow install` runs in a child
// process inside a Linux network namespace with no interfaces, so any network use would fail.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { check, done, keys } from "./lib.mjs";
import { writeBundle } from "../src/index.js";
import { keyringDoc, sealKeyring, sealRelease } from "../src/author.js";
import { sha256hex } from "../src/bytes.js";

const app = "demo.tasks";
const tasks = new Uint8Array(readFileSync(new URL("../layers/tasks.wasm", import.meta.url)));
const [r1] = await keys("p256", 1);
const [q1, spare] = await keys("slh-dsa-sha2-128s", 2);
const [rel, rel2] = await keys("p256", 2);
const roots = { root: [{ keys: [r1] }, { keys: [q1] }] };
const k1 = await sealKeyring(keyringDoc({ keyring: 1, app, spare, roles: { ...roots, release: [{ keys: [rel] }] } }), [r1, q1]);
const k2 = await sealKeyring(keyringDoc({ keyring: 2, app, spare, roles: { ...roots, release: [{ keys: [rel2] }] } }), [r1, q1]);
const release = await sealRelease({ app, manifest: { app, version: 1, layers: { main: sha256hex(tasks) }, order: ["main"] } }, [rel2]);

const dir = mkdtempSync(join(tmpdir(), "flow-bundle-"));
const first = join(dir, "first-keyring.json");
writeFileSync(first, JSON.stringify(k1));
writeBundle(join(dir, "bundle"), { keyrings: [k2], release, blobs: [tasks] });

const cli = new URL("../bin/flow.mjs", import.meta.url).pathname;
const probe = spawnSync("unshare", ["-rn", "node", "-e", "require('node:net').connect(443,'1.1.1.1').on('error',e=>{console.log(e.code);process.exit(0)}).on('connect',()=>{console.log('CONNECTED');process.exit(0)})"], { encoding: "utf8" });
const isolated = probe.status === 0 && !probe.stdout.includes("CONNECTED");
check("O1 the child process has no network (a connection attempt fails)", isolated, (probe.stdout || probe.stderr).trim());

const run = (args) => spawnSync(isolated ? "unshare" : "node", isolated ? ["-rn", "node", cli, ...args] : [cli, ...args], { encoding: "utf8" });
let p = run(["install", join(dir, "bundle"), "--first", first]);
let out = p.stdout ? JSON.parse(p.stdout) : {};
check("O2 `flow install` applies a keyring change and a release from files alone, then renders", p.status === 0 && out.ok && out.keyring === 2 && out.screen.includes("Tasks"), out.screen ?? p.stderr);

// Tamper with the layer file in the bundle: the hash check must catch it offline too.
writeFileSync(join(dir, "bundle", "blobs", sha256hex(tasks)), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
p = run(["install", join(dir, "bundle"), "--first", first]);
out = p.stdout ? JSON.parse(p.stdout) : {};
check("O3 a swapped layer file in the bundle is refused", p.status !== 0 && !out.ok && out.steps.at(-1).code === "blob", out.steps?.at(-1)?.reason);

// A bundle whose release is signed by a key the device doesn't trust yet (keyring change missing).
rmSync(join(dir, "bundle", "keyrings"), { recursive: true });
writeBundle(join(dir, "bundle"), { release, blobs: [tasks] });
rmSync(join(dir, "bundle", "keyrings"), { recursive: true });
p = run(["install", join(dir, "bundle"), "--first", first]);
out = p.stdout ? JSON.parse(p.stdout) : {};
check("O4 without the keyring change in the bundle, the release is refused (untrusted)", p.status !== 0 && out.steps.at(-1).code === "untrusted");

rmSync(dir, { recursive: true });
done("offline");
