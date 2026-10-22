# Private receive-code composition research

This isolated module uses Go 1.26.8 and gnark v0.16.4. It verifies an existing
snarkjs BN254 Groth16 issuance proof inside a BN254 Groth16 circuit. The inner
proof and all eleven issuer signals are private outer witnesses. The issuer VK
is a compile-time constant, not a prover-selected input. `extras.go` joins the
native counter SMT, expiry, and operation binding constraints.

Run from this directory, using temporary input and output directories:

```sh
GOTOOLCHAIN=go1.26.8 GOMAXPROCS=4 GOMEMLIMIT=5GiB go run . \
  --input-dir /tmp/issuance-input \
  --mode 0 \
  --extras-json /tmp/fixtures/extras.json \
  --poseidon-constants /tmp/fixtures/poseidon-constants.json
```

The default output directory is a new OS temporary directory. `--out-dir` can
override it. Never send circuit binaries or setup keys to the source directory.
`--parse-only` only verifies the snarkjs-to-gnark conversion, including eleven
public-input tamper rejections. `--compile-only` skips setup and proving.
`--check-inner-tamper` additionally checks eleven invalid private inner statements
against the compiled circuit; those are constraint checks, not additional proofs.
The actual prover performs those checks with its commitment hint. The generic
`ccs.IsSolved` cannot solve the recursive gadget's placeholder commitment hint.

Additional fixtures can reuse the same temporary circuit and proving key:

```sh
GOTOOLCHAIN=go1.26.8 GOMAXPROCS=4 GOMEMLIMIT=5GiB go run . \
  --reuse-setup /tmp/first-output \
  --cases-json /tmp/fixtures/composition-inputs.json \
  --poseidon-constants /tmp/fixtures/poseidon-constants.json \
  --out-dir /tmp/case-results
```

This path checks the fixed issuer VK hash, produces and verifies proofs for valid
cases, and rejects invalid witnesses during actual prover constraint solving.
It never repeats compilation or setup. Serialized setup files are trusted local
research artifacts, not an API for accepting arbitrary uploaded keys or circuits.

Input filenames are `research.vkey.json`, `mode-0.proof.json`, and
`mode-0.public.json` (or the corresponding mode 1 files). JSON G2 coordinates use
the same A0/A1 ordering as gnark; Solidity calldata uses a different ordering.

The full run exports `CompositionVerifier.sol`, `public.json`, `proof.json`,
`summary.json`, and development circuit/setup binaries into the output directory.
The JSON `solidityProof` contains the complete `MarshalSolidity` bytes, including
any commitment proof. The outer prover/verifier use gnark's Solidity-compatible
hash options. The setup is local and insecure for production; these artifacts
are research evidence, not a ceremony, release, or deployed protocol.

The Fund prototype uses a separate disclosure issuer with twelve authenticated
signals: the anonymous eleven plus the identity commitment at index 3. That
identity is visible to a Fund payer and remains a private outer witness. The
original `shielded_fund.circom` R1CS is embedded as fixed native-field matrices;
it is not replaced with a client-side fixture check. Its private identity,
recipient owner and key mode equal the authenticated disclosure fields. Its
chain and pool equal the actual operation context, and its budget kind is zero.
All original public Fund wires are public outer fields; every supplied wire and
matrix coefficient must have a canonical BN254 scalar-field encoding.

Generate the isolated fixtures from the repository root, then run this module:

```sh
node research/anonymous-receive-code/prepare-fund-composition.mjs "$PWD" /tmp/fund-p0
cd research/anonymous-receive-code/composition-go
GOTOOLCHAIN=go1.26.8 GOMAXPROCS=4 GOMEMLIMIT=5GiB go run . \
  --fund-manifest /tmp/fund-p0/fund-manifest.json \
  --out-dir /tmp/fund-p0/outer
```

This produces `FundCompositionVerifier.sol` and a real outer proof for each
valid first/refill fixture in both key modes. It checks every outer public
signal for tampering, rejects the manifest's invalid witnesses at the actual
prover, and separately rejects changes to all twelve private issuer statements.
Use `--compile-only` to skip setup/proving, or `--reuse-setup /tmp/fund-p0/outer`
to rerun cases without recompiling. Reuse checks both the fixed issuer VK hash
and fixed model JSON hash. Matrices, setup keys and serialized circuits are
trusted local research artifacts. Synthetic note roots and ciphertext bytes do
not constitute a live funding or HPKE recovery test.

The unmodified Fund relation does not commit to the receiving viewing key. Its
successful authentication prototype therefore establishes identity/owner/mode
binding, but does not establish preservation of all receiving keys on refill.
The optional viewing-key research variant sets `viewFields: true` in the fixed
model and exposes private `heirViewKeyLo`/`heirViewKeyHi` wires. The outer circuit
requires both wires and binds them to the issuer's authenticated viewing key.
The summary field `authenticatedViewingKeyBoundToBudget` distinguishes this
variant from the baseline; neither variant silently substitutes for the other.

Generate that variant with
`DEEPFAMILY_FUND_VIEW_BINDING=1 node research/anonymous-receive-code/prepare-fund-composition.mjs "$PWD" /tmp/fund-view-p0`,
then pass `/tmp/fund-view-p0/fund-manifest.json` to the same Go command. It also
tests refills from both proposed Fund and Claim output domains. Claim template
membership witnesses are synthetic; this does not run a Claim producer proof.
