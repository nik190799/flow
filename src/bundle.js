// Install from files, with no network. A bundle is a plain directory that can travel on a USB stick,
// over a one-way link, or be copied onto a device that is only sometimes awake:
//
//   bundle/
//     keyrings/*.json     zero or more keyring envelopes, applied in file-name order
//     release.json        one release envelope
//     blobs/<sha256>      layer bytes, named by their SHA-256
//
// Nothing in the bundle is trusted for being there: keyrings and the release go through exactly the
// same checks as when they arrive over a network, and blobs are checked against their hash by LLP.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256hex } from "./bytes.js";

const HASH = /^[0-9a-f]{64}$/;

export async function installBundle(host, dir) {
  const steps = [];
  const kdir = join(dir, "keyrings");
  if (existsSync(kdir)) {
    for (const f of readdirSync(kdir).filter((f) => f.endsWith(".json")).sort()) {
      const r = await host.updateKeyring(JSON.parse(readFileSync(join(kdir, f), "utf8")));
      steps.push({ file: `keyrings/${f}`, ...r });
      if (!r.ok) return { ok: false, steps };
    }
  }
  const release = JSON.parse(readFileSync(join(dir, "release.json"), "utf8"));
  const r = await host.apply(release, async (hash) => {
    if (!HASH.test(hash)) return null;
    const p = join(dir, "blobs", hash);
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  });
  steps.push({ file: "release.json", ...r });
  return { ok: r.ok, steps };
}

export function writeBundle(dir, { keyrings = [], release, blobs = [] }) {
  mkdirSync(join(dir, "keyrings"), { recursive: true });
  mkdirSync(join(dir, "blobs"), { recursive: true });
  keyrings.forEach((k, i) => writeFileSync(join(dir, "keyrings", `${String(i + 1).padStart(4, "0")}.json`), JSON.stringify(k)));
  writeFileSync(join(dir, "release.json"), JSON.stringify(release));
  for (const b of blobs) writeFileSync(join(dir, "blobs", sha256hex(b)), b);
}
