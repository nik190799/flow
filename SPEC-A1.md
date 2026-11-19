# FLOW revision A1: envelope, trust policy, tolerance

Status: draft, revision A1. Builds on the [Live Layer Protocol](https://github.com/nik190799/live-layer-protocol) (LLP) v1 and doesn't change it.

The words MUST, MUST NOT and MAY are used as in RFC 2119.

## 1. Envelope

Every signed FLOW document travels in one wrapper:

```json
{ "flow": 1, "type": "flow/keyring", "payload": "<base64url>", "sigs": [{ "kid": "sha256:…", "sig": "<base64url>" }] }
```

- `payload` is the document's exact bytes, unpadded base64url. A verifier MUST refuse padded or otherwise non-canonical base64url.
- `type` matches `^[a-z0-9][a-z0-9./-]{0,63}$`. A1 defines `flow/keyring` and `flow/release`.
- Each signature covers these bytes, independent of how the wrapper is written:

  ```
  "FLOWv1" SP len(type) SP type SP len(payload) SP payload
  ```

  `len` is the byte length as ASCII decimal and SP is one space (0x20). This is the DSSE pre-authentication encoding with a FLOW prefix. The document kind is signed, so a signature over one kind can't be presented as another.
- The wrapper is not signed. A verifier MUST ignore wrapper fields and signature-entry fields it doesn't know, and MUST give the same result for any re-serialisation of the wrapper.
- `flow` greater than 1 is refused with `host_too_old`. Any other value except 1 is `malformed`.
- At most 64 signature entries and 1 MiB of payload.
- **Verify first, parse second.** Signatures are counted over the raw payload before it is parsed. The only exception is the first keyring (section 3.3), whose trust comes from shipping with the host or from a pinned hash.

### 1.1 Payload JSON

Payloads are UTF-8 JSON objects. A verifier MUST refuse a payload that isn't valid UTF-8, isn't JSON, isn't an object at the top, or repeats a key within one object (parsers disagree on which copy wins, so such a document could mean different things on different hosts). Integers are JSON numbers that are whole and within ±(2^53 − 1).

## 2. Signature suites

| Suite | Method | Public key | Signature | Quantum-safe |
|---|---|---|---|---|
| `p256` | ECDSA, P-256, SHA-256 | 65-byte uncompressed point | 64 bytes, r ‖ s | no |
| `slh-dsa-sha2-128s` | SLH-DSA (FIPS 205), pure mode, empty context | 32 bytes | 7,856 bytes | yes |

A key's id is `kid = "sha256:" + hex(SHA-256(suite ‖ 0x00 ‖ public key bytes))`, so a kid names one key of one suite and can't be re-pointed. Signatures by kids the verifier doesn't hold, or in suites it doesn't implement, are ignored rather than fatal; whether they were needed is the policy's question (section 3).

## 3. Keyring (trust policy)

`flow/keyring` payload:

```json
{
  "keyring": 1,
  "app": "demo.tasks",
  "keys":  { "<kid>": { "suite": "p256", "pub": "<base64url>" } },
  "roles": {
    "root":    [{ "suite": "p256", "keys": ["<kid>", "<kid>", "<kid>"], "threshold": 2 },
                { "suite": "slh-dsa-sha2-128s", "keys": ["<kid>", "<kid>"], "threshold": 1 }],
    "release": [{ "suite": "p256", "keys": ["<kid>"], "threshold": 1 }]
  },
  "spare": { "suite": "slh-dsa-sha2-128s", "kid": "<kid>" },
  "requires": []
}
```

### 3.1 Rules

- Every kid in `keys` MUST equal the kid computed from its suite and public key. A public key in an implemented suite MUST have that suite's length.
- A group lists distinct kids from `keys`, all of the group's suite, with `1 ≤ threshold ≤ len(keys)`.
- `root` and `release` MUST be present. Other roles MAY be present; a host carries them without judging them.
- **A document is valid for a role only if every group of that role meets its threshold**, counting each kid once however many times it signs.
- **The root role MUST include at least one quantum-safe group,** from keyring 1 on. Otherwise: `weak_root`.
- If a `root` or `release` group uses a suite the host doesn't implement: `host_too_old`.
- `spare` commits to one spare root key by kid. It MUST NOT be an active key.

### 3.2 Changing the keyring

A device holding keyring N accepts keyring M only if, in this order:

1. M is signed under the **full root policy of N**. The spare committed in N MAY stand in for one missing key of its own suite in one group; its signature entry then also carries `pub`, which is accepted only if it hashes to the committed kid.
2. M passes section 3.1.
3. M is for the same app (`wrong_app`) and M.keyring > N.keyring (`stale`).
4. M is signed under the **full root policy of M**.
5. If the spare was used, M commits to a different spare.

So an attacker who can't satisfy today's policy can't change it, an attacker holding keys of only one suite can't strip the other, and the root can still deliberately add, replace or retire a suite. Trust comes only from the keyring on the device, never from what a document says about itself.

### 3.3 The first keyring

The first keyring ships with the host, or is pinned at install by the SHA-256 of its payload. It MUST pass section 3.1 and be signed under its own root policy.

## 4. Release

`flow/release` payload:

```json
{ "app": "demo.tasks", "manifest": { …an LLP v1 manifest… }, "expires": 1795046400000, "requires": [] }
```

- Signed under the keyring's `release` role (`untrusted` otherwise).
- `app` equals the keyring's app (`wrong_app`), and `manifest.app` equals `app` (`malformed`).
- `expires` (optional) is milliseconds since 1970. On a device whose clock is trusted, a release past it is `expired`. A device with no trustworthy clock MUST NOT judge expiry; signatures and rising numbers decide alone.
- The manifest is then handed to an LLP host, which applies every LLP v1 rule unchanged (blob hashes, versions, epochs, sandbox, staging, rollback). A host sets LLP's highest acceptable epoch to the keyring number.

## 5. Tolerance

- Unknown fields anywhere in a FLOW document are ignored.
- A feature a host must understand goes in `requires`, a list of names. A host that doesn't implement every listed name refuses with `host_too_old`. Revision A1 defines no names.
- No field is reserved in advance, and tools MUST NOT emit a field with no enforced meaning.
- The LLP manifest inside a release keeps LLP v1's own rules, which are strict about unknown top-level fields (`x-` prefixed fields excepted).

## 6. WebAssembly 1.0

A FLOW host MAY require every layer to use only the WebAssembly 1.0 feature set (the reference host does by default), so engines from 2017 on can run it. Such a host refuses layers using any later feature (sign extension, non-trapping float-to-int, bulk memory, reference types, multi-value, mutable-global import or export, SIMD, threads, tail calls, exceptions, multi-memory) with `not_wasm_1`. AssemblyScript users build with `--disable mutable-globals,sign-extension,nontrapping-f2i,bulk-memory`.

## 7. Offline install

A device MUST be able to accept or refuse keyrings and releases from files alone. A bundle is a directory with `keyrings/*.json` (applied in file-name order), `release.json`, and `blobs/<sha256>`. Nothing in a bundle is trusted for being there: every file goes through the checks above.

## 8. Refusal codes

`malformed`, `wrong_type`, `untrusted`, `host_too_old`, `weak_root`, `stale`, `wrong_app`, `expired`, `not_wasm_1`. Two conforming hosts MUST give the same code for the same input; the conformance vectors check this.

## 9. Conformance

`conformance/capsule-a1/` holds the vectors written the day A1 was frozen, with `LOCK.json` holding each file's SHA-256. They MUST NOT change. Every later revision MUST keep passing them unless it adds a name to `requires`, so a host and documents frozen today keep working. New vectors go in new sets.
