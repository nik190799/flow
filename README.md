# FLOW

**F**unctions as **L**ive **O**verlays, **W**ithout restart.

[![test](https://github.com/nik190799/flow/actions/workflows/test.yml/badge.svg)](https://github.com/nik190799/flow/actions/workflows/test.yml)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24411135.svg)](https://doi.org/10.5281/zenodo.24411135)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

FLOW is an architecture for apps that change while they run. The company ships its app as signed code. The people using it, or AI agents working for them, add their own signed functions in the spots the company opened. Every change is checked on the device before any of it runs, nothing restarts, and every change can be undone.

**Paper:** [FLOW: Functions as Live Overlays, Without Restart](https://doi.org/10.5281/zenodo.24411135) (doi:10.5281/zenodo.24411135). Source, raw results and benchmark scripts are in [`paper/`](paper/).

FLOW sits on top of the [Live Layer Protocol](https://github.com/nik190799/live-layer-protocol) (LLP). LLP moves signed WebAssembly layers into a running app and swaps them without losing state. FLOW decides **who may change what**. It uses LLP as a library and doesn't fork or change it.

<p align="center">
  <img src="docs/flow-change-paths.svg" width="100%" alt="Animated diagram. An owner (the company), a backend relay that can't sign, a person named Ana, and three devices. Five change paths play in turn: A, the owner's signed release reaches every device; B, Ana's function reaches everyone only after the owner signs it; C, Ana's function follows her to her own phone and tablet; D, Ana signs a function on her phone with no backend; E, a signed bundle passes from device to device with no backend. A and D are built, B and C are designed, E is partly built.">
</p>

The diagram is an SVG that animates on its own. The timings in it come from a run of the reference app on the real host (`npm run figures`), and each path says whether it is built yet.

## The idea in one minute

Today an app changes in one way: the company rebuilds it, ships it, and everyone restarts into the same new version. FLOW changes three things.

1. **The app changes in place.** A signed release swaps the company's code while the app is open. What the person was typing, their place on the screen and their data stay.
2. **People can change their own copy.** The company's release opens named spots, called **directions**, and says what a function there may read and use. A person signs a function into one of them. The company signs nothing for it and its code doesn't restart.
3. **The device has the last word.** The host on the device checks every signature, every data label and every fence before any code runs. A server can carry changes, but it can't sign them and it can't overrule the device.

### Who is who

| Party | Holds | Can | Can't |
|---|---|---|---|
| **Owner** (the company) | the keys in the device's keyring | sign releases, open and close directions, label data | see or block a person's own function |
| **Backend** | storage and a relay | carry releases and functions, store shared and per-person data | sign or approve anything |
| **Device** | the FLOW host | verify, fence, swap, pause, undo | be overruled by the backend |
| **Person** | their own key, enrolled on the device | sign functions into open directions, grant an AI agent a time-limited key, undo | touch the company's code or anything a direction doesn't offer |

### The five ways a change travels

| Path | From, to | Status |
|---|---|---|
| **A** | Owner to every device, through the backend | Built (A1) |
| **B** | A person to everyone, only if the owner signs it | Designed |
| **C** | A person to their own devices, through the backend | Designed |
| **D** | A person to one device, no backend | Built (B1) |
| **E** | Device to device, no backend (QR code, light, local network) | Partly built: signed bundles install offline from files (A1) |

A person's change sits on top of the company's app, only in the spots the company opened, and can always be rolled back.

## Inside the device

<p align="center">
  <img src="docs/flow-inside-device.svg" width="100%" alt="Animated diagram of one device running the reference app. The release on the left opens a direction called side. Ana's checklist function passes eight checks and installs without restarting the company's code. Her AI agent's function installs under her ten-minute grant. An export function that could send personal data out is refused with would_leak before its code is fetched. Release 2 swaps the company's core while both functions keep running. Ana updates her function and undoes it, getting her old data back. Below, the same function shown on a screen, as terminal text, as speech, and as AI agent tools.">
</p>

What the device checks, in the order it checks it, before any of a function's code is fetched ([SPEC-B1 section 3](SPEC-B1.md#3-functions)):

| Check | Refusal code |
|---|---|
| Signed by an enrolled person, or by an agent under a valid grant from one | `untrusted`, `expired` |
| Meant for this app | `wrong_app` |
| The running release opens this direction | `not_open` |
| It asks only for data and capabilities the direction offers | `exceeds_direction` |
| Nothing more sensitive than the direction allows can leave the device through it | `would_leak` |
| If personal data can leave, the person agreed on the device | `needs_consent` |
| Newer than anything this device accepted for it, undone versions included | `stale` |
| The direction has room | `not_open` |

Then the layer is fetched, checked by hash, checked against WebAssembly 1.0, and health-checked on real state like any LLP layer.

## Try it

Node 22 or later. Go 1.25 for the second verifier.

```sh
git clone https://github.com/nik190799/flow && cd flow
npm install
npm test               # 145 checks, the 40 frozen conformance vectors and the diagram check, about a minute
npm run example        # the reference app; open the printed address and press the buttons
```

More:

```sh
npm run test:go        # the same conformance vectors through the Go verifier
npm run example:test   # the reference app driven in Chromium (needs Playwright)
npm run bar            # seven checks an ordinary web app can't pass, run against both (needs Playwright)
npm run figures        # re-runs the reference app on the real host and redraws the two diagrams
```

`npm test` spends most of its minute on SLH-DSA signing in pure JavaScript (about 1.2 s per signature; verifying takes a few milliseconds).

### In code

```js
import { FlowHost } from "./src/index.js";
const host = await FlowHost.create({ keyring: firstKeyringEnvelope, onRender });
await host.updateKeyring(nextKeyringEnvelope);   // { ok } or { ok: false, code, reason }
await host.apply(releaseEnvelope, fetchBlob);    // FLOW checks trust, then LLP runs and swaps the layer

host.enrolPerson({ suite, pub, name: "Ana" });           // on the device
await host.installFunction(functionEnvelope, fetchBlob); // signed by Ana, or by an agent with her grant
await host.undoFunction("fn.side.checklist");            // old code and old data back
host.inspect();                                          // what runs, and under whose name

import { present } from "./src/present/dom.js";
present(host, document.getElementById("app"));           // draws the app and keeps it current
```

### Command line

```sh
npx flow keygen slh-dsa-sha2-128s root-q1.json
npx flow seal flow/keyring keyring.json root-p1.json root-q1.json > keyring.env.json
npx flow check-wasm layers/*.wasm
npx flow install ./bundle --first keyring.env.json [--clock untrusted]
```

## The design rules and where they stand

FLOW is defined by nine rules that later revisions keep. This is where the code stands against each one today.

| # | Rule | Status |
|---|---|---|
| 1 | Data belongs to the device, not to code. Swapping code can't lose it. | Built, in memory. Keeping it across a host restart is not built yet. |
| 2 | Nothing runs unsigned, and every signature leads back to an accountable person or company. An AI agent acts only under a person's grant. | Built (A1 keyring, B1 functions and grants) |
| 3 | The device decides whether a change runs. | Built. Holds for an installed host; a host that is itself a web page is only as trustworthy as whoever serves the page. |
| 4 | Code can always go back to the last version that fits the data. | Built: undo restores code and data across a change of data format. Naming effects that can't be undone (such as a payment) beforehand is not built. |
| 5 | A function gets only what it declared, and data goes only where its label allows. | Built. The rule judges what code declares, not each value it handles. |
| 6 | A person's change is an overlay. A company release always goes first and is never blocked by a person's function; one that no longer fits is paused with its data kept. | Built |
| 7 | Everything is versioned, and new things are added without breaking old ones. | Built: unknown fields are ignored, `requires` names what a host must understand, and the A1 vectors are frozen by hash. |
| 8 | Every function declares what it costs, and the app never waits on a function between a touch and the next frame. | Not built. LLP's per-call time limit and memory cap apply; per-direction budgets don't exist yet. |
| 9 | Everything shown has a meaning the device understands, so one function can appear on a screen, be read aloud or be used by an agent. | Built, with a small set of elements (text, headings, fields, buttons, switches, groups). |

Three parts are built to be replaced without touching the rules: signature suites (P-256 and SLH-DSA today), the contract between host and function (LLP's layer interface), and the providers behind capabilities.

## Revisions

**A1** ([SPEC-A1.md](SPEC-A1.md)) is the groundwork that is cheap now and expensive once devices are in the field.

| Part | What it does |
|---|---|
| Signed envelope | One wrapper for every signed document. Signatures cover exact bytes and the document kind, so reformatting the wrapper changes nothing and a keyring signature can't pass as a release. |
| Trust policy (keyring) | Groups of keys per role, each with a threshold, and every group must be met. Root keys include a quantum-safe group (SLH-DSA) from keyring 1. A keyring changes only when signed under both the old and new policy. A committed spare root key covers a lost key. |
| Tolerance rules | Unknown fields are ignored. Anything a host must understand goes in `requires`, and a host that lacks it says `host_too_old` instead of guessing. |
| Offline install | Keyrings, release and layers install from a folder of files with no network. |
| No-clock mode | A device with no trustworthy clock decides by signatures and rising numbers only. |
| WebAssembly 1.0 check | Layers must stay within the 2017 feature set, so old engines run them. |
| Two verifiers | JavaScript (`src/`, wired to the LLP host) and Go (`go/`), checked against the same vectors. |

**B1** ([SPEC-B1.md](SPEC-B1.md)) is what makes a FLOW app more than an app that updates itself.

| Part | What it does |
|---|---|
| Directions | The company's release names the spots where people's own functions may run, and what a function there may read and use. |
| People's functions | A person enrolled on the device signs a function into a direction. The company signs nothing and sees nothing; its code is not restarted. Company updates leave the function running. |
| Data labels | The release labels data public, personal or secret and says which capabilities leave the device. A function that could carry personal data out is refused before its code runs. |
| Grants | A person lets an AI agent's key add functions for a limited time. The person is recorded as answering for them. |
| Undo | The person undoes or removes their own (or their agent's) function on the device. Undo brings back the old code and the old data, even across a change of data format. |
| Smooth swaps | The host carries typed text across a swap, and its page presenter patches the page in place, so focus, caret and text survive without the app author doing anything. |
| Elements and presenters | The meaning of each view element is fixed in the spec. The host ships four presenters that read it: web page, terminal text, speech, and tools for an AI agent. |

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
| A person's function installs in an open direction without touching the company's code; fences, labels, grants, undo across a data-format change, pausing (51 checks) | `test/functions.mjs` |
| Element meanings and the text, speech and agent presenters | `test/present.mjs` |
| The diagrams match a real run: the company's code isn't restarted, the leaking function is refused before its code is fetched, functions survive a release | `docs/figures/build.mjs --check` |
| The reference app, driven in Chromium | `npm run example:test` |
| The WebAssembly 1.0 check agrees with wabt (with every post-1.0 switch off) where wabt enforces the switch | `test/wasm1.mjs` |

## The bar

`npm run bar` runs seven checks an ordinary web app can't pass, against an ordinary web app (in Chromium) and against FLOW, and writes `bar/RESULTS.json`. It needs Playwright with Chromium, so it isn't part of `npm test`.

| # | Line | Web app | FLOW |
|---|---|---|---|
| 1 | Changed while in use, nothing lost | fail | pass |
| 2 | Each person's copy is different, and it stays the company's app | fail | pass |
| 3 | The device has the last word | fail | pass (installed host) |
| 4 | Every change has a named signer and a working undo | fail | pass |
| 5 | A function can only touch what it declared | fail | pass |
| 6 | It works with no network | fail | pass |
| 7 | One function, many surfaces | partial | pass |

Each line's limits are printed with its result. The main ones: line 3 holds for an installed host; line 5 judges what a function declares, not each value it handles; line 2 is per device.

## Known limits

- **B1 is JavaScript only.** The Go verifier and the frozen vectors cover A1. Functions, grants and labels have tests but no conformance vectors and no second implementation yet.
- **Nothing is kept across a restart.** People, functions, grants and the record live in memory.
- **A person's functions stay on the device they were installed on** (path C is designed, not built).
- **The flow rule is declared, not traced.** See SPEC-B1 section 2.3.
- **Small element set:** text, headings, fields, buttons, switches, groups.
- **The Go side is a verifier only.** It isn't wired into LLP's Go host yet. The JS side is wired into LLP's JS host through a bridge: FlowHost checks the FLOW signatures, then signs the manifest with a key that exists only in that process, so LLP's own fail-closed signature check stays on.
- **The LLP manifest inside a release stays strict** about unknown top-level fields (LLP v1 rule). The tolerance rule covers FLOW's own documents.
- **Releases are signed with P-256.** Quantum-safe release signing (ML-DSA) waits for maintained libraries on both host platforms; the keyring can add it later through a normal policy change.
- **The first keyring is parsed before it is verified,** because it carries its own keys. Pin it by hash at install.
- **The time-capsule proof is half done by construction.** The A1 vectors are frozen today; the proof completes when a later revision still passes them.
- LLP's AssemblyScript layers are built with post-1.0 features by default (bulk memory), so a FLOW host refuses them unless rebuilt with the flags in `layers/build.sh`, or the host is created with `wasm: "any"`.

## Repository layout

| Path | What it is |
|---|---|
| `SPEC-A1.md`, `SPEC-B1.md` | The specification, revision by revision |
| `src/` | The JavaScript host: envelope, suites, keyring, functions and grants, `FlowHost`, offline bundles. No Node-only code, so it runs in browsers too |
| `src/present/` | Element meanings and the four presenters: page, text, speech, agent tools |
| `go/` | The Go verifier and conformance runner |
| `conformance/` | Vector generator, runners, and the frozen `capsule-a1` set |
| `test/` | The test suites behind `npm test` |
| `examples/workorders/` | The reference app: a field-service work-order app with one open direction |
| `bar/` | The seven-line bar, run against an ordinary web app and against FLOW |
| `paper/` | The FLOW paper (LaTeX source, PDF), its benchmark scripts and raw results |
| `docs/` | The two animated diagrams and `docs/figures/`, which draws them from a real run |
| `layers/` | Small WebAssembly test layers and their sources |
| `bin/flow.mjs` | The `flow` command line |

## Citation

The paper is in [`paper/`](paper/) and on Zenodo: [doi:10.5281/zenodo.24411135](https://doi.org/10.5281/zenodo.24411135). See also [CITATION.cff](CITATION.cff).

```bibtex
@misc{kadalge2026flow,
  author    = {Kadalge, Nikhil Ajay},
  title     = {{FLOW}: Functions as Live Overlays, Without Restart. An Architecture for Applications That People and Their Agents Change While They Run},
  year      = {2026},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.24411135},
  url       = {https://doi.org/10.5281/zenodo.24411135}
}
```

FLOW builds on the Live Layer Protocol paper, [doi:10.5281/zenodo.24349382](https://doi.org/10.5281/zenodo.24349382).

## License

Apache-2.0, like LLP. See [LICENSE](LICENSE).
