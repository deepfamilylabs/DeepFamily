# Frontend Security Guide

This document describes the security posture of the DeepFamily Vite/React frontend. The current
protocol uses one user-entered passphrase for a person's deterministic identity derivation and for
that version's encrypted metadata envelope. The two derivations remain domain-separated and use
different salts; "one passphrase" does not mean reusing the same KDF output as both keys.

## Threat Model

### In scope

- Accidental secret disclosure through React state/props, form watchers, logs, telemetry, URLs,
  browser storage, transaction state, or long-lived Worker caches.
- Malformed, unsupported, truncated, or context-mismatched on-chain metadata reaching a KDF or
  being displayed as authenticated plaintext.
- Opportunistic browser exposure caused by an over-permissive CSP or avoidable network egress.
- Supply-chain and dependency risks addressed through pinning, review, and auditing.

### Out of scope and explicit product boundaries

- If attacker-controlled JavaScript runs in the origin (XSS or a compromised dependency), it can
  read an input before dispatch, intercept Worker messages, and read unlocked IndexedDB records.
- Browser extensions with broad privileges, a compromised browser profile, backups, DevTools,
  and OS-level malware can read or alter locally cached plaintext.
- A weak or empty passphrase is subject to offline guessing. Empty is a valid protocol value and
  still runs the full KDF; the UI warns and requires explicit high-risk confirmation, but cannot
  make it secret.
- The contract cannot prove that `versionCommitment` was computed from the plaintext encrypted in
  an envelope. A holder of a valid identity witness can deliberately use a false private
  `contentDigest`. The canonical client detects this only after decrypting, reserializing, and
  recomputing all bindings.
- Encryption provides no field-level access control. The current person's one passphrase unlocks
  the whole metadata JSON, including person data, parent snapshots, `tag`, and `biography`.

## Sensitive Inputs

Treat all of the following as sensitive working material:

- raw and NFKD-normalized passphrases for the current person and non-null parents;
- domain-separated identity/file password bytes;
- deterministic identity salts and random file salts;
- Argon2id outputs, `derivedSecretField`, KEK, DEK, and proof witnesses;
- plaintext `contentDigest` and canonical/gzip working buffers before they are intentionally
  converted into an unlocked display DTO.

Rules:

- Keep passphrases in uncontrolled input elements. Read them only at the action boundary and pass
  them directly to the crypto/prover Worker or the owning service.
- Never put secrets in React state, props, context, reducers, URLs, errors, telemetry, or
  `console.*` output.
- Never persist a passphrase, password fingerprint, identity salt, derived secret, key, proof
  witness, or `contentDigest` in localStorage, sessionStorage, IndexedDB, or a Service Worker cache.
- Best-effort clear DOM inputs and working buffers as soon as the immutable submission package or
  validated unlock result has been produced. JavaScript memory erasure is not a hard guarantee.
- An uncertain RPC result may retain and resubmit the exact frozen proof/public-signals/envelope
  package. It must not rerun the KDF, prover, or encryption with already-cleared secrets.

The identity and file KDF paths both normalize the raw passphrase with the protocol's checked-in
Unicode 17.0.0 NFKD implementation and do not trim it; browser/Node host ICU tables are not used.
They prepend different nonempty domains before Argon2id, so even an empty raw passphrase executes
the full KDF. Identity suite 1 derives a deterministic salt from the suite ID and canonical
identity fields; format 1 uses a fresh random `fileSalt` for every envelope.

## Metadata Read and Unlock Boundary

Version metadata is fetched from the on-chain Archive. `DeepFamilyReader` returns the immutable
`MetadataRef(pointer,payloadHash,payloadLength)` associated with the person version, and the client
reads the pointer's runtime bytecode with `eth_getCode`.

Before showing a password field or invoking Argon2id, the client must fail closed unless all of
these preflight checks pass:

1. the data-contract runtime length is exactly `payloadLength + 1`;
2. byte zero is the `STOP` opcode and is removed before interpreting the envelope;
3. `keccak256(code[1:])` equals `payloadHash`;
4. the 20-byte DFM1 common prefix has magic `DFM1`, a nonzero `formatVersion`, and a nonzero
   big-endian `identitySuiteId` at offset `0x10`;
5. the format is supported; format 1 then passes all fixed header, selector, length, flags, and
   reserved-field checks.

After KDF and AES-GCM authentication, a result is usable only after strict gzip and canonical-JSON
decoding, canonical byte-for-byte reserialization, chain-context checks for the person and parents,
person-hash rederivation, and `versionCommitment` recomputation. A wrong password and malformed or
malicious data share the same fail-closed outcome: no decrypted field is merged or displayed.

Batch unlock performs these preflights first and then runs KDF work sequentially. Cancellation
terminates the active Worker rather than merely ignoring its result. Versions validated before a
cancellation remain cached; a failed item is never written.

## Plaintext IndexedDB Cache

After all unlock checks succeed, the product intentionally stores the complete `NodeData` as
plaintext in IndexedDB. This includes decrypted identity/parent display fields, `tag`, `biography`,
the public chain/archive anchors, and an explicit validation marker. Empty `tag` and empty
`biography` are still a successfully unlocked record; truthiness is not the validation marker.

This cache is scoped by at least chain ID, DeepFamily proxy address, and protocol/cache generation.
Reloading the same scope may display the cached fields without another KDF. If IndexedDB is
unavailable or a write fails, the app keeps only the current in-memory result and must not fall back
to storing secrets elsewhere. "Clear local unlocked metadata" is a best-effort deletion that makes
the UI locked again; it cannot erase browser-profile backups or copies already read by another
same-origin script.

The cache is a product convenience, not a cryptographic trust anchor. Without the passphrase and
derived keys, a hydrated plaintext DTO cannot be independently reauthenticated after local
tampering. Re-establishing authenticity requires clearing/replacing it with a fresh on-chain read
and complete unlock.

Private `biography` is part of this encrypted metadata snapshot. The NFT supplement `story` and
on-chain `StoryChunk` records are separate, intentionally public data. The UI must not silently copy
private biography text into the public NFT story; any copy is an explicit user action with public
disclosure confirmation.

## Content Security Policy

- Keep `script-src` free of `'unsafe-inline'` and keep preview/production free of `'unsafe-eval'`.
- Restrict `connect-src` to reviewed RPC and other required public-resource origins.
- Use Report-Only while discovering a necessary source, then move the reviewed policy to enforced
  mode.
- CSP reduces the chance and reach of injection; it does not protect input or IndexedDB plaintext
  after arbitrary same-origin JavaScript executes.

## Logging and Error Hygiene

- Sanitize errors at the Worker/service boundary and expose only a small non-sensitive shape such
  as `{ name, message, code }`.
- Never log passphrases, plaintext metadata, identity material, keys, proofs, or intermediate
  buffers.
- Do not distinguish wrong-passphrase failures in a way that leaks decrypted structure. Detailed
  protocol errors may be useful in development tests, but production UI should remain generic.

## Dependency Governance and Workers

- Keep `package-lock.json` committed and review crypto, compression, ZK, and serialization changes
  as protocol-sensitive updates.
- Run `npm run security:audit`, `npm run security:xss-scan`, and the frontend CSP scan before a
  release.
- Keep Worker code free of React, DOM, `window`, and browser-storage dependencies. Workers reduce
  UI blocking and accidental React-state exposure, but do not form a security boundary against XSS.
- Only public ZK artifacts (`.wasm`, `.zkey`, `.vkey.json`) are candidates for ordinary asset
  caching. Validate their release-manifest hashes and fetch origins.
