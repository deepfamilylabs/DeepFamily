# Private letters and receive authorization

The inheritance page uses two fresh-v1 receive credentials. Anonymous credentials
(`dfrecv`) serve private transfers, standalone letters and private Fund attachments.
Fund credentials (`dffund`) disclose the authenticated heir identity to the payer.
Both disclosures use version 1, with distinct fixed issuer verification keys;
they cannot be converted by removing the identity field. The unpublished protocol
defines one current format, without historical-format decoding or migration.

An identity's two key modes and disclosures share the alias R and authorization
counter. First use requires no recipient registration or transaction. Credentials
and renewals are proved locally; creation and payment still read the latest shared
authorization state without filtering RPC events by the recipient's alias. The
owner can increment the counter with a proof of the
original identity secrets. This invalidates earlier credentials on this chain
within the checkpoint retirement window of 15 minutes. Credential expiry is checked
against the execution block and has no grace period. Incrementing the counter does
not change spending or decryption keys, existing balances, budgets or old letters.

## Proof and contract flow

The Circom issuer authenticates the canonical identity and R derived from the
original identity secrets, counter, expiry, owner, key mode and the complete viewing
key. The three Circom presentation circuits check a 64-level sparse state
dictionary and bind the actual operation; attachments also check Fund-note
membership. LinkG16 links an issuer proof and a presentation proof over the same
hidden credential fields, then rerandomizes both proofs before submission. Neither
circuit evaluates pairing arithmetic or recursively verifies another proof.

The fixed Solidity verifiers authenticate both keys and their shared hidden inputs.
The caller cannot choose another issuer key. The shared
`frontend/public/zk/shielded/receive-link-keys.json` contains the public linking
parameters; `linkKeys` in the shielded artifact manifest pins that file, the shared
verifier base and all three generated verifiers. The original identity preimage,
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
factory. It authenticates ciphertext, message ID, recipient commitment and credential
expiry before writing immutable Archive segments. Attachments additionally prove
membership of an actual private Fund note under an accepted canonical pool root,
with the same owner, viewing key and mode. The attachment circuit supports the
production 32-level note tree. It does not require the credential identity to equal
the budget's heir identity. Public identity budgets cannot have attachments.

Letter bodies are plain text encrypted in the browser's secret-owning Worker with
the existing receiving HPKE key. The message's chain, archive and ID are included in
AAD. The structured budget reference is checked again after decryption against the
authenticated relation commitment. The UI does not display a mismatching reference
as a budget attachment. Funding and letter submission are separate transactions:
retrying an attachment never repeats a successful deposit.

The inheritance page places Private letters below Child budgets in the unlocked
workspace's task rail. Write a letter and Inbox are separate entries; they use the
same task area as deposits and claims. The inbox reads when selected and provides
an explicit refresh action. A budget attachment entry selects the write task with
that budget. A standalone letter proof requires a valid anonymous
receive credential and a transaction wallet; it does not require the sender's
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
| Anonymous / private transfer | 14,216,109 bytes (13.56 MiB) |  1,184 bytes |             11 |
| Fund                         | 14,355,369 bytes (13.69 MiB) |  1,216 bytes |             11 |
| Attached letter              | 21,993,051 bytes (20.97 MiB) |  1,184 bytes |             14 |

Only the needed presentation is loaded. The roughly 26 KiB link-key file is shared
by all three. Proof sizes exclude public signals, other transaction data and
ciphertext. Issuing a receive credential uses its own small issuer WASM/zkey.

## Development

```sh
npm run zk:assets:fetch
npm run dev:deploy
npm run frontend:config
```

Local development, CI and release reuse one pinned artifact set for all 13 Circom
circuits, including the credential issuers, counter update and three presentations.
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
standalone and shared-root attached letters, owner counter updates and Archive
recovery. It requires the real artifacts and fails if they are missing or do not
match the manifests. It also runs the complete 64/32-depth business-proof check.
Generate a replacement final artifact set explicitly with `npm run zk:setup` after reviewing
and committing a circuit change; local deployment never regenerates keys automatically.

`zk:check` also exercises fresh linked receive proofs and rejects changed public
signals and invalid private witnesses. The single setup covers the complete Circom artifact
catalog, including receive proofs. Local feature acceptance can reuse the current pinned
development-only files; publication requires the reviewed final setup and the other release
evidence.
