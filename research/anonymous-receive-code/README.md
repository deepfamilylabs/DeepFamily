# Anonymous receive-code feasibility experiments

Isolated research for the local inheritance letters plan, 2026-10-21. No production
protocol, circuit, contract, frontend behavior, or plan is changed by these scripts.
All identities and secrets used here are synthetic test fixtures.

Run from the repository root with its existing dependencies and local ZK assets:

```sh
node research/anonymous-receive-code/run-legacy-enumeration.mjs
node research/anonymous-receive-code/run-issuance.mjs
node research/anonymous-receive-code/run-state.mjs
node research/anonymous-receive-code/run-fund-witness.mjs "$PWD"
npx hardhat --config hardhat.config.mjs test mocha test/contract-shielded-lineage-checkpoints.test.mjs
```

The first three scripts accept an optional repository root and output directory.
The Fund witness script requires the repository root. Generated circuits, WASM,
development keys, proofs and JSON reports go into new OS temporary directories by
default. No dependencies or production assets are downloaded or replaced.

Requirements: `node_modules`, `bin/circom`, `circuits/ptau/ppot_0080_17.ptau`;
legacy receive-code development WASM/zkey/vkey under `zk-artifacts/shielded`;
the existing Fund WASM under `frontend/public/zk/shielded`.

| Initial separate experiment | Evidence and limits |
| --- | --- |
| Legacy enumeration | A real legacy proof still identifies its matching candidate I after its explicit identity bytes are removed. This does not attack the new issuance circuit. |
| Anonymous issuance | Both key modes authenticate a secret-derived alias, owner/view keys, counter and expiry with I private. This does not check live state or execution time. |
| Private counter lookup | Real depth-8 SMT proofs keep alias/counter/path out of direct public signals and support holder-side refresh. Alias authentication is absent; a successful arbitrary-alias negative control demonstrates that gap. The public usage commitment needs a fresh high-entropy salt and operation binding in production. |
| Fund witnesses | Both key modes and first/refill witnesses still need I. These are constraint checks against the current artifact, not anonymous Fund proofs. |
| Existing checkpoint tests | Four production contract tests pass using a mock ZK verifier. The state script's separate eight JS policy assertions are only simulations. |

`202610210001` (alias) and `202610210002` (usage commitment) are research-only
domains, not assigned protocol constants. The alias is fixed across modes:

```text
R = Poseidon3(researchDomain, identityCommitment, derivedSecretField)
```

The new circuits use local development Groth16 setup and must never be deployed
with these generated keys. Missing identity fields in public signals are not a
formal privacy proof; public fixture salts do not establish semantic privacy or
unlinkability. Fixed aliases and fixed payment keys link codes. The initial
experiments above do not establish complete issuance/presentation/counter-update
integration. The composed experiments below record that component and the later
Fund/attachment stages separately, without claiming production integration.

## Subsequent composed P0 verification, 2026-10-21

`composition-go/` uses Go 1.26.8 and gnark v0.16.4 to verify the real issuance
Groth16 proof inside an outer Groth16 circuit. The issuer verification key is
fixed at compilation; the inner proof and all eleven issuer signals are private
outer witnesses. Native constraints connect the authenticated R, counter, keys
and expiry to a depth-8 SMT query and one operation. Its eleven public signals
are chain, consumer, action, message ID, two ciphertext-hash limbs, checkpoint ID,
state root, state time, authenticated expiry, and a randomized recipient/operation
binding. The consumer computes the ciphertext hash from actual calldata and
uses its actual chain, address and stored checkpoint.

`counter-update/` separately proves identity ownership, canonical R, old-state
membership/nonmembership and strict uint64 increment. `CompositionConsumer.sol`
accepts these real proofs for 0-to-1 and 1-to-2, requiring the live root and actual
chain/address. An unrelated account can relay the owner's proof. I and its
preimage remain private; the update's R and old/new counters are public.

