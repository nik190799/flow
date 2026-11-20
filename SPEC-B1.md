# FLOW revision B1: directions, data labels, people's functions, grants, undo, elements

B1 builds on [A1](SPEC-A1.md) and changes none of it: the envelope, the suites, the keyring rules and the tolerance rule apply to every document here. The frozen A1 vectors still pass unchanged.

The words MUST, MUST NOT and MAY are used as in RFC 2119.

## 1. Who is who

- **The company** signs releases under the keyring's release policy (A1). A release is the app.
- **A person** is someone enrolled on a device. Enrolment puts the person's public key and a name in the device's list of people. It is a local act on the device; how the device knows it is really that person (a passkey, a PIN) is up to the software around the host.
- **An agent** is a key that a person has given a grant to (section 5). It has no standing of its own.
- **The device** runs the host and makes every decision in this document. Nothing here is decided by a server.

## 2. What a release may add

A release payload (A1 section 4) MAY carry four more fields. A release without them behaves exactly as in A1.

```json
{
  "app": "example.workorders",
  "manifest": { "...": "the LLP manifest, with keys and caps for every slot" },
  "data":         { "jobs.": "personal", "catalog.": "public", "vault.": "secret" },
  "capabilities": { "upload": { "egress": true }, "haptic": { "egress": false }, "contacts": { "egress": false, "returns": "personal" } },
  "core":         ["main"],
  "directions":   { "side": { "read": ["jobs."], "caps": ["haptic"], "egress": "public", "max": 4, "after": "main" } }
}
```

### 2.1 Data labels

`data` maps a key prefix to `public`, `personal` or `secret`.

- The label of a read prefix is the most sensitive label among the declared prefixes it overlaps. If no declared prefix covers it entirely, it is at least `personal`. So data nobody labelled is personal.
- Keys under `fn/` belong to people's functions, always count as personal, and MUST NOT appear in `data`.

### 2.2 Capabilities

`capabilities` describes the capabilities the app uses. `egress: true` means what is passed to the capability can leave the device. `returns` is the label of what the capability hands back (`none` by default).

A capability the release does not describe is treated as `egress: true` and `returns: personal`.

### 2.3 The flow rule

For any code, its **sensitivity** is the most sensitive label among the prefixes it may read (for a company slot, also the ones it owns) and the `returns` of the capabilities it holds. Its **ways out** are the capabilities it holds that have `egress`.

Once a release carries `data`, every slot of that release that is not named in `core` MUST have no way out if its sensitivity is `personal` or `secret`; otherwise the host refuses the release with `would_leak`. Slots named in `core` are the company's own app, which the company answers for, and are not checked. A release that carries `data` MUST declare `keys` and `caps` in its manifest.

This rule judges what code declares. It does not follow individual values through the code. Code that is allowed both personal data and a way out is trusted with it; sections 2.4 and 4.2 limit who can be given that.

### 2.4 Directions

A direction is a named spot where people's functions may run. The name is 1 to 32 characters of `a-z`, `0-9` and `-`.

| Field | Meaning | Default |
|---|---|---|
| `read` | Key prefixes a function there may ask to read | none |
| `caps` | Capabilities a function there may ask for | none |
| `egress` | The most sensitive data that may leave through a function there: `none`, `public` or `personal` | `none` |
| `max` | How many functions the direction holds, 1 to 64 | 8 |
| `after` | The company slot after which the direction's functions are shown | end |

A release that opens a direction MUST declare `keys` and `caps` for its own slots. A direction MUST NOT offer a prefix labelled `secret` or a capability that returns `secret`. Slot names starting `fn.` and owned prefixes overlapping `fn/` are kept for functions; a release that claims one is `malformed`.

## 3. Functions

Envelope type `flow/function`. Payload:

```json
{ "app": "example.workorders", "direction": "side", "id": "checklist", "seq": 2,
  "layer": "<sha256 of the WebAssembly module>", "reads": ["jobs."], "caps": [], "intent": "My own packing list" }
```

