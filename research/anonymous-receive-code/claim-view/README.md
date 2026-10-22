# Proposed view-bound Fund/Claim compatibility research

This isolated experiment copies the production Claim and shared budget circuit
into a temporary directory, then applies the same proposed schema as the optional
Fund experiment. It changes no production circuit, verifier, codec, dependency,
frontend or plan.

```sh
node research/anonymous-receive-code/claim-view/run.mjs "$PWD" \
  /tmp/deepfamily-claim-view-p0 \
  /tmp/deepfamily-fund-view-p0/fund-manifest.json
```

Run from the repository root, after the optional Fund fixture has been prepared
and its proofs separately verified. The third path is optional and defaults to
the example. The output must be outside the repository. Dependencies, local
Circom and pinned `circuits/ptau/ppot_0080_17.ptau` must already exist. Setup uses
at most two local workers and proving is single-threaded. The script checks that
the relation fits ptau17 rather than downloading a larger setup.

The proposed private budget authorization is
`H5(scoped(1033), owner, keyMode, viewLo, viewHi)`. Fund and Claim private budget
notes have fixed, pool-scoped purposes `202610210301` and `202610210302`. Each
Claim input has a private boolean selecting one of these two producer tags. The
continuation always uses the Claim tag. Both inputs and the continuation reuse
the same private viewing-key limbs, so membership prevents replacing a budget's
receiver. The original identity, lineage, owner, value, maturity, period-nullifier
and two-output constraints remain present.

`prepare.mjs` can run separately with the same paths to compile and check witnesses
without setup/proofs. It builds five cases per key mode: Fund single input, Fund
refill single input, Claim continuation single input, two Fund inputs, and two
Claim inputs. Fund openings match the separately prepared Fund output
commitments, with depth-1 paths through budget/change. Claim inputs reference
earlier generated Claim outputs. `run.mjs` requires each such predecessor to have
a verified real Claim proof before it proves the successor. It exports all ten
proofs, Solidity calldata, the verifier and result report into the output directory.
Every public signal of every valid proof is separately mutated and checked with
the real verifier.

Ten negative witness checks cover each key mode with a changed view and a
consistent new output against the unchanged old root, two budgets with different
views, an incorrect first or second producer, and a nonboolean producer. These
are witness constraint rejections; no invalid proof is generated or reported as
a verifier rejection.

This tests the complete proposed Claim relation, not a live pool. Roots, lineage
and note openings are synthetic; ledger nullifier state is not enforced here.
The cases include alternative branches and do not form one shared-ledger
transaction history. This script does not independently verify Fund's outer
proofs or submit transactions; the separate Fund experiment supplies that
evidence. Synthetic 512-byte ciphertexts exercise commitment hash binding, not
HPKE correctness. Production codecs, Claim artifacts and recovery remain
unchanged and incompatible with the proposed schema until separately integrated.
Development setup keys must never be deployed.

Recorded run on 2026-10-21: 69,667 constraints, 27 public signals, ten valid real
Groth16 proofs, 270 public-signal tamper rejections and ten negative witness
rejections. Local setup took 115.78 seconds and single-threaded desktop proofs
took 11.28–11.92 seconds; browser/mobile performance was not measured. The
[local result snapshot](results.local.json) preserves the counts, cases and
limitations; the complete artifacts remain in the temporary output directory.