| Evidence | Recorded result |
| --- | --- |
| Composed valid cases | Four real proofs verified: both key modes, refreshed path after unrelated update, and newly authenticated counter 1. |
| Proof mutation checks | All 44 public-signal mutations of those four proofs rejected. The initial run separately rejected 11 outer public mutations. |
| Invalid private witnesses | Actual prover constraint solving rejected revoked counter under the new root, wrong sibling, authenticated expiry mismatch, and zero randomizer; no invalid proof was produced. Eleven private issuer-signal mutations were separately rejected by constraints. |
| Owner counter update | Two real proofs; eight public-signal mutations rejected by the real verifier; nine witness checks, including one valid empty-tree insertion and eight invalid cases. |
| Isolated EDR contract | 28 check records with real Solidity verifiers, including gas recording. Actual ciphertext/message/context mutations, duplicate delivery, unauthorized update, stale write root, checkpoint recurrence, retirement at +899/+900 seconds, and strict expiry boundaries covered. |

The outer circuit has **1,358,171 constraints and 11 public signals** (gnark
reports 12 public variables including the constant one). Desktop Node/Go fixture
measurements: compilation 2.33 seconds, local setup 126.27 seconds, first proof
6.78 seconds, reused-setup proofs 6.19–6.38 seconds, and native verification about
1 ms. The exported Solidity proof is 384 bytes, including its commitment proof;
the proving key is 325,798,575 bytes (about 311 MiB). Recorded Go `HeapSys` is
3,603,234,816 bytes and cumulative `TotalAlloc` is 12,212,768,328 bytes; neither is
peak RSS. The synthetic accept transaction used **441,252 gas**, and the first
owner-authorized counter update used **326,569 gas**. These are local desktop/EDR
measurements, not browser, mobile or production gas guarantees.

This is still an isolated authentication experiment. The consumer retains
`fixtureOwner.advance()` to simulate unrelated root changes and recurrence; the
fixture owner can replace roots without a counter proof. Therefore this does
not establish a production state contract's security. The synthetic ciphertext
only exercises hash binding, not HPKE correctness, a real transfer, Fund, letter
delivery or Archive recovery. Depth 8 is a small fixture capacity; no privacy
audit, production setup ceremony, browser benchmark or scalability result is
claimed. Earlier generated manifest/report limitation strings saying no counter
update circuit exists predate its integration; the current evidence includes
the real owner-update entry point but retains the fixture-root limitation.

### Reproduce the composed experiment

Run from the repository root. In addition to the initial requirements, this needs
Go's pinned toolchain/modules and a local Solidity 0.8.28 binary. The first Go run
may download its pinned toolchain and modules. Outputs stay in a new temporary
directory; the isolated Hardhat config uses only local EDR and does not load the
production wallet/network configuration. Set `DEEPFAMILY_RESEARCH_SOLC` to the
local compiler path if the script's macOS Hardhat cache default does not apply.

```sh
export DEEPFAMILY_COMPOSITION_OUT="$(mktemp -d)"
node research/anonymous-receive-code/run-issuance.mjs "$PWD" "$DEEPFAMILY_COMPOSITION_OUT/issuance" 0
node research/anonymous-receive-code/prepare-composition.mjs "$DEEPFAMILY_COMPOSITION_OUT"

(
  cd research/anonymous-receive-code/composition-go
  GOTOOLCHAIN=go1.26.8 GOMAXPROCS=4 GOMEMLIMIT=5GiB go run . \
    --input-dir "$DEEPFAMILY_COMPOSITION_OUT/issuance" --mode 0 \
    --extras-json "$DEEPFAMILY_COMPOSITION_OUT/anonymous-mode-0.extras.json" \
    --poseidon-constants "$DEEPFAMILY_COMPOSITION_OUT/poseidon-constants.json" \
    --out-dir "$DEEPFAMILY_COMPOSITION_OUT/outer" --check-inner-tamper
  GOTOOLCHAIN=go1.26.8 GOMAXPROCS=4 GOMEMLIMIT=5GiB go run . \
    --reuse-setup "$DEEPFAMILY_COMPOSITION_OUT/outer" \
    --cases-json "$DEEPFAMILY_COMPOSITION_OUT/composition-inputs.json" \
    --poseidon-constants "$DEEPFAMILY_COMPOSITION_OUT/poseidon-constants.json" \
    --out-dir "$DEEPFAMILY_COMPOSITION_OUT/cases"
)

export DEEPFAMILY_COUNTER_UPDATE_OUT="$DEEPFAMILY_COMPOSITION_OUT/counter-update"
node research/anonymous-receive-code/counter-update/run.mjs "$PWD" \
  "$DEEPFAMILY_COMPOSITION_OUT/composition-inputs.json" "$DEEPFAMILY_COUNTER_UPDATE_OUT"
npx hardhat --config research/anonymous-receive-code/hardhat.config.mjs run --no-compile \
  research/anonymous-receive-code/verify-composition-contract.mjs
```

