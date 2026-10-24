# Zero-Knowledge Proofs in DeepFamily

## Overview

DeepFamily has two frozen proof purposes:

| Purpose ordinal | Purpose             | Circuit source                       | Contract entrypoint    |
| --------------: | ------------------- | ------------------------------------ | ---------------------- |
|             `0` | `PersonRelation`    | `circuits/person_commitment.circom`  | `addPersonVersion`     |
|             `1` | `DisclosureBinding` | `circuits/disclosure_binding.circom` | `mintPersonVersionNFT` |

The purpose is fixed by the entrypoint; callers do not supply it. A caller supplies a `circuitId`
inside `ProofEnvelope`, and the contract resolves exactly
`verifierRegistry[purpose][circuitId]`. Routes are permanent once registered: the contract never
marks one as active/current, and registering a new ID does not disable an old one. An existing
person can keep adding versions with an older registered relation circuit that reproduces its
commitment; `personHash` carries no route-recency marker.

The current development manifest assigns circuit ID `1` independently to both purposes. The same
numeric ID may be used under different purposes because the full key is `(purpose,circuitId)`.

The shielded inheritance pool uses a separate set of action circuits. Version-1 receive credentials authenticate identity authorization counters and expiry through private presentation proofs. Fund and private transfers verify the presentation and business proof atomically; private letters use the same authorization state. These proofs do not use the DeepFamily `ProofEnvelope` route. See [private letters and receive authorization](private-letters.md) for the full flow and shared artifact workflow.

## Identity and Commitment Architecture

### Canonical identity

Full names are canonicalized before identity derivation using the checked-in Unicode 17.0.0
normalization tables, independent of the host browser or Node ICU version:

- Unicode NFKC;
- Unicode whitespace collapsed to one ASCII space;
- leading and trailing whitespace removed;
- the result must be nonempty and at most 256 UTF-8 bytes.

Passphrases follow a different rule: RFC 8265 OpaqueString over Unicode 17.0.0, no trim.

Preparation (Section 4.2.1) rejects any code point outside the PRECIS FreeformClass (RFC 8264
Section 4.3), derived from pinned UCD bytes by `scripts/generate-precis-data.mjs`. Controls such as
U+0009 and U+0000, Default_Ignorable code points such as U+00AD and U+FEFF, noncharacters,
unassigned code points and Old Hangul Jamo are all refused, because a code point that is invisible
or untypeable cannot be reproduced and the passphrase is not recoverable. CONTEXTJ and CONTEXTO
code points are admitted only when their RFC 5892 Appendix A rule confirms the surrounding context.

Enforcement (Section 4.2.2) then maps every General_Category Zs other than U+0020 to U+0020 and
applies NFC; there is no width or case mapping, so fullwidth forms and compatibility decompositions
survive. The Zs rule is narrower than the White_Space property used for names, so U+0085, U+2028
and U+2029 are not folded to a space — they are rejected outright during preparation.
The normalized result must satisfy the FreeformClass and contextual rules again (RFC 8264
Section 7): NFC can introduce a contextual code point or change its surrounding script. For
example, U+0387 becomes U+00B7 and is accepted only between two lowercase `l` characters.

The profile's nonempty-password rule is the one deliberate divergence: an empty passphrase is valid
and still executes Argon2id. Both suite definitions bind the exact SHA-256 of the generated
normalization tables and FreeformClass repertoire in the protocol release manifest.
`npm run test:protocol` checks both generated Unicode normalization and PRECIS
tables against hash-pinned official UCD sources, runs normalization conformance, and
executes the protocol tests. `npm test` includes these checks; the table checks
require access to the official source downloads.
Identity suite 1 derives its 16-byte deterministic salt from the suite ID, canonical name, and
packed birth/gender field. The file KDF uses the same user-entered passphrase with a different
password-input domain and a random 16-byte `fileSalt`.

The candidate suite-1 byte rules are:

```text
identityPassword = UTF8("DeepFamily:IdentityKDF:v1") || 0x00 || UTF8(OpaqueString(rawPassphrase))
filePassword     = UTF8("DeepFamily:FileKDF:v1")     || 0x00 || UTF8(OpaqueString(rawPassphrase))

identitySalt = first16(keccak256(solidityPacked(
  "deepfamily:identity-kdf-salt:v1", // string
  identitySuiteId,                    // uint32
  canonicalFullName,                  // string
  bytes32(packedBirthGenderField)     // left-zero-padded
)))
```

