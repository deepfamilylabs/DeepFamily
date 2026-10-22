# Private letters and receive authorization

The inheritance page uses two version-2 receive credentials. Anonymous credentials
(`dfrecv`) serve private transfers, standalone letters and private Fund attachments.
Fund credentials (`dffund`) disclose the authenticated heir identity to the payer.
The product rejects version-1 credentials; the two disclosures have distinct fixed
issuer verification keys and cannot be converted by removing the identity field.

An identity's two key modes and disclosures share the alias R and authorization
counter. Credential creation reads the shared state without filtering RPC events
by the recipient's alias. The owner can increment the counter with a proof of the
original identity secrets. This invalidates earlier credentials on this chain
within the checkpoint retirement window of 15 minutes. Credential expiry is checked
against the execution block and has no grace period. Incrementing the counter does
not change spending or decryption keys, existing balances, budgets or old letters.

## Proof and contract flow

The Circom issuer authenticates R, counter, expiry, owner, key mode and the complete
viewing key. `packages/receive-prover` produces a private presentation of that issuer
proof, checks a 64-level sparse state dictionary and binds the actual operation.
The fixed issuer key is compiled into each presentation circuit. The caller cannot
supply a different issuer key while proving.

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

The standalone composer is available before identity unlock: a valid anonymous
receive credential and a transaction wallet suffice to write. Reading an inbox
requires the original receiving keys. Wallet or key-session changes invalidate
pending submissions and clear locally displayed plaintext.

The inbox reconstructs authenticated letter records and Archive bytes from chain
events, then decrypts locally using the original identity/key recovery materials.
Independent-key mode still needs its original mnemonic or Shielded Key. Credential
expiry or revocation does not prevent recovery of an already sent letter. Plaintext
and secrets are not persisted in ordinary application storage or sent to a prover
service.

## Development

The presentation backend pins its Go and gnark versions in
`packages/receive-prover/go.mod`. Supply that Go toolchain in PATH, or set
`RECEIVE_PROVER_GO_BIN` to its executable. The Go runtime is compiled to WASM for
the existing Worker flow; its JavaScript runtime is vendored and bundled locally.

```sh
npm run zk:development:setup
npm run dev:deploy
npm run frontend:config
```

The setup generates the Circom issuers and counter-update verifier first, then the
three fixed-issuer presentation circuits. Generated proving files stay out of Git.
`circuits/receive-development-manifest.json` records their hashes and the matching
issuer keys. It also pins the Go source/module/constants catalog and the browser
loader sources. The build records native/WASM hashes and its source snapshot;
each circuit setup must use that same snapshot. Synchronization rejects stale
sources, a replaced issuer key, incomplete circuit sets and modified proving files.
Browser asset downloads use the same content-addressed asset host and
digest checks as the existing proof assets. Local development setup remains marked
`developmentOnly: true` and `productionReady: false`.

Integrated deployment creates the shared state, its owner-proof adapter, the
presentation verifiers and money router, canonical pools/factory, and letter archive.
The frontend reads authorization state from the configured factory, checks archive
wiring and uses `VITE_PRIVATE_LETTER_ARCHIVE_ADDRESS` and
`VITE_PRIVATE_LETTER_ARCHIVE_FROM_BLOCK` (including per-chain variants). The local
configuration command fills these from deployment records.

Use the shared workflow for builds, artifact checks and acceptance:

```sh
npm run zk:build
npm run zk:artifacts:check
npm run zk:check
npm test
```

`npm test` includes both key modes with actual Fund business/receive proofs,
standalone and shared-root attached letters, owner counter updates and Archive
recovery. It requires the real artifacts and fails if they are missing or do not
match the manifests. It also runs the complete 64/32-depth business-proof check.
Regenerate keys only when needed with `npm run zk:development:setup`.

For targeted prover maintenance, prepare current-key fixtures and run the optional
Go engine smoke. This uses the installed keys without regenerating application assets:

```sh
node scripts/receive-proof-smoke.mjs --current --prepare-only --out-dir /tmp/receive-smoke
RECEIVE_SMOKE_FIXTURES=/tmp/receive-smoke \
  RECEIVE_SMOKE_ARTIFACTS="$PWD/zk-artifacts/receive" \
  go -C packages/receive-prover test -run TestReceiveProductionBatchSmoke -count=1 -v
```

The smoke retains one engine at a time and checks four fresh proofs, 47 public-signal
mutations and 31 invalid private witnesses. `batch-smoke-results.json` records the
circuit version, key mode and artifact-manifest digests. Add `--key-mode 1` to fixture
preparation to exercise independently backed-up keys.

The current presentation artifacts remain development-only. Receive production
release is not ready; a Circom ceremony or a changed manifest flag does not establish
production security for these separate presentation keys. Release checks continue to
reject the incomplete production bundle. Production setup and external deployment
are not prerequisites for local feature acceptance.