Evidence files are `outer/summary.json`, `cases/cases-summary.json`,
`counter-update/summary.json`, and `contract-results.json` in that temporary
directory. A local snapshot of the recorded run is
[composition-results.local.json](composition-results.local.json). The Chinese
[feasibility report](../../docs/anonymous-receive-code-feasibility.local.md)
distinguishes this progress from the initial separate prototypes.

## Fund and anonymous budget-attachment verification

The Fund prototype privately verifies a **twelve-signal, identity-disclosing
issuer proof**. The payer knows the authenticated I and can construct the
existing Fund witness; I, R and all issuer fields remain private in the outer
proof. The complete Fund R1CS is embedded as fixed native-field constraints,
including donor ownership, conservation, lineage on first funding, enrollment,
and the historical template on refill. It is not replaced with a client check.
The outer constraints require the authenticated I, owner and mode to match the
Fund relation, and join the authenticated expiry and private counter lookup.

The initial baseline established that composition against the unmodified Fund
relation. It **did not bind the budget's viewing key**: authenticating a view key
inside a credential does not put that key into the old budget commitment. The
subsequent research variant fixes this in copied, temporary circuits by extending
the existing budget authorization to
`Poseidon5(scopedAuthorizationTag, owner, mode, viewLo, viewHi)`, and giving
Fund-produced and Claim-produced private budgets separate fixed note domains.
It keeps two output leaves, independent random note nonces, the existing
identity/enrollment rules, and the same recovery secrets. Refill accepts either
historical producer domain while preserving the complete authorization.

An anonymous attachment proof reconstructs only a **Fund-domain private budget**
from its private opening and authenticated owner/mode/view, then proves note
membership. It binds the actual budget reference to the message relation without
requiring the code's I or R to equal the budget's identity. A positive fixture
uses another identity with the same independent receiving keys. A Claim budget
with the same opening cannot masquerade as a Fund output. The operation has 14
public fields: the previous eleven plus budget pool, budget root and relation.

**Budget association depends on the actual candidate set.** The first contract
run exposed a root containing just one Fund pair, so an observer could identify
its budget despite private commitment/path witnesses. Its 54 checks establish
authenticity and binding, not hidden association. The replacement now verifies
two distinct private Fund budgets through the same four-leaf public root after
two successful real Fund transactions. This establishes shared-root feasibility;
it does not ensure unconditional anonymity. Clients select a shared accepted
root. A single eligible budget, an earlier narrow historical root, transaction
timing or other context can still identify a budget. No anonymity threshold,
decoy requirement or extra registry is introduced, and no anonymity-set or
side-channel audit has been performed.

