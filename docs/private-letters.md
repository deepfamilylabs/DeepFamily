# Private letters and receive authorization

The inheritance page uses two fresh-v1 receive credentials. Receive credentials
(`dfrecv`) serve private transfers and letters. Fund credentials (`dffund`), shown as
budget receiving credentials, disclose the authenticated heir identity to the payer and serve
private budgets only.
Both purposes use version 1, with distinct fixed issuer verification keys;
they cannot be converted by removing the identity field. The unpublished protocol
defines one current format, without historical-format decoding or migration.

An identity's two key modes and purposes share the alias R and authorization
counter. First use requires no recipient registration or transaction. Credentials
and renewals are proved locally; creation and payment still read the latest shared
authorization state without filtering RPC events by the recipient's alias. The
owner can increment the counter with a proof of the
original identity secrets. The owner circuit exposes exactly
`[authNullifier, chainId, consumer, aliasR, oldCounter, newCounter]` and constrains the
uint64 increment, without any global-tree roots or paths. The state contract checks
the live counter and updates its stored dictionary through
`incrementCounter(authNullifier, aliasR, oldCounter, newCounter, proof)`.
`prepareShieldedIdentityCounterAuthorization` is the sole owner-proof preparation
API; the old global-tree transition APIs and authorization ABI have been removed.
The replacement development keys and fixed verifier match the six-signal circuit.
Incrementing the counter invalidates earlier credentials on this chain
within the checkpoint retirement window of 15 minutes. Credential expiry stays private:
the presentation proves the credential is unexpired at its `asOf`, and the only public
time is `deadline = asOf + 15 minutes`, which the consumer checks against the execution
block. A payment or letter started before expiry may therefore land up to 15 minutes
after it; nothing can be started once the credential has expired. Incrementing the counter does
not change spending or decryption keys, existing balances, budgets or old letters.

Authorization reads and receive presentations still support complete 64-level
paths. Owner authorization is independent of tree depth. Distinct aliases with
identical low 64 bits cannot both be inserted; this separate dictionary capacity
limit rejects without modifying state.

## Diversified ordinary receive keys

Each newly generated `dfrecv` code carries a fresh 64-byte receive address:
`diversifier[32] || publicKey[32]`. The public point uses the Ristretto255
prime-order group and a domain-separated hash-to-group base for that diversifier.
The selected wallet's original viewing input deterministically recreates one
viewing scalar; different bases produce different receiving public points for the
same scalar. `dffund` continues to carry its fixed 32-byte X25519 key for budget
funding and recovery. These are separate current purposes, not historical formats.
Both credential packets are 405 bytes before Bech32m encoding.

The two receive-circuit key limbs authenticate a domain-separated SHA-256 digest
of the complete 64-byte ordinary receive address. Thus changing its diversifier
or point changes the issuer statement and operation binding. Fund key limbs retain
the raw X25519 encoding. Spending secrets, owner commitments, identity aliases,
authorization counters and budget recipient keys keep their existing semantics.
In particular, changing the public receiving point alone does not make complete
codes unlinkable: their owner commitment and identity authorization alias remain
stable as described above.

Ordinary transfer notes and private letters encrypt with the diversified receiving
address. Their ephemeral group point allows the recipient to derive the shared
secret using its original viewing scalar before knowing the diversifier. The
address diversifier and encryption randomness are authenticated inside the
encrypted plaintext, and recovery verifies the reconstructed ephemeral point
before returning any payload. Recovery needs the original wallet credentials and,
for independent mode, the original independent root; it does not require saved
codes, per-code private keys, diversifiers or an address index. Expiry and counter
revocation do not participate in historical decryption.

The complete byte-level specification, threat model, application acceptance rules
and remaining security proof obligations are in
[Diversified receive encryption](receive-encryption-protocol.md). The ordinary
receive suite uses the following domain-separated steps
(`||` denotes concatenation, all seeds and diversifiers are 32 bytes):

- `v = LEOS2IP(SHA-512(ViewDomain || viewIkm || counterByte)) mod L`, retrying the
  counter only if the scalar is zero. `L` is the Ristretto255 scalar order.
- `G_d = hash_to_ristretto255(d, DST)`, using the RFC 9380 Ristretto mapping and
  rejecting the identity point; `P_d = v G_d`. Address encodings are canonical and
  the identity point is rejected.
- Draw `rseed` from the OS/browser CSPRNG, derive `e` by the same nonzero-scalar
  procedure under `EphemeralDomain`, then form `epk = e G_d` and `ss = Encode(e P_d)`.
- `context = SHA-256(KdfDomain || epk || SHA-256(info) || SHA-256(aad))`.
  Derive the 32-byte AES key and 12-byte nonce with HKDF-SHA256 using `ss` as IKM,
  `context` as salt and distinct `KeyLabel` / `NonceLabel` values.