Both current suite-1 paths use Argon2id version `0x13`, `65,536 KiB` memory, 3 iterations,
parallelism 1, and a 32-byte output. These parameters remain a development candidate pending the
required device matrix and attacker-cost study; a release must freeze them without silently
reinterpreting suite ID 1.

### Domains and derivations

```text
DOMAIN_SUITE              = 1000
DOMAIN_NAME_SECRET        = 1001
DOMAIN_IDENTITY           = 1002
DOMAIN_DISCLOSURE         = 1003
DOMAIN_VERSION_COMMITMENT = 1004

namePrehash = keccak256(
  UTF8("deepfamily:name-prehash:v1") || UTF8(canonicalFullName)
)
nameField = uint256(namePrehash) mod BN254_SCALAR_FIELD

suiteCommitment = Poseidon4(DOMAIN_SUITE, identitySuiteId, 0, 0)

nameSecretCommitment = Poseidon4(
  DOMAIN_NAME_SECRET,
  nameField,
  derivedSecretField,
  suiteCommitment
)

packedBirthGenderField =
  (birthYear << 25) |
  (birthMonth << 17) |
  (birthDay << 9) |
  (gender << 1) |
  isBirthBC

identityCommitment = Poseidon4(
  DOMAIN_IDENTITY,
  nameSecretCommitment,
  packedBirthGenderField,
  suiteCommitment
)

personHash = keccak256(bytes32(identityCommitment))

disclosureBinding = Poseidon4(
  DOMAIN_DISCLOSURE,
  nameField,
  packedBirthGenderField,
  suiteCommitment
)
```

The bit layout is non-overlapping: `birthYear[25..40]`, `birthMonth[17..24]`,
`birthDay[9..16]`, `gender[1..8]`, and `isBirthBC[0]`.

For a person-version metadata object, the canonical client also computes:

```text
contentDigest = keccak256(canonicalJsonBytes)
contentDigestLo = low 128 bits of contentDigest
contentDigestHi = high 128 bits of contentDigest

versionCommitment = Poseidon4(
  DOMAIN_VERSION_COMMITMENT,
  derivedSecretField,
  contentDigestLo,
  contentDigestHi
)
```

`contentDigest` is private and never appears in calldata, events, `PersonVersion`, `MetadataRef`,
or the DFM1 envelope. The relation circuit proves that `versionCommitment` uses the exact same
`derivedSecretField` as the self identity commitment. It does **not** prove that the private digest
came from the plaintext encrypted in the envelope. The frontend therefore performs a complete
encrypt/decrypt round trip before wallet submission and recomputes the commitment after every
unlock. A valid witness holder can still deliberately create a self-consistent but semantically
false record; the contract cannot prevent that without proving the plaintext/encryption relation.

## PersonRelation Circuit

### Statement

The circuit proves one complete relation statement: the current person's identity commitment, the
optional father and mother identity commitments, the submitter/self-suite binding, and a keyed
version commitment. `circuitId` selects the verifier for this whole statement; it does not select a
different verifier per parent and is not an identity-suite ID.

### Private inputs

Each role has its own identity inputs:

```text
nameField, derivedSecretField,
isBirthBC, birthYear, birthMonth, birthDay, gender,
roleSuiteId
```

The self role uses `selfSuiteId`; father and mother use `fatherSuiteId` and `motherSuiteId`.
`contentDigestLo` and `contentDigestHi` are also private. Parent presence is controlled by private
boolean `hasFather` / `hasMother`; all identity inputs and the suite ID of a null parent must be
zero. A present parent's suite ID and resulting identity commitment must be nonzero.

The circuit constrains:

- every role suite ID to 32 bits;
- `selfSuiteId` to nonzero;
- `submitter` to 160 bits;
- `contentDigestLo` and `contentDigestHi` to 128 bits each;
- identity birth/gender fields to their declared widths and month to at most 12;
- `hasFather` and `hasMother` to boolean values.

### Public signals

The order is a frozen entrypoint ABI:

```text
[
  identityCommitment,
  fatherIdentityCommitment,
  motherIdentityCommitment,
  submitterAndSelfSuiteId,
  versionCommitment
]
```

The fourth signal is exactly:

```text
submitterAndSelfSuiteId = uint160(submitter) + uint32(selfSuiteId) * 2^160
```

