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
the existing receiving HPKE key. The message's chain, archive and ID are included in
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

## Browser artifacts

All proving uses Circom WASM and snarkjs in the existing Worker. There is no Go
prover, separate receive runtime or browser R1CS download. The current presentation
WASM and zkey download sizes are:

| Presentation                 |                  WASM + zkey | Linked proof | Public signals |
| ---------------------------- | ---------------------------: | -----------: | -------------: |
| Receive / private transfer | 14,216,094 bytes (13.56 MiB) |  1,184 bytes |             11 |
| Fund                         | 14,355,354 bytes (13.69 MiB) |  1,216 bytes |             11 |

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