- AES-256-GCM authenticates `d || rseed || payload` with the caller's AAD.
  A receiver computes `ss = Encode(v epk)`, opens the ciphertext, and rejects unless
  `epk = e G_d` reconstructs from the authenticated `d` and `rseed`.

The exact domain strings and DST are frozen in
`packages/protocol-core/shielded-receive-encryption.js`. They separate view-scalar,
ephemeral-scalar, group-base, key and nonce derivation. The ciphertext reveals only
its fresh ephemeral point and authenticated ciphertext, not the reusable address
or its diversifier. Ordinary money notes still occupy 512 bytes: 32-byte ephemeral
point, 464 bytes of sealed plaintext including 64 bytes of hidden metadata, and a
16-byte GCM tag. Their payload capacity is 397 bytes after the 3-byte note header.
Private letters add the same 64 encrypted metadata bytes without a fixed-size cap.

Secret scalar reduction and point multiplication use the pinned libsodium WASM
backend in the browser's existing secret-owning Worker. Initialization verifies
that the secret operations use WASM and fails rather than selecting the former
BigInt or an asm.js fallback. Public address validation may still use noble.
This replaces the secret computation backend without changing derivation bytes,
the address format or backup requirements; it introduces no server-side key
processing. A WASM implementation does not establish end-to-end constant-time
behavior in every browser or replace evaluation of the complete protocol.

Budgets, self outputs and donor backup memos retain their X25519 HPKE encryption.
The common wallet scan recognizes recoverable current-purpose outputs using the
same restored viewing input. Ordinary transfer payloads use the diversified
fixed-size envelope; budget and donor memo payloads use the HPKE envelope. Private
letters use the diversified envelope and retain their chain, archive and message-ID
AAD. The diversified construction reuses standardized Ristretto255, hash-to-group,
HKDF and authenticated-encryption primitives, but the composed application scheme
has not received an independent cryptographic audit; it is not a claim that the
application implements the complete Zcash protocol or inherits its security proof.
The shared viewing secret intentionally decrypts all associated diversified
addresses. Disclosure of it exposes their past and future encrypted data; this
construction provides no forward secrecy. Expiry and revocation do not protect
published ciphertexts from a subsequently disclosed viewing secret.

## Budget receiving credentials

Identity credentials and the independent key each issue a receive code and a
**Budget receiving credential**. A budget receiving credential is the single
Fund credential. It discloses and authenticates the heir identity to the funder, which
private funding needs to prove the parent-child relationship and trusted endorsement. Only
private Fund accepts it; private transfers and letters require a receive code.
The UI explains that sharing a budget receiving credential discloses the heir identity to the
funder. Public identity budgets need no receive code.

Each unlocked wallet card has separate **Receive code** and **Receive a budget**
entries. The first generates a receive code directly; the second generates a budget
receiving credential. Both open a wallet-bound sheet with expiry and revocation
controls, without a credential-type selector. Generated titles, copy actions and
funding inputs identify their purpose. Pasting the other purpose's material produces
an explicit request for the required code or credential before a transaction is prepared.

Budgets carry no letters: funding needs one code and one transaction, and letters are
written separately to the recipient's receive code. Letter plaintext and receive
material stay in the active session and are cleared when its wallet, identity, key or
deployment context is invalidated. They are not silently persisted as plaintext to support
retry after reload.

## Proof and contract flow

The Circom issuer authenticates the canonical identity and R derived from the
original identity secrets, counter, expiry, owner, key mode and the complete viewing
key. The two Circom presentation circuits check a 64-level sparse state
dictionary and bind the actual operation. LinkG16 links an issuer proof and a
presentation proof over the same hidden credential fields, then rerandomizes both
proofs before submission. Neither
circuit evaluates pairing arithmetic or recursively verifies another proof.

The fixed Solidity verifiers authenticate both keys and their shared hidden inputs.
The caller cannot choose another issuer key. The shared
`frontend/public/zk/shielded/receive-link-keys.json` contains the public linking
parameters; `linkKeys` in the shielded artifact manifest pins that file, the shared
verifier base and both generated verifiers. The original identity preimage,
alias derivation and key-ownership requirements remain in the issuer circuits.

Private Fund and PrivateTransfer submit both the existing business proof and a
receive presentation for every external recipient output. Both proofs authenticate
the same randomized recipient commitment, including the heir identity for Fund.
The pool verifies both atomically before spending notes or appending outputs. The
presentation binds chain, pool, action, output slot and the hash of all actual action
data. The original credential and issuer proof do not appear on chain. A zero receive
commitment is allowed only where the business circuit proves the actual input owner
is also the output owner; Shield remains a self-deposit operation.

