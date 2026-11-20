# FLOW

**F**unctions as **L**ive **O**verlays, **W**ithout restart: an architecture on top of the [Live Layer Protocol](https://github.com/nik190799/live-layer-protocol) (LLP).

LLP moves signed WebAssembly layers into a running app and swaps them without losing state. FLOW decides who may change what: an owner's core app, keyrings that say which keys may sign which documents, and later, people's own functions placed in spots the owner opened up. FLOW uses LLP as a library and doesn't fork or change it.

## Status: revision A1

A1 is the groundwork that is cheap now and expensive once devices are in the field. Spec: [SPEC-A1.md](SPEC-A1.md).

| Part | What it does |
|---|---|
| Signed envelope | One wrapper for every signed document. Signatures cover exact bytes and the document kind, so reformatting the wrapper changes nothing and a keyring signature can't pass as a release. |
| Trust policy (keyring) | Groups of keys per role, each with a threshold, and every group must be met. Root keys include a quantum-safe group (SLH-DSA) from keyring 1. A keyring changes only when signed under both the old and new policy. A committed spare root key covers a lost key. |
| Tolerance rules | Unknown fields are ignored. Anything a host must understand goes in `requires`, and a host that lacks it says `host_too_old` instead of guessing. |
| Offline install | Keyrings, release and layers install from a folder of files with no network. |
| No-clock mode | A device with no trustworthy clock decides by signatures and rising numbers only. |
| WebAssembly 1.0 check | Layers must stay within the 2017 feature set, so old engines run them. |
| Two verifiers | JavaScript (`src/`, wired to the LLP host) and Go (`go/`), checked against the same vectors. |

## Try it

Node 22 or later. Go 1.25 for the second verifier.

```sh
npm install
npm test            # unit, WebAssembly 1.0, proofs, LLP host, offline install, conformance (JS)
npm run test:go     # the same conformance vectors through the Go verifier
```

`npm test` takes about a minute, mostly SLH-DSA signing in pure JavaScript (about 1.2 s per signature; verification is a few milliseconds).

Command line:

```sh
npx flow keygen slh-dsa-sha2-128s root-q1.json
npx flow seal flow/keyring keyring.json root-p1.json root-q1.json > keyring.env.json
npx flow check-wasm layers/*.wasm
npx flow install ./bundle --first keyring.env.json [--clock untrusted]
```

In code:

```js
import { FlowHost } from "./src/index.js";
const host = await FlowHost.create({ keyring: firstKeyringEnvelope, onRender });
await host.updateKeyring(nextKeyringEnvelope);   // { ok } or { ok: false, code, reason }
await host.apply(releaseEnvelope, fetchBlob);    // FLOW checks trust, then LLP runs and swaps the layer
```

## What the tests prove

| Proof | Where |
|---|---|
| A release or keyring with one required signature stripped is refused, in both verifiers | `test/proofs.mjs` P1, vectors 04, 14, 15 |
| A keyring change the old policy didn't sign is refused; a deliberate suite replacement signed under both is accepted | P1.5 to P1.11, vectors 23 to 27 |
| A suite the host lacks is reported as `host_too_old` | P1.12, vector 28 |
| A device at keyring 1 refuses keyring 2 signed with classical keys only | P2.1, vector 29 |
| Lose a root key and still rotate; reveal the spare when a group needs every key | P2.3 to P2.8, vectors 31, 33 to 37 |
| Documents with invented fields (including an invented sensitivity label) still verify | P3.1, P3.2, vectors 21, 38, 40 |
| The A1 vectors are frozen and locked by hash | P3.5, `conformance/capsule-a1/LOCK.json` |
| FLOW releases run, swap with state kept, and roll forward on the unchanged LLP host | `test/host.mjs` |
| Install from files inside a network namespace with no network | `test/offline.mjs` |
| The WebAssembly 1.0 check agrees with wabt (with every post-1.0 switch off) where wabt enforces the switch | `test/wasm1.mjs` |

## The bar

`npm run bar` runs seven checks an ordinary web app can't pass, against an ordinary web app (in Chromium) and against FLOW as it stands, and writes `bar/RESULTS.json`. It needs Playwright with Chromium installed, so it isn't part of `npm test`.

| # | Line | Web app | FLOW today |
|---|---|---|---|
| 1 | Changed while in use, nothing lost | fail | pass |
| 2 | Each person's copy is different, and it stays the company's app | fail | not built |
| 3 | The device has the last word | fail | pass (installed host) |
| 4 | Every change has a named signer and a working undo | fail | partial |
| 5 | A function can only touch what it declared | fail | partial |
| 6 | It works with no network | fail | pass |
| 7 | One function, many surfaces | partial | partial |

The FLOW verifier has no Node-only code, so it runs in a browser page as well as in Node (`bar/flow-page.html`).

## Known limits of A1

- **The Go side is a verifier only.** It isn't wired into LLP's Go host yet. The JS side is wired into LLP's JS host through a bridge: FlowHost checks the FLOW signatures, then signs the manifest with a key that exists only in that process so LLP's own fail-closed signature check stays on. The bridge goes away if A1 moves into LLP itself.
- **The time-capsule proof is half done by construction.** The vectors are frozen today; the proof completes when a later revision still passes them.
- **The LLP manifest inside a release stays strict** about unknown top-level fields (LLP v1 rule). The tolerance rule covers FLOW's own documents.
- **Releases are signed with P-256.** Quantum-safe release signing (ML-DSA) waits for maintained libraries on both host platforms; the keyring can add it later through a normal policy change.
- **The first keyring is parsed before it is verified,** because it carries its own keys. Pin it by hash at install.
- Freshness notes, fleet hello authentication and the later document kinds (grants, overlays) are not built yet.
- LLP's AssemblyScript layers are built with post-1.0 features by default (bulk memory), so a FLOW host refuses them unless rebuilt with the flags in `layers/build.sh`, or the host is created with `wasm: "any"`.

## Licence

Apache-2.0, like LLP.