It is signed by one enrolled person, or by an agent, in which case the wrapper carries the grant envelope in a field named `grant` beside `sigs` (the grant is itself signed, so it needs no cover from the function's signature).

The host MUST refuse a function, before fetching or running any of its code, unless all of these hold:

1. The signature is valid under an enrolled person's key, or under the agent key of a valid grant that covers the direction and every requested capability (`untrusted`, or `expired` for a grant past its limit).
2. `app` is the device's app (`wrong_app`).
3. A release is running and it opens `direction` (`not_open`).
4. Every prefix in `reads` starts with a prefix the direction offers, and every name in `caps` is one the direction offers (`exceeds_direction`).
5. If the function has a way out, its sensitivity is no higher than the direction's `egress` (`would_leak`).
6. If it has a way out and its sensitivity is `personal`, the person has agreed on the device to this function sending personal data out (`needs_consent`).
7. `seq` is higher than every `seq` this device has accepted for the same direction and id, including versions later undone or removed (`stale`), and the direction and id were not first used by a different person (`untrusted`).
8. The direction holds fewer than `max` functions, or this is an update (`not_open`).

Then the layer is fetched, checked by hash and against WebAssembly 1.0 (A1 section 6), and health-checked on real state like any layer.

### 3.1 What a running function can touch

A function runs in a slot named `fn.<direction>.<id>`.

- It owns the keys under `fn/<direction>/<id>/` and can write nothing else.
- It can read its own keys and the prefixes in its `reads`. Nothing else is given to it.
- It can use the capabilities in its `caps`. Any other call is refused at run time.
- A text field it shows can only be bound to a key it owns; the host refuses writes through a field bound to any other key, and a presenter MUST NOT show it the value of a key it cannot read.
- What a person types into a function's own field is in that function's hands.

### 3.2 Releases and functions don't break each other

- Installing, updating, undoing or removing a function MUST NOT restart or change the company's slots.
- When a release is accepted, each installed function is checked again against rules 3 to 6. One that no longer fits is **paused**: its code stops, its data stays, the release goes ahead. It runs again when a later release fits it. A function MUST NOT be able to stop a release from being accepted.
- A function whose code fails while running is paused; whatever the failed call wrote is dropped; the rest of the app carries on.

## 4. The person's controls

All of these are local acts on the device. None needs a signature, a network or the company.

### 4.1 Undo and remove

- **Undo** puts back the version of the function that ran before the current one, and puts the function's own data back to what it was just before that update, including the stored schema number. So an undo works across a change of data format. Undoing the first version removes the function.
- **Remove** stops the function and deletes everything under its keys.
- An undone or removed version cannot be brought back by replaying its document (rule 7).

### 4.2 Consent

Rule 6 is satisfied only by an answer the host's surroundings collected from the person on the device for that function. If a release later makes an installed function need consent it never got, the function is paused until the person gives it.

### 4.3 The record

The host keeps a record of every accepted change: for a release, its version and the release keys that signed it; for a function, the signing key, the person who answers for it (by key and name), the grant if any, and the stated intent; and each undo, removal, pause and enrolment. `inspect()` reports what is running now and under whose name.

## 5. Grants

Envelope type `flow/grant`, signed by an enrolled person. Payload:

```json
{ "app": "example.workorders", "agent": { "suite": "p256", "pub": "<base64url>" },
  "directions": ["side"], "notAfter": 1795140000000, "caps": [] }
```

- A grant lets the agent's key sign functions for the listed directions until `notAfter` (milliseconds since 1970). If `caps` is present, the function may ask only for capabilities in it.
- A grant can only narrow: the function still has to pass every rule of section 3 as if the person had signed it. The person who signed the grant is recorded as answering for the function.
- A device with `clock: "untrusted"` MUST refuse every grant, because it cannot judge the time limit. The person can still sign directly.
- The person can revoke a grant on the device. A grant's end stops new changes; functions already installed under it stay until the person undoes or removes them.
- A grant's id is `sha256:` over the bytes `grant`, a zero byte, and the payload.

## 6. Elements

A layer's view is a tree of elements. So that a screen, a terminal, a voice and an AI agent all present the same view the same way, the meaning of each element kind is fixed here.

| Kind | Role | Name | State and action |
|---|---|---|---|
| `col`, `row`, `card` | group | none | its children, in order |
| `heading` | heading | its text | level: attribute `level`, 1 to 6, default 1 |
| `label`, `big` | text | its text | `big` is emphasised |
| `input` | text field | attribute `placeholder` | value: the state key in `bind`; `submit` names the action that Enter performs |
| `button` | button | its text | action: attribute `id` |
| `toggle` | switch | its text | on when attribute `on` is `1`; action: attribute `id` |
| any other kind | group | none | its children, in order |

- The last row is the tolerance rule for views: a kind a host doesn't know still shows its contents.
- A presenter MUST NOT fetch anything named by a view.
- A presenter that draws a screen MUST keep an element that is still present across a render as the same on-screen control, so that text being typed, focus, caret and selection survive a swap of the code behind it. Text typed into a field MUST be shown from the host's live value (`bound`), which is ahead of stored state while a swap is in flight.
- An agent's tools are exactly the buttons and switches on screen. A text field whose `submit` names a button is that tool's input. An agent can do through them what the person can do by hand and nothing more.

## 7. Refusal codes added in B1

`not_open`, `exceeds_direction`, `would_leak`, `needs_consent`, and for the host's own replay check on the company's version numbers `stale` and `bad_version`; `layer_failed` when code fails its health check.

## 8. How the reference host does it

FlowHost gives the LLP host an effective manifest: the company's manifest plus one slot per running function, with `keys` and `caps` set from section 3.1. The LLP host then enforces reads, writes and capabilities exactly as it does for any slot. The LLP host is given a private rising counter as the version; FlowHost applies LLP's replay rules to the company's own `(epoch, version)` itself.

## 9. Not in B1

- Conformance vectors and a second (Go) implementation for sections 2 to 5. A1's vectors cover the envelope and keyring these documents ride on.
- Keeping people, functions and the record across a restart of the host, and carrying a person's functions to their other devices.
- Names for the company's keys in the record.
- Following individual values through code (section 2.3 says what is checked instead).
- More element kinds: lists, images, navigation.