| Recorded stage | Real-proof and contract evidence |
| --- | --- |
| Baseline Fund composition | Four proofs, six invalid witnesses rejected by the actual prover, 152 public-input mutations rejected, twelve private issuer-field constraint rejections; 35 EDR contract checks. |
| Viewing-key-bound Fund variant | Six initial proofs covering both modes and first/refill from both proposed template domains, eight invalid witnesses, 228 public mutations, twelve private issuer-field constraint rejections; 43 initial EDR contract checks. An extra independent first Fund reuses the same setup and adds one real proof and 38 public mutation rejections. Four additional Circom witness negatives hold the historical root fixed while changing view and recomputing the new output. |
| Current shared-root anonymous attachments | Nine real proofs and 126 public mutations rejected; ten unique invalid witnesses, including wrong keys and Claim provenance with the attacker recomputing its relation, and depth/index/sibling normalization. All 19 cases run against shared-root witnesses. The same circuit/setup is reused. |
| Current two-Fund shared root → attachment → HPKE reference | 60 EDR checks. Two successful real Fund actions create a four-leaf shared root; two distinct budgets use that same public root in actual anonymous attachment transactions. Real HPKE confirms the reference, and a forged encrypted reference is suppressed after decryption. This proves the shared-root structure, not an unconditional anonymity guarantee. |
| Historical single-Fund-root → attachment → HPKE reference | 54 EDR checks. Only a successful real Fund proof creates the research source's accepted two-output root; an unregistered root is rejected. Actual anonymous transactions and HPKE decryption verify the encrypted reference. A deliberately forged encrypted reference has a valid proof but fails the post-decryption attachment check. The public root identifies one Fund, so this run does not establish hidden budget association. |
| Budget codec and key recovery | 47 checks using the actual production codec and HPKE with an isolated one-byte origin wrapper; four mode × producer samples recover recipient and donor packets. The independent mode uses the actual Argon2id → independent-root HKDF → HPKE derivation. Six existing proven Fund openings separately match the proposed commitment. |
| Proposed Claim relation | Ten real proofs using separately proven Fund commitments and internally generated, already-proven Claim continuations; 270 real-verifier public mutations and ten witness negatives. A deployed stateless Solidity verifier accepts the same ten proofs and rejects one changed public input per proof (20 EVM checks), establishing verifier compatibility rather than a live Claim entry point. |
| Archive bytecode storage primitive | 17 checks using the existing `_storeBlob`/`ArchiveData` and production `readArchiveBlob`, including actual HPKE ciphertext and the 16,384/16,385-byte segment boundary. This unprotected storage harness is not a letter registration entry point. |

| Desktop/EDR measurement | Baseline Fund | Viewing-key-bound Fund | Attachment |
| --- | --- | --- | --- |
| Constraints / public signals | 1,489,426 / 38 | 1,493,390 / 38 | 1,374,581 / 14 |
| Local setup | 135.28 s | 153.68 s | 157.38 s, reused for shared roots |
| Actual prover time | 6.54–6.82 s | 7.49–9.48 s (initial six) | 6.23–6.58 s (current shared roots) |
| Exported Solidity proof | 384 bytes | 384 bytes | 384 bytes |
| Successful transaction gas | 703,252–704,337 | 703,216–704,337 (initial consumer) | 476,877–476,949 (current shared root) |

The variant measurements overlapped other research processes and are not an
isolated performance comparison. They are desktop Node/Go and local EDR results,
not browser/mobile timings or production gas guarantees. The attachment proving
key is about 312 MiB; the shared-root run's `HeapSys` of 3,826,843,648 bytes is
retained Go heap space, not peak RSS. The initial single-Fund-root transactions
used 476,833–476,893 gas and remain historical evidence.

These tests still use fixture donor/template/lineage roots and a fixture-driven
counter state. No actual asset is held or funded. The attachment source appends
the two outputs of each successful real Fund and accepts the resulting roots;
the shared-root cases use two Funds. It is not the live
canonical factory/pool, its full sharded tree, or a production letters contract.
Its `knownFundRoots` mapping is research helper state. The proposed production
direction reuses the canonical pool's existing note tree and accepted-root
mechanism; the measured research contract must not be described as adding no
state. Earlier narrow roots remain accepted, matching existing canonical-root
semantics; choosing one can expose the budget. Tree size alone is insufficient
if only one leaf can be an eligible private Fund budget.
The Fund ciphertexts are synthetic 512-byte packets. Letter packets use real
HPKE, but the fixtures share a synthetic viewing key, so this does not establish
independent-key recovery UX for both modes. The proof authenticates the receiving
descriptor and ciphertext bytes; it does not prove the complete HPKE encryption
algorithm or plaintext contents. Encrypted budget references are checked after
decryption. The Claim-tag historical templates are commitment fixtures at this
stage; a successful Fund proof that reads one does not establish a real Claim
producer. The separate Claim experiment now proves the full proposed Claim
relation and its continuations, but these alternative branches do not form one
shared-ledger Fund/Claim/refill history. The separate codec experiment below validates packet recovery, while
production Claim/codec/recovery and authorized Archive integration, ordinary transfer
outputs/change bypasses, and a browser feasibility measurement remain separate
work. The isolated owner-update experiment above does not make
these fixture-driven Fund consumers into a production counter state contract.

