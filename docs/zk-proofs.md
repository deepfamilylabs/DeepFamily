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

Asset pools and receiving use fixed action verifiers outside the DeepFamily `ProofEnvelope`
route. `ReceiveRegistry` authenticates generic code authorization and optional family budget
capabilities; `depositBudget` combines those proofs with the payer's money proof and current role
status. Transfers and letters use the same generic code without a family capability. There are
no identity authorization counters or linked presentation proofs. See [receiving codes and
letters](private-letters.md) for the flow and artifact workflow.

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

## Receiving and budget circuits

There are 13 canonical relations: PersonRelation, DisclosureBinding, Shield, Unshield, four-input Unshield, source fact, source trust, qualification issuance, receive code, budget capability, budget deposit, budget claim and transfer.

The source relations authenticate actual lineage roots and hidden revocation-role openings. Issuance authenticates the same underlying subject as the identity circuit. The code relation independently binds its owner/viewing key, expiry, nonce and revocation tag. A capability proves that this code belongs to a qualified subject and hidden family rule without revealing the qualification opening.

Deposit and transfer witnesses contain the payer's spending material plus public code/rule data. They do not require the recipient's identity secret, code secret or qualification opening. A future policy can therefore be used while the recipient is offline. Qualification revocation and code expiry are checked against current on-chain state when funds are deposited or added. Claims authenticate current qualification and share their subject/policy/period nullifier across independently generated codes.

| Relation            | Circuit                    | Public signals |
| ------------------- | -------------------------- | -------------: |
| PersonRelation      | `person_commitment`        |              5 |
| DisclosureBinding   | `disclosure_binding`       |              4 |
| Source fact         | `eligibility_source_fact`  |             10 |
| Source trust        | `eligibility_source_trust` |              8 |
| Issuance            | `eligibility_issue`        |              5 |
| Code                | `receive_code`             |             10 |
| Capability          | `budget_capability`        |             10 |
| Deposit             | `budget_deposit`           |             20 |
| Claim               | `budget_claim`             |             23 |
| Transfer            | `value_transfer`           |             12 |
| Shield              | `shielded_shield`          |              7 |
| Unshield            | `shielded_unshield`        |             11 |
| Four-input Unshield | `shielded_unshield_4`      |             20 |

SourceFact and SourceTrust authenticate actual current lineage paths and publish salted source
leaves. Issue proves membership in both source trees and registers a qualification Q. Capability
proves Q membership, the same subject as the code, and a code-specific family tag and shared role status indices. Deposit
proves the payer's funds and the future rule against that capability; Claim proves current Q,
the budget-note spend, maturity and allowance. Shield/Unshield are the public asset boundaries,
and ValueTransfer uses the generic code without requiring Q.

Historical Q roots certify issuance; they do not grant a grace period after role revocation.
Every `depositBudget` call, including an additional contribution, and every `claimBudget` call
checks the three latest Source role states directly. Capability and Claim publish
`Poseidon2(74321 + role, roleSecret)` and constrain it to the same hidden role secret inside Q.
A payer cannot substitute another currently active index without invalidating the proof.
The distinct source-registration domain is `74201 + role`; reusing that identity-associated
commitment as the public status index is prohibited by this protocol.

Authorized revocation marks the role-index mapping. Each status query reads one mapping slot,
independent of the number of historical revocations. The audit log is not part of business
validation. There is no history proof, per-code progress or preparation transaction. A target
revocation committed after business-proof generation still rejects the transaction immediately.

## Proof transport

Each Groth16 ABC proof uses 256 bytes. Identity/disclosure have a dedicated adapter; asset boundaries have their own adapter. Receiving relations each use a fixed generated verification key and arity through `FixedGroth16Verifier`. No linked presentation proofs, identity counters or alternative receive issuers are accepted.

Frontend proof keys come from trusted build configuration, never from a scanned code. The prover verifies exact expected public signals and the proof locally before submission. Contracts independently verify their public signals and current qualification status.

Receiving and boundary pins are exported into `frontend/src/proof-artifacts.local.json`, with
local browser files under `/zk/protocol/`. A remote build resolves WASM/zkey to
`<VITE_ZK_ASSET_BASE_URL>/<sha256>/<file name>.br` and checks the decoded file hash; vkeys keep
their local pinned URLs. A supplied code cannot override the host, hashes or verification key.

## Development and release

`npm run zk:build` compiles the canonical 13 relations without replacing keys. Explicit `npm run
zk:setup` compiles the full graph, verifies and reuses matching identity/disclosure keys, and
regenerates development keys for the eight receiving and three boundary relations. It updates their
development manifests, vkeys and Solidity verifiers; local contracts and frontend pins must be
synchronized with that bundle. `npm run zk:check -- --artifacts-only` checks all 13 artifact sets
without regeneration. After local deployment, `npm run zk:frontend -- <chainId> <registry>`
synchronizes boundary aliases and exports a chain/registry-bound frontend bundle. `zk:setup --
--circuit protocol:code` or `--circuit shielded:unshield4` selects a current relation, and `--ptau
<path>` selects the local Phase 1 file. Focused generation still ends with a check of the complete
13-relation bundle.

`npm run test:circuits` checks current constraints. `npm run zk:check -- --circuit protocol`
generates all eight receiving proofs and rejects changes to every public coordinate. `npm test --
test/protocol-real-evm.test.mjs` combines real proofs with actual lineage state, native/ERC20 money,
offline-payer proof generation, HPKE recovery, deposits, contributions, claims, withdrawals, letters
and revocation.

The development bundle has been regenerated and passes `zk:check -- --artifacts-only` for all 13
relations. This verifies artifact integrity; `zk:check` validates real proofs, and `npm test --
test/protocol-real-evm.test.mjs` validates EVM execution. Development key rotation requires
coordinated manifest, verifier, local deployment and frontend updates.

Current keys are development-only. A reviewed production ceremony covering all 13 relations is
not yet available. `zk:setup` is the single entry point for local key generation, without
ceremony approval. `release:preflight` and public deployment/release gates remain closed;
key generation does not implicitly promote its artifacts.

## Privacy and operational limits

Fresh codes contain independently derived owner/viewing keys and no public identity or private
derivation index. Qualified codes expose shared pseudorandom role indices, so codes using the
same qualification can be linked before revocation. A public family rule can reveal a matching
family commitment. Source registration commitments use a different hash domain and are not
published as these code indices. Publishing a revoked role secret may associate its historical
codes with the original source registration; this revocation disclosure is retained.
Different codes may create separate initial budget records, while claims preserve the
subject-wide period allowance.

The protocol does not hide public chain metadata, timing or amounts at shield/unshield
boundaries. The three direct status lookups have fixed work independent of total revocation
history; source audit storage still grows with revoked roles. Gas traces and history-size
regressions are documented in [revocation checks and capacity](receive-revocation-capacity.md).
These results do not claim one million revocations were executed on chain or establish a
production transaction limit. Public release still requires a reviewed ceremony and the
remaining production gates.
