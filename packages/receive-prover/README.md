# Receive presentation prover

Three fixed BN254 Groth16 relations authenticate a private Circom credential,
prove a private lookup in the 64-level authorization dictionary and bind the
actual operation. `anonymous` supports letters and private-transfer outputs;
`fund` supports Fund outputs with authenticated identity disclosure;
`attachment` additionally proves a Fund budget in a 32-level note tree.
The issuer verification key is compiled into each circuit. Public layouts are
11 fields, or 14 for an attached letter. Credential signals and proofs stay private.

`input.go` defines the canonical raw JSON request. Native and browser provers
construct a fresh full witness from this request; neither accepts a serialized
full witness. The browser uses a dedicated Worker and locally verifies its proof
before returning Solidity bytes. `prove(request, options)` in `browser.mjs` is
the one-shot frontend API. `createReceiveProver(options)` can reuse a loaded key
and terminates explicitly. Production requires pinned manifest and issuer hashes
and production ceremony artifacts. `assetHost` supports the application's
content-addressed R2 host. The Go runtime is vendored and bundled locally;
its original BSD license is in `LICENSE.go-runtime`.

From the repository root, with Go 1.26.8 on PATH (or `RECEIVE_PROVER_GO_BIN` set):

```sh
go -C packages/receive-prover test ./...
node --test packages/receive-prover/browser.test.mjs
npm run zk:development:setup
```

Development setup reads the current credential issuer keys from
`frontend/public/zk/shielded`, writes native artifacts to `zk-artifacts/receive`,
copies browser artifacts to `frontend/public/zk/receive`, generates the three
Solidity verifiers and pins all files in `circuits/receive-development-manifest.json`.
These keys are deliberately marked as development setup and cannot pass the
production browser gate. The shared setup builds the credential issuers first,
then generates the presentations against those exact keys.

After setup, check the exact application artifacts without regenerating keys:

```sh
npm run zk:artifacts:check
npm run zk:check
npm test
```

`npm test` includes the required real-proof contract tests and fails when artifacts
are missing or mismatch their manifests. It submits
atomic Fund business/receive proofs, standalone and attached letters from a
shared canonical pool root, and an owner counter update in both key modes. It
recovers real Fund budget notes and archived HPKE ciphertext after revocation and
expiry. Independent recovery separately decodes the original mnemonic and Shielded
Key and reruns the identity/passphrase KDF before deriving either restored key.

For all raw-input negative cases with one key load per circuit, the optional Go
engine smoke uses the same fixtures and the real `Engine.Prove`/`Engine.Verify`:

```sh
node scripts/receive-proof-smoke.mjs --current --prepare-only --out-dir /tmp/receive-smoke
RECEIVE_SMOKE_FIXTURES=/tmp/receive-smoke \
  RECEIVE_SMOKE_ARTIFACTS="$PWD/zk-artifacts/receive" \
  go -C packages/receive-prover test -run TestReceiveProductionBatchSmoke -count=1 -v
```

It checks four fresh proofs, all 47 public-field mutations and 31 invalid private
witnesses, then records `batch-smoke-results.json` including the authenticated
key mode. Add `--key-mode 1` to fixture preparation for independently backed-up
keys. It is skipped without the
explicit fixture/artifact paths and does not change proving assets.

The current presentation artifacts are development-only. Receive production release
is not ready; the Circom production ceremony does not establish production security
for these separate presentation keys. Release checks reject an incomplete production
bundle. Production setup is not a prerequisite for local feature acceptance.