`PrivateLetterArchive` uses the same authorization state as the canonical pool
factory. It authenticates ciphertext, message ID, recipient commitment and the proof
deadline before writing immutable Archive segments.

Letter bodies are plain text encrypted in the browser's secret-owning Worker with
the selected diversified receive address. The message's chain, archive and ID are included in
AAD.

The inheritance page places Private letters below Child budgets in the unlocked
workspace's task rail. Write a letter and Inbox are separate entries; they use the
same task area as deposits and claims. The inbox reads when selected and provides
an explicit refresh action. A letter proof requires a valid receive
credential and a transaction wallet; it does not require the sender's
identity secrets. Reading an inbox requires the original receiving keys. Wallet
or key-session changes invalidate pending submissions and clear locally displayed
plaintext.

The inbox reconstructs authenticated letter records and Archive bytes from chain
events, then decrypts locally using the original identity/key recovery materials.
Independent-key mode still needs its original mnemonic or Shielded Key. Credential
expiry or revocation does not prevent recovery of an already sent letter. Plaintext
and secrets are not persisted in ordinary application storage or sent to a prover
service.

Before displaying a decrypted letter, recovery recomputes the on-chain recipient
binding using the session's owner commitment and key mode, the public receiving
key reconstructed during decryption, and the encrypted authorization alias and
salt. A known session identity must also match that alias. Successful decryption
alone does not establish that the presentation authorized this recipient; a
mismatched binding is rejected. The encrypted alias lets an independent-key backup
perform the same check without requiring the identity-derived key branch.

The canonical encrypted letter envelope is `DFLE[4] || version[1] || reserved[3] ||
salt[32] || authorizationAlias[32] || utf8Length[8] || body`. Its header is 80 bytes;
the complete diversified ciphertext adds 197 bytes to the UTF-8 body. Neither alias
nor salt is exposed outside the authenticated ciphertext. This receiving check
uses no current counter or code expiry, so historical letters remain readable.

## Browser artifacts

All proving uses Circom WASM and snarkjs in the existing Worker. There is no Go
prover, separate receive runtime or browser R1CS download. The current presentation
WASM and zkey download sizes are:

| Presentation               |                  WASM + zkey | Linked proof | Public signals |
| -------------------------- | ---------------------------: | -----------: | -------------: |
| Receive / private transfer | 14,216,094 bytes (13.56 MiB) |  1,184 bytes |             11 |
| Fund                       | 14,355,354 bytes (13.69 MiB) |  1,216 bytes |             11 |

Only the needed presentation is loaded. The roughly 17 KiB link-key file is shared
by both. Proof sizes exclude public signals, other transaction data and
ciphertext. Issuing a receive credential uses its own small issuer WASM/zkey.

## Development

```sh
npm run zk:assets:fetch
npm run dev:deploy
npm run frontend:config
```

Local development, CI and release reuse one pinned artifact set for all 15 Circom
circuits, including the credential issuers, counter update and two presentations.
The explicit `npm run zk:setup` command creates the final keys, shared linking parameters,
fixed verifiers and single-operator ceremony evidence from a clean, reviewed commit on a
controlled machine outside CI. Generated proving files stay out of Git. The shared circuit
manifests record shielded artifact hashes and `linkKeys`. Build, fetch and check commands reuse
those keys; stale sources, mismatched issuer keys, incomplete circuit sets and modified proving
files stop the workflow. Browser downloads use the existing content-addressed asset host and
digest checks. The current checked-in keys remain unattested and marked
`developmentOnly: true` and `productionReady: false` until the explicit final setup and review.

Integrated deployment creates the shared state, its owner-proof adapter, the
presentation verifiers and money router, canonical pools/factory, and letter archive.
The frontend reads authorization state from the configured factory, checks archive
wiring and uses `VITE_PRIVATE_LETTER_ARCHIVE_ADDRESS` and
`VITE_PRIVATE_LETTER_ARCHIVE_FROM_BLOCK` (including per-chain variants). The local
configuration command fills these from deployment records.

Use the shared workflow for builds, artifact checks and acceptance:

```sh
npm run zk:check
npm test
```

`npm test` includes both key modes with actual Fund business/receive proofs,
letters, owner counter updates and Archive recovery. It requires the real artifacts and fails if they are missing or do not
match the manifests. It also runs the complete 64/32-depth business-proof check.
Generate a replacement final artifact set explicitly with `npm run zk:setup` after reviewing
and committing a circuit change; local deployment never regenerates keys automatically.

`zk:check` also exercises fresh linked receive proofs and rejects changed public
signals and invalid private witnesses. The single setup covers the complete Circom artifact
catalog, including receive proofs. Local feature acceptance can reuse the current pinned
development-only files; publication requires the reviewed final setup and the other release
evidence.