It is at most 192 bits and therefore has no BN254 field-reduction ambiguity. `DeepFamily` compares
the low 160 bits to `msg.sender` and the next 32 bits to the nonzero big-endian self suite read from
DFM1 common-prefix bytes `0x10..0x13`; bits above 191 must be zero because the contract compares the
whole value with the constructed expected value. Father and mother suite IDs remain private and
are not written to the child's envelope or to a person-level mapping.

### Contract flow

```solidity
struct PersonProofPublicSignals {
  uint256 identityCommitment;
  uint256 fatherIdentityCommitment;
  uint256 motherIdentityCommitment;
  uint256 submitterAndSelfSuiteId;
  uint256 versionCommitment;
}

function addPersonVersion(
  ProofEnvelope calldata proof,
  PersonProofPublicSignals calldata publicSignals,
  uint256 fatherVersionIndex,
  uint256 motherVersionIndex,
  bytes calldata metadataEnvelope
) external;
```

Before proof verification, the contract requires the envelope to be at least 20 bytes, checks
`DFM1`, checks a nonzero `formatVersion`, reads a nonzero big-endian self suite at the fixed offset,
and compares it with the packed signal and caller. It intentionally does not parse format-1
selectors, header length, salts, IVs, ciphertext, tags, gzip, or JSON.

After proof verification, the contract wraps each nonzero identity commitment with Keccak to obtain
the person/parent hashes, checks parent-version references, rejects a duplicate context-scoped
`versionHash`, creates `PersonVersion`, and asks the single bound Archive to store the exact
envelope in the same transaction.

The duplicate key is:

```text
versionHash = keccak256(abi.encode(
  keccak256("DeepFamily:VersionHash:v1"),
  personHash,
  fatherHash,
  fatherVersionIndex,
  motherHash,
  motherVersionIndex,
  versionCommitment
))
```

Random file salt, DEK, and IV changes do not change a canonical client's `versionCommitment`.
Changing any canonical metadata byte, including `tag` or `biography`, does.

## DisclosureBinding Circuit

### Statement and inputs

The mint circuit proves knowledge of the identity witness while binding the intentionally public
NFT supplement fields to that identity. Its private inputs are:

```text
nameField
derivedSecretField
packedBirthGenderField
selfSuiteId
```

`minter` is an input constrained to 160 bits and exposed unchanged as `minterOut`. `selfSuiteId` is
constrained to a nonzero 32-bit value. The circuit derives one `suiteCommitment` from that private
ID and uses the same value in `identityCommitment` and `disclosureBinding`.

### Public signals

```text
[
  identityCommitment,
  disclosureBinding,
  minter,
  suiteCommitment
]
```

The frontend obtains `selfSuiteId` by reading and strictly preflighting the target version's DFM1
envelope. The Mint contract does not read or interpret that header. It consumes the proof's public
`suiteCommitment`, recomputes the disclosure binding from the canonical public full name and
birth/gender calldata, requires `minter == msg.sender`, and derives the target `personHash` from the
public identity commitment.

Private encrypted `biography` is not a mint public signal and is not automatically copied into the
NFT. The mint biography record, token URI, and appended DFS1 story records are separate
intentionally public NFT data.

## Shielded inheritance circuits