### Reproduce Fund and attachment stages

Use the same dependencies, local ZK assets, pinned Go toolchain and local solc as
the composed experiment. All generated proof/circuit/setup artifacts remain in
temporary directories. The baseline is included to reproduce its historical
result; the attachment stage requires the viewing-key-bound variant.

```sh
export DEEPFAMILY_FUND_BASELINE_OUT="$(mktemp -d)"
node research/anonymous-receive-code/prepare-fund-composition.mjs \
  "$PWD" "$DEEPFAMILY_FUND_BASELINE_OUT"
(
  cd research/anonymous-receive-code/composition-go
  GOTOOLCHAIN=go1.26.8 GOMAXPROCS=4 GOMEMLIMIT=5GiB go run . \
    --fund-manifest "$DEEPFAMILY_FUND_BASELINE_OUT/fund-manifest.json" \
    --out-dir "$DEEPFAMILY_FUND_BASELINE_OUT/outer"
)
DEEPFAMILY_FUND_COMPOSITION_OUT="$DEEPFAMILY_FUND_BASELINE_OUT" \
  npx hardhat --config research/anonymous-receive-code/hardhat.config.mjs run --no-compile \
  research/anonymous-receive-code/verify-fund-composition-contract.mjs

export DEEPFAMILY_FUND_VIEW_OUT="$(mktemp -d)"
DEEPFAMILY_FUND_VIEW_BINDING=1 \
  node research/anonymous-receive-code/prepare-fund-composition.mjs \
  "$PWD" "$DEEPFAMILY_FUND_VIEW_OUT"
(
  cd research/anonymous-receive-code/composition-go
  GOTOOLCHAIN=go1.26.8 GOMAXPROCS=4 GOMEMLIMIT=5GiB go run . \
    --fund-manifest "$DEEPFAMILY_FUND_VIEW_OUT/fund-manifest.json" \
    --out-dir "$DEEPFAMILY_FUND_VIEW_OUT/outer"
)
DEEPFAMILY_FUND_COMPOSITION_OUT="$DEEPFAMILY_FUND_VIEW_OUT" \
  npx hardhat --config research/anonymous-receive-code/hardhat.config.mjs run --no-compile \
  research/anonymous-receive-code/verify-fund-composition-contract.mjs

export DEEPFAMILY_ATTACHMENT_OUT="$(mktemp -d)"
node research/anonymous-receive-code/prepare-attachment.mjs \
  "$PWD" "$DEEPFAMILY_FUND_VIEW_OUT" "$DEEPFAMILY_ATTACHMENT_OUT"
(
  cd research/anonymous-receive-code/composition-go
  GOTOOLCHAIN=go1.26.8 GOMAXPROCS=4 GOMEMLIMIT=5GiB go run . \
    --attachment-manifest "$DEEPFAMILY_ATTACHMENT_OUT/attachment-manifest.json" \
    --out-dir "$DEEPFAMILY_ATTACHMENT_OUT/outer"
)
npx hardhat --config research/anonymous-receive-code/hardhat.config.mjs run --no-compile \
  research/anonymous-receive-code/verify-attachment-contract.mjs

export DEEPFAMILY_BUDGET_RECOVERY_OUT="$(mktemp -d)"
node research/anonymous-receive-code/run-budget-view-recovery.mjs \
  "$PWD" "$DEEPFAMILY_FUND_VIEW_OUT/fund-manifest.json" "$DEEPFAMILY_BUDGET_RECOVERY_OUT"

export DEEPFAMILY_CLAIM_VIEW_OUT="$(mktemp -d)"
node research/anonymous-receive-code/claim-view/run.mjs \
  "$PWD" "$DEEPFAMILY_CLAIM_VIEW_OUT" "$DEEPFAMILY_FUND_VIEW_OUT/fund-manifest.json"
npx hardhat --config research/anonymous-receive-code/hardhat.config.mjs run --no-compile \
  research/anonymous-receive-code/claim-view/verify-contract.mjs
```

