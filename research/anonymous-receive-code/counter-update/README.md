# Owner-authorized identity counter update (isolated P0 research)

```sh
node research/anonymous-receive-code/counter-update/run.mjs \
  "$PWD" /temporary/composition-inputs.json
```

The optional third argument chooses an output directory outside the repository;
by default a fresh OS temporary directory is used. It requires the repository's
dependencies, Circom binary and pinned `ppot_0080_17.ptau`. Setup uses at most two
local workers and proof generation is single-threaded. No Go proving job is started.

`IdentityCommitmentCore` privately recomputes I from the synthetic fixture's
identity preimage. The circuit authenticates the canonical shared alias
`Poseidon3(202610210001, I, derivedSecretField)`, verifies prior counter membership
or default-zero nonmembership, and uses `SMTProcessor(8)` to insert 1 or update
the same key by exactly one. Both counters are uint64; overflow is rejected.

Public signals are exactly:

```text
[authNullifier, chainId, consumer, aliasR, oldRoot, newRoot, oldCounter, newCounter]
```

The research-only authorization nullifier is
`Poseidon6(202610210201, derivedSecretField, aliasR, chainId, consumer, oldCounter)`.
It constrains the actual chain/address context without exposing I or its secret.
The consumer must compare chain/address to the actual call and require
`oldRoot == liveRoot` before accepting the proof and activating `newRoot`.
Accepting historical roots for owner updates would permit lost updates; the
15-minute grace period applies to receive proofs, not to competing state writes.

The script generates real 0-to-1 and 1-to-2 Groth16 proofs, a Solidity verifier,
Solidity calldata JSON and a result report. Separate negative witness tests cover
wrong secrets/aliases/roots, skipped increments, fake default0, wrong paths and
overflow; public-signal mutations are checked with the real verifier. Witness
rejection is not reported as proof-verifier rejection.

All identity data is a publicly known synthetic fixture. Depth 8 is a small test
capacity. Local setup keys are unsafe for production. Generated binaries, keys,
proofs and inputs stay outside the repository. This script does not implement
production counter contracts or the checkpoint retirement consumer itself.