The pool protocol, note payload, money HPKE envelope, receive credentials and private-letter envelope all use version 1. Each format has its own purpose and cryptographic domain. Exact layouts and operation authorization are specified in [Shielded inheritance contracts](contracts.md#shielded-inheritance-contracts) and [private letters](private-letters.md).

`shielded_anonymous_receive_credential.circom` and `shielded_fund_receive_credential.circom` authenticate the canonical identity and R from the original identity secrets, counter, expiry, owner, viewing-key limbs, mode and suite metadata with 11/12 public signals. Only the Fund disclosure publishes identity to its holder. The fixed issuer keys differ. `shielded_identity_authorization_update.circom` proves owner authority for an exact counter increment with six public signals: `[authNullifier, chainId, consumer, aliasR, oldCounter, newCounter]`. It has no SMT, root or path inputs; the state contract checks the live counter and computes the actual dictionary update. `prepareShieldedIdentityCounterAuthorization` is the sole owner-proof preparation API; the old global-tree transition APIs are removed. Its development proving key, verification key and Solidity verifier have been regenerated for this statement. The three `shielded_*_receive_presentation.circom` circuits check current counter membership/nonmembership and operation context; attachments also prove 32-level Fund-note membership. LinkG16 links the issuer and presentation proofs over the same hidden credential fields and rerandomizes them before submission. No circuit recursively verifies another proof or evaluates pairing arithmetic. Identity preimages, canonical alias derivation and key ownership remain constrained by the issuer.

Authorization reads, presentations and on-chain counter updates support full depth-64 paths. An owner authorization does not depend on that depth. Distinct authorization aliases with identical low 64 bits still exceed the dictionary's path capacity; insertion rejects without changing the current state. This capacity boundary is separate from the removed update-proof depth restriction.

The five business circuits cover shield, fund, claim, privateTransfer and unshield. Fund and PrivateTransfer append two randomized receive commitments to their public statements, giving 29 and 20 signals; Claim uses 15. Each required receipt is checked atomically by the pool against the same commitment. Zero commitments are permitted only for circuit-proven own outputs (or public identity funding). The shielded Circom catalog has eleven sets: five business actions, two credential issuers, three presentations and the owner update. With the two identity/disclosure circuits, the complete catalog has thirteen circuits.

The presentation's credential fields are public inputs only to the local Groth16 prover. The linked transport hides them; raw presentation proofs and their common input prefix must never be submitted on chain. Fixed Solidity verifiers bind both verification keys and the shared hidden inputs. `linkKeys` in the shielded manifest pins `shielded/receive-link-keys.json`, the verifier base and all three generated verifiers. First use requires no recipient registration or transaction; creation and payment read the latest chain authorization state.

Artifact and production ceremony checks independently reconstruct the linker bundle and all three fixed verifiers from private zkey snapshots, including public verification-key export and gamma/delta validation, then compare the generated files byte for byte. They recheck the original inputs and snapshots before accepting the result. The synchronous runtime inspector checks manifest consistency only; it does not provide this independent derivation evidence.

Before preparing consolidation spends, the asset Worker checks the final receive code's operation, expiry and current authorization counter against an authenticated state witness. It refreshes those checks before proving each step and again after a consolidation proof, while final payments retain their receive presentation checks. Authorization reads keep the user's selected local replay or chain mode. Revocation or expiry can still occur between the last check and transaction inclusion.

Each pool action computes `D = Poseidon3(1031, chainId, uint160(poolAddress))` once through `ShieldedPoolDomain`, including nonzero uint64/uint160 checks. Pool-specific hashes use `S(purpose) = Poseidon3(1032, D, purpose)` for purposes 1010, 1011, 1014–1017, 1019, 1021, 1026–1030 and 1033. Commitments, owner authorization, spend/period/enrollment/template-use nullifiers and allocation-key commitments require the same explicit scope as donor memo recovery. Notes, budget templates and claim markers cannot cross asset pools; identity, lineage and owner/view derivation remain independent of the scope.

Fund reuses its donor's constrained VALUE tag for change. Fund and claim compute the private/identity budget tags once per action; each budget component selects the tag and owner/terms field using its constrained boolean binding kind. This adds no public signals and keeps claim's binding selectors private. Purpose tags retain the same hash formulas.

`ShieldedMerkleRoot(MAX_DEPTH)` wraps `BinaryMerkleRoot` from exactly `@zk-kit/binary-merkle-root.circom@2.0.0` for the 32-level note trees and 64-level lineage trees. The project wrapper statically restricts `MAX_DEPTH` to 32 or 64 and unconditionally checks the depth's bit width and `depth <= MAX_DEPTH`, including disabled membership slots. The library constrains the index to `MAX_DEPTH` bits and computes the path with the same circomlib Poseidon ordering and compact path semantics. The bare library does not reject an excessive depth, so the wrapper's bounds must remain. Required root equality, conditional memberships and unused-slot normalization remain at their call sites. The Merkle wrapper preserves compact-path roots and does not itself change commitment/nullifier formulas. Current shielded proving/verification keys, browser artifacts, Solidity verifiers and manifests must match the complete circuit statements, including mode-bound owner authorization and receive-code version checks; future circuit changes require regenerating the matching artifacts.

Circuit quality takes precedence over constraint counts: interfaces must make their trust assumptions clear, security bounds must remain explicit, and tests must check protocol semantics independently. `ShieldedBudgetNoteTags` owns the private-budget, identity-budget and owner-authorization purpose tags so fund, claim and their test harness share one definition. Merkle tests compare every legal depth against independently computed JS Poseidon roots, with separate direction, invalid-witness and disabled-slot cases. Pinning the dependency does not replace the project's bounds or regression tests; any library upgrade requires another review and regenerated artifacts. The library's core has related historical PSE review evidence, but that does not constitute a complete audit of version 2.0.0, this wrapper or the protocol.

Before the receive-credential and view-bound-budget changes, the pinned compiler produced 2,006 constraints for shield, 57,700 for Fund, 68,714 for Claim, 75,070 for PrivateTransfer and 75,357 for Unshield. These are historical counts; current circuit artifacts and manifests define the implemented statements. The power-17 Phase-1 file remains pinned.

The following historical experiment predates the switch back to the fixed library. On 2026-10-04, the second optimization round (budget-tag reuse plus the project-owned Merkle selector) was compared with the preceding shared-domain implementation on macOS, Node v26.9.0 and snarkjs 0.7.5. It did not isolate the Merkle change. Each variant received one warmup and five alternating measured runs in fresh Node CLI processes. `groth16 fullprove` timing includes witness calculation and proving; proof verification runs separately. The fund fixture creates an initial private budget; claim uses 12 periods and a second identity-bound budget. Every proof verified and every public signal matched between variants.

| Circuit | Median fullprove, first → second round | Median peak RSS, first → second round | zkey bytes, first → second round |
| ------- | -------------------------------------- | ------------------------------------- | -------------------------------- |
| fund    | 2.164 s → 2.108 s                      | 1,373.94 MiB → 1,374.70 MiB           | 35,834,726 → 35,482,066          |
| claim   | 2.741 s → 2.831 s                      | 1,821.02 MiB → 1,819.98 MiB           | 51,855,886 → 51,501,838          |

The FFT domains were unchanged. These small historical samples showed reduced constraints and key sizes, but did not establish a consistent proving-time or memory improvement. A later isolated comparison, holding all other current circuitry constant, likewise did not detect a stable browser proving-time difference between the library and project-owned Merkle implementations. CLI process measurements do not establish browser or mobile performance. The library choice is based on reviewability and maintenance responsibility; the unconditional project bounds and full protocol regressions remain necessary.

Public and private funding share `shield → donor VALUE → fund → child BUDGET → claim → child VALUE`. Initial/continuation `fundMode` is separate from budget kind and key mode. The UI labels Public budget, Private (identity credentials) and Private (independent key) correspond to `(budgetKind, keyMode)` values `(1,0)`, `(0,0)` and `(0,1)`, respectively; the recovered summary's `bindingKind` matches `budgetKind`. Public initial funding needs only the child's `personHash`, publishes ten canonical recovery fields and implicitly fixes the identity-derived owner. Private initial funding and refills verify matching Fund credentials and on-chain receive presentations and publishes ten zeros. All entries prove donor ownership, conservation and the same identity/P-based initial-enrollment nullifier. A continuation preserves binding, mode, private owner, P/E, period and start; cross-structure or mode conversion is rejected.

The two private entries use the same owner-bound BUDGET format and HPKE encryption. They differ in key derivation and authorization: identity credentials reconstruct mode-0 keys, while mode 1 uses separate Spend/View branches derived from the independent key root and requires their owner secret alongside the identity proof. The independent-key entry keeps the same identity and lineage requirements for claims.

Private kind-2 budgets are 284 bytes and authenticate owner, mode and complete viewing key with Poseidon5, plus distinct Fund/Claim origin tags. The two producer domains prevent a Claim continuation from masquerading as an original Fund attachment. Public kind-5 budgets retain the 218-byte identity/terms structure and implicit mode 0. Private donor memo payloads are 428/460 bytes without/with allocation key; public memos remain 400/432 bytes. Recovery reconstructs the producer-specific commitment and retains complete receiving keys.

`claim` spends exactly one budget note. Each claim is bounded by that note's remaining balance; separate budgets require separate claims. It proves the identity, lineage from one accepted checkpoint, one to three mature unpaid periods and the authorized owner secret. Mode 0 requires the identity-derived secret; mode 1 requires the independent key secret with no identity fallback. Owner-bound budgets require their rule openings; identity budgets do not. The remainder preserves binding/mode and the VALUE payout preserves the authorized owner; VALUE has no persistent keyMode. All 15 public signals exclude the private input identity, binding and mode. Period nullifiers remain `H(identitySecret, P, epoch, scope)` across entries and exclude owner/mode/root source. This prevents allowance resets but permits a funder knowing the complete identity secret and P to precompute real period markers and associate claims with epochs without knowing the independent key root.

Initial Fund and Claim include `lineageCheckpointId` in transaction data. The index authenticates its root pair and requires the proof-bound `asOf` to fall between checkpoint creation and retirement (inclusive). Retired checkpoints expire strictly 15 minutes after retirement, regardless of later writes or recurring roots. The ID is lookup metadata, not another circuit input: roots and `asOf` already bind the statement. The two-hour proof freshness and initial eligibility delay are unchanged. This gives an explicit maximum 15-minute qualification-revocation delay; independent historical roots are never combined.

`ShieldedPoolCore` maintains 32-level note shards and secret-derived spend/period nullifiers. The lineage trees remain 64 levels deep. `privateTransfer` and `unshield` each have one circuit supporting one to four real inputs. Every real VALUE input has a positive uint128 amount and the same owner, chain and pool. Four-slot enabled inputs are contiguous; disabled private openings are zero, their public shard/root repeat slot zero, and their slot-specific dummy nullifiers are distinct. The real spend nullifier remains derived from the owner secret and note commitment. Input sums use 130 bits; each of the two outputs remains uint128, and unshield has one change output plus a zero dummy. Different public roots reveal multiple real inputs, while equal roots do not determine the count. `unshield` exposes its recipient and amount. Public budget facts cannot be made secret again, and proof shapes do not prevent timing, wallet or small-set correlation.

`npm run zk:setup` prepares the final keys and single-operator ceremony evidence for all thirteen Circom sets, then synchronizes their artifacts and derives the matching receive-link parameters and fixed verifiers. Local development, CI and release share this artifact set. Presentation circuits use the same shielded manifest as the other shielded circuits; the complete catalog uses one setup workflow.

The first setup validates manifest and toolchain pins, records the reviewed clean-commit sources,
and establishes a fresh compiled baseline. Earlier development proving files and their old
source/R1CS/WASM hashes are not required. Review the complete generated final bundle before
committing it. Runtime-only rotation and later release checks retain strict comparisons with the
reviewed final manifest and artifacts.

Daily `zk:build`, `zk:assets:fetch` and check commands reuse the pinned keys. A fresh checkout downloads the matching proving files; stale circuit sources or unavailable keys stop local deployment. Generating replacement keys requires an explicit `npm run zk:setup` for the complete catalog from a clean, reviewed commit on a controlled machine outside CI.

## Proof Transport and Permanent Routing

```solidity
struct ProofEnvelope {
  uint32 circuitId;
  uint8 proofEncodingId;
  bytes proofData;
}
```

- `circuitId` identifies the exact circuit/statement registered for the entrypoint's fixed purpose.
- `proofEncodingId` describes only how `proofData` is encoded. Encoding `1` is
  `abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c)`, exactly 256 bytes.
- The adapter validates encoding and public-signal length and calls the generated verifier. It must
  not interpret business fields or read DeepFamily state.
- `setCircuitVerifier(purpose,circuitId,adapter)` rejects ID zero, zero/no-code adapters, and any
  already populated route. There is no replace, clear, active, or latest operation.
- Within a deployed protocol generation, existing and new IDs under the same purpose may coexist
  indefinitely, provided each keeps that purpose's frozen public-signal ABI. Changing the signal
  count or order of a published deployment requires a new purpose/entrypoint and protocol
  generation; it cannot be installed behind an old route contract ABI. Before initial publication,
  the contracts, circuits, verifiers, artifacts and client can instead be replaced together and
  redeployed with the new ABI. The current unpublished fund protocol uses purpose 3 with 29 signals
  and does not retain the previous development ABI.
- A `circuitId` is not stored in `PersonVersion`, included in `personHash`, or used to infer any
  identity suite. Callers choose the route needed for each operation.

Current generated verifiers are:

- `contracts/PersonCommitmentVerifier.sol` for 5 person-relation public signals;
- `contracts/DisclosureBindingVerifier.sol` for 4 disclosure public signals;
- five shielded verifier routes, with 7 to 29 public signals.

These seven verifiers share one `contracts/adapters/Groth16VerifierAdapter.sol` instance. The
adapter accepts the same encoding-1, 256-byte ABC payload and routes purposes 0/1 to identity
and disclosure, and purposes 2–6 to the five pool actions (pool action ID + 2). Transfer and
withdrawal each have 20 public signals. Each route fixes
its verifier address and checks its expected public-signal length. The action is not a public
signal: the pool picks the purpose for its action, and the adapter handles proof transport only.

## Frontend and Shared Definitions

Cross-runtime definitions are owned by `packages/protocol-core/`:

- `proofDefinitions.js` maps purpose to circuit ID, encoding, and artifact descriptor, plus the
  person and disclosure proof definitions;
- `publicSignalSpecs.js` freezes field names, order, bit widths, and lengths, including
  their corresponding public-signal layouts;
- `proofEnvelopeCodec.js` normalizes snarkjs points and builds `ProofEnvelope`.

Browser artifact descriptors live in `frontend/src/shared/zk/proofDescriptors.ts`; Node descriptors
live in `lib/proofDescriptors.js`. Both consume the same protocol-core definitions. Runtime artifacts
are published under `frontend/public/zk/`:

- `person_commitment.wasm`, `person_commitment_final.zkey`, `person_commitment.vkey.json`;
- `disclosure_binding.wasm`, `disclosure_binding_final.zkey`,
  `disclosure_binding.vkey.json`;
- eleven shielded WASM/zkey/vkey sets under `shielded/`, including the three presentations;
- one shared `shielded/receive-link-keys.json` containing public linking parameters.

Presentation WASM/zkey downloads are 14,216,109 bytes (13.56 MiB) for anonymous
receipts, 14,355,369 bytes (13.69 MiB) for Fund, or 21,993,051 bytes (20.97 MiB) for
attachments; the link-key file adds roughly 26 KiB shared across kinds. Browsers
load the needed presentation and do not download R1CS files or a separate prover
runtime. Linked proofs are 1,184 bytes for anonymous/attachment or 1,216 bytes for
Fund. Their public signals are separate: eleven for anonymous/Fund and fourteen
for attachments. Transaction data and ciphertext are additional.

The final shielded artifacts use the same `/zk/shielded/` URLs in every environment and are installed in
`frontend/public/zk/shielded/` by `zk:setup` with the manifest recording their ceremony evidence. Only the
verification-key metadata is committed. The WASM/zkey files are pinned by the manifests' `wasmSha256`
and `zkeySha256` and hosted on R2 at `<VITE_ZK_ASSET_BASE_URL>/<sha256>/<file name>`:
`zk:assets:publish` uploads new files and `zk:assets:fetch` installs them in a checkout. The Vite
dev server serves the local copies; builds fetch from R2 and reject any file whose SHA-256 differs
from the manifest digest embedded at build time. The unified `zk:check` rebuilds all thirteen
circuits and checks artifact digests, shared linking parameters, derived verifiers, current
proofs and available Circom ceremony evidence. It uses the same pinned artifact set in every
environment; `release:preflight` also requires the other release evidence.

Shielded witnesses are assembled locally by the `shielded*Preparation` services, using
`packages/protocol-core/shielded-inheritance.js` and replayed public note and lineage events.

Proof generation and KDF work execute in dedicated Workers. Worker messages and long-lived caches
must never retain raw passphrases, salts, derived secrets, content digests, or witnesses after the
operation freezes its non-sensitive submission package.

## Optional gas reports

Gas reports are maintenance diagnostics and are not part of the normal command list:

```sh
LINEAGE_GAS_REPORT=1 npx hardhat --config hardhat.config.mjs --build-profile production --gas-stats test mocha test/contract-lineage-gas.test.mjs
SHIELDED_FULL_DEPTH_GAS_REPORT=1 npx hardhat --config hardhat.config.mjs --build-profile production test mocha test/contract-shielded-pool-core.test.mjs
```

Both use Hardhat's in-process chain. The lineage person-version case uses a verifier
stub; synthetic deep-tree updates measure gas without constructing billions of leaves.
They do not establish proof correctness or a live network's transaction limit. The
actual 64/32-depth proof check runs in `npm test`.

## Development and Release Workflow

Supported top-level commands:

| Command                        | Purpose                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `npm run zk:fetch`             | Install the pinned Circom toolchain                      |
| `npm run zk:build`             | Compile all 13 Circom circuits                           |
| `npm run zk:setup`             | Generate final artifacts and evidence for all 13 circuits |
| `npm run zk:check`             | Rebuild and check artifacts, proofs and available ceremony evidence |

The shared build, setup and checking commands cover identity, disclosure and all eleven
shielded circuits, including the three receive presentations. `npm test` runs the real receive
contract chain in both key modes and the complete 64/32-depth business proof; it
fails when required proving artifacts are missing or do not match their manifests.
`npm run test:circuits` separately compiles current shielded sources into temporary directories
and checks their constraints without proving keys, Powers of Tau, or browser artifacts. It is
included in `npm run check` and runs in an independent CI job. Negative witnesses must trigger
a Circom constraint assertion; malformed inputs and runtime failures fail the test instead.
`zk:check` first rebuilds all thirteen circuits and compares their artifacts with the pinned
manifests and derived verifiers. It proves the identity and disclosure fixtures, checks all eleven
shielded artifact sets and available Fund/Claim fixtures, and exercises linked receive proofs.
It also verifies recorded ceremony evidence and the matching link-key/verifier bindings.
Release preflight additionally requires finalized ceremony evidence, independent audits,
runtime benchmarks and deployment acceptance evidence. Development keys cannot be used for a
production release.

The checked-in keys and current protocol release manifest are development-only. The manifest marks
identity/file KDF suite 1 as `candidate-awaiting-device-benchmark`, trusted setup as requiring a
fresh v1 ceremony, and deployments as absent. Do not describe the protocol as production-frozen
until device benchmarks, attacker-cost analysis, a fresh reviewed setup, artifact hashes, golden
vectors, and deployment/runtime evidence have all been recorded and the release gates pass.

`zk:setup` uses the pinned public Phase-1 pTau installed locally at
`circuits/ptau/ppot_0080_17.ptau` or the file selected by `ZK_PTAU_PATH` and records the final
single-operator ceremony. Setup and verification check the pinned pTau hashes before use and do
not download it. Install it explicitly with `npm run zk:ptau:fetch`.

After all circuits and KDF profiles are frozen, the single
`npm run zk:setup` prepares the complete thirteen-circuit bundle and
matching link parameters. Review and commit its outputs before running the release
gates below; setup alone does not supply audit, benchmark or deployment evidence:

```bash
npm run zk:check
npm run release:preflight
```

See [zk-ceremony.md](zk-ceremony.md) for compiler provenance, contribution handling, artifact
installation, and optional multi-party setup details.

## Versioning Rules

- Identity and file KDF suite IDs are append-only. A published ID's normalization, domains, salt
  derivation, Argon2 parameters, and field encoding must never be reinterpreted.
- A new identity suite normally creates a new `personHash`; relation proofs can mix self and parent
  suites because each role has its own private suite ID.
- If a new suite keeps the same circuit mathematics, it can use an existing compatible route. If
  packing or circuit mathematics changes, register a new `circuitId`; do not disable the old one.
- File-KDF parameter upgrades may append a selector within a compatible envelope format. A new
  cipher, KDF algorithm, or incompatible envelope layout needs a new nonzero `formatVersion` while
  preserving the 20-byte common prefix if it is to use the same DeepFamily entrypoint.
- A public-signal ABI change on a published deployment requires a new purpose/entrypoint and
  protocol generation. Unpublished development deployments follow the complete-replacement rule
  described above.

## Security Properties and Limits

- Private identity witnesses, parent suite IDs, and plaintext digest limbs remain off-chain.
- Submitter/minter binding prevents an observer from replaying a proof as a different caller.
- Per-role suite commitments prevent a mixed-suite parent from being interpreted using the child's
  suite.
- `versionCommitment` is a deterministic keyed commitment for duplicate detection and post-decrypt
  consistency; it is not encryption and does not hide equality after the passphrase is known.
- The contract validates the DFM1 common prefix and self-suite byte binding, not format-1
  cryptography or plaintext. Unknown or malicious envelopes can be archived and must fail closed in
  clients.
- Format-1 AES-GCM AAD binds chain ID, DeepFamily proxy, person and parent references,
  `versionCommitment`, self identity suite, and the format selectors. This is a client-verifiable
  context binding, not a contract-level global replay prohibition.
- A stronger new KDF does not retroactively protect an old weak envelope that used the same
  passphrase; an attacker can use the cheapest available oracle.
- Every circuit, public-signal spec, verifier, adapter, artifact descriptor, release manifest, and
  documentation update must land together. A mismatch normally manifests as proof rejection,
  incorrect parent linkage, or failed mint disclosure binding.