Each Fund directory contains `outer/summary.json`, `outer/cases-summary.json`,
`fund-manifest.json` (including the variant's four schema witness checks), and
`fund-contract-results.json`. The attachment directory contains its manifest,
outer summary/cases and `attachment-contract-results.json`. Pass
`--reuse-setup <the-existing-outer-directory>` to the corresponding Go command
to reuse its fixed local circuit/key; never reuse the baseline setup for the
variant or attachment circuit. The local
[business-results.local.json](business-results.local.json) snapshot preserves
the recorded JSON results, original temporary paths, hashes and limitations,
including the historical 54-check run, stronger supplemental negatives, current
shared-root results, the extra independent Fund, Claim and storage evidence.
The current generator includes the extra Fund automatically, so a fresh run has
seven view-bound Fund proofs and nineteen attachment cases. The recorded initial
43-check Fund consumer run used six proofs; the extra proof was separately
verified and then executed by the shared-root source. The Chinese
[binding research note](../../docs/attached-letters-binding-research.local.md)
explains the schema choice and its remaining validation boundary.

The recovery script outputs `results.json`. Recipient payloads are 284 bytes and
donor rule memos 460 bytes, including the proposed one-byte producer origin;
both fit the existing 461-byte HPKE payload and 512-byte ciphertext envelope.
The recipient reconstructs its viewing public key from its decryption context;
the donor memo already carries the original viewing key. No duplicate 32-byte
field or recovery secret is needed. Wrong view/origin, wrong key or chain AAD,
and ciphertext mutations fail the corresponding reconstruction/decryption checks.
The new recovery samples have actual HPKE packets but no Fund/Claim business
proof. The six separately checked proven openings still have the synthetic
Fund ciphertexts used in their business proofs. Wallet signing, recovery-word
UI, worker isolation, chain event fetching and a complete new-device flow are
outside this component test; the independent Argon2id profile remains a candidate
awaiting device benchmarks. Production codec version dispatch has not changed.

The [Claim experiment](claim-view/README.md) has 69,667 constraints and 27 public
signals, with the original ownership, lineage, maturity, value and nullifier
relations retained. Its local setup took 115.78 seconds and single-threaded
desktop proofs 11.28–11.92 seconds. Ten witness rejections cover both modes with
changed view/recomputed output against the same old root, different views across
two inputs, wrong origins, and nonboolean origin. The EVM verifier runtime is
5,425 bytes; `contract-results.json` records ten accepted existing proofs and ten
rejected mutations. It deploys only that stateless verifier: no actual Claim
entry point authenticates live roots, derives its chain/address, spends ledger
nullifiers, appends notes or moves assets. Its fixture ciphertexts are synthetic,
and the cases include mutually alternative histories. These ten EVM verifications
reuse the ten existing proofs and must not be counted as ten new proofs.

### Archive storage component

The isolated [storage harness](archive-storage/README.md) inherits the existing
Archive internal `_storeBlob`, without calling Story/NFT/personHash registration.
Actual `eth_getCode` and the production reader reconstruct every stored sample
byte for byte, validating hash, length, STOP prefixes and the existing DFBP
manifest. The restored 512-byte HPKE packet decrypts successfully.

| Stored bytes | Sample | Segments / manifest pages | Harness transaction gas |
| --- | --- | --- | --- |
| 512 | Actual HPKE | 1 / 0 | 170,759 |
| 16,384 | Synthetic boundary | 1 / 0 | 3,629,597 |
| 16,385 | Synthetic boundary | 2 / 1 | 3,724,295 |

To reproduce the HPKE sample and segment-boundary checks, run the storage
experiment from the repository root.

```sh
export DEEPFAMILY_ARCHIVE_STORAGE_OUT="$(mktemp -d)"
npx hardhat --config research/anonymous-receive-code/hardhat.config.mjs run --no-compile \
  research/anonymous-receive-code/archive-storage/run.mjs
```

The result is `results.json`. Gas includes calldata, data-contract creation
and this harness event, but excludes letter proof verification and production
records. It is not a total letter fee or a currency quote. The harness exposes
an unprotected `store` solely for measurement; a production letter entry point
must verify its proof/context before storing. No final long-letter format,
multiple manifest pages, chain discovery, provider durability or complete
new-device flow is established. Storage size, timing and sender stay public;
immutable bytecode does not provide anonymity.
