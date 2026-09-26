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

A third circuit, `FamilyInheritanceClaim` (`circuits/family_inheritance_claim.circom`), is not a
DeepFamily purpose. `FamilyInheritance.claim` calls its generated verifier directly, with no
`ProofEnvelope` and no `verifierRegistry` route; see
[FamilyInheritanceClaim Circuit](#familyinheritanceclaim-circuit).

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
`npm run protocol:unicode:check` downloads hash-pinned official UCD
sources and runs the complete Unicode normalization conformance suite; it is an explicit
reproducibility check rather than a network dependency of the ordinary offline test command.
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

## FamilyInheritanceClaim Circuit

The claim circuit lets a direct child of a root person withdraw from a family inheritance
(`FamilyInheritance`, see [contracts.md](contracts.md#familyinheritancesol---family-inheritance)) without revealing which
child they are. Legitimacy stays on chain: the child's version must name the root as father or
mother and be endorsed by a trusted endorser (recommended source) of the root version.

### Lineage trees

`DeepFamilyLineageIndex` mirrors public DeepFamily state in two Poseidon LeanIMTs. They follow zk-kit
semantics: a node hash is `Poseidon2(left, right)`, a node without a right sibling rises unchanged,
and the maximum depth is 64. The index rejects appends beyond `2^64` cumulative leaf slots per tree;
clearing a leaf retains its slot.

```text
DOMAIN_INHERITANCE_CREDENTIAL   = 1005
DOMAIN_INHERITANCE_CLAIM_TAG    = 1006
DOMAIN_LINEAGE_ENDORSEMENT_LEAF = 1007
DOMAIN_LINEAGE_TRUSTED_LEAF     = 1008
DOMAIN_LINEAGE_PARENTS          = 1009

parentsDigest = Poseidon3(1009, fatherIdentityCommitment, motherIdentityCommitment)

endorsementLeaf = Poseidon5(
  1007,
  identityCommitment,         // the endorsed person
  parentsDigest,              // of the endorsed version
  versionIndex,
  writtenAt * 2^160 + endorser
)

trustedLeaf = Poseidon4(1008, rootIdentityCommitment, rootVersionIndex, account)
```

A missing parent contributes a zero identity commitment. `writtenAt` is the block time of the
endorsement write and occupies bits 160..223; the endorser occupies bits 0..159.

- Tree 0 holds one leaf per (person, endorser). Changing the endorsement rewrites that leaf with a
  new `writtenAt`; cancelling it sets the leaf to zero.
- Tree 1 holds one leaf per (person, version, trusted account). Removing the account sets the leaf
  to zero.

### Credential and claim tag

```text
inheritanceCredential = Poseidon4(1005, rootIdentityCommitment, rootVersionIndex, rootDerivedSecretField)
claimTag              = Poseidon3(1006, heirDerivedSecretField, inheritanceCredential)
```

A deposit names only the credential. Without the root's derived secret it cannot be linked to the
root's identity commitment or person hash. It also fixes the root version, so a new root version
with different trusted endorsers cannot take over an existing inheritance. The claim tag is the
heir's pseudonym under one credential: the contract counts claimed amounts per tag, so every child
has one running total. Tags under different credentials cannot be linked to each other or to the
heir.

### Statement

The proof shows that the prover:

1. knows an identity witness (name field, derived secret, birth/gender fields, suite ID) for the
   heir's identity commitment;
2. knows an endorsement leaf in tree 0 for that identity whose parents digest opens to a father and
   mother commitment, one of which (selected by the private `rootIsMother` bit) is a nonzero root
   commitment;
3. knows a trusted leaf in tree 1 for that root commitment, a root version, and the same endorser;
4. opens `inheritanceCredential` with that root commitment, root version, and a root derived
   secret;
5. derived `claimTag` from the heir's own derived secret and the credential;
6. satisfies `writtenAt + 30 days <= eligibleFrom`.

An endorsement written or rewritten less than one period ago therefore cannot be used; a child
re-endorsed after a passphrase leak starts a new waiting period under the new identity.

The circuit range-checks the endorser to 160 bits, `writtenAt` and `eligibleFrom` to 64 bits, and
the identity fields as in PersonRelation. Both tree depths must be at most 64, because the zk-kit
root template returns zero for a larger depth. `recipient` is bound by a square constraint, so a
copied proof cannot pay a different address. The circuit has 34,247 constraints.

### Public signals

```text
[
  endorsementRoot,
  trustedRoot,
  inheritanceCredential,
  claimTag,
  eligibleFrom,
  recipient
]
```

### Contract checks

`FamilyInheritance.claim(id, signals, proof)`:

- takes `inheritanceCredential` from the stored inheritance, never from calldata;
- requires each root to be the index's current root or one replaced within the last hour
  (`ROOT_HISTORY_WINDOW`), so a proof built just before another write still lands;
- requires `eligibleFrom` to lie on the inheritance's 30-day grid from `startTime`, not before
  `startTime`, and not after the current block;
- pays `amountPerPeriod × ((now − eligibleFrom) / 30 days + 1)` minus what the tag has already
  received, capped at the balance. A shortfall stays owed and becomes claimable after a deposit.

The proof hides which child claims and the root's identity. The recipient, amounts, timing, and the
wallet that sends the transaction and pays its gas are public. To build the witness, the frontend
replays every `LeafWritten` and `VersionIndexed` event and every DeepFamily endorsement and
trusted-endorser event, rebuilds each candidate leaf locally, and looks it up in the replayed
trees; no RPC request names the heir or the root.

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
- Existing and new IDs under the same purpose may coexist indefinitely, provided each keeps that
  purpose's frozen public-signal ABI. A signal-count/order change requires a new purpose/entrypoint
  and protocol generation; it cannot be installed behind an old route contract ABI.
- A `circuitId` is not stored in `PersonVersion`, included in `personHash`, or used to infer any
  identity suite. Callers choose the route needed for each operation.

Current generated verifiers are:

- `contracts/PersonCommitmentVerifier.sol` for 5 person-relation public signals;
- `contracts/DisclosureBindingVerifier.sol` for 4 disclosure public signals;
- `contracts/adapters/Groth16VerifierAdapter.sol` for the transport boundary;
- `contracts/FamilyInheritanceClaimVerifier.sol` for 6 inheritance-claim public signals, called
  directly by `FamilyInheritance`.

## Frontend and Shared Definitions

Cross-runtime definitions are owned by `packages/proof-core/`:

- `proofDefinitions.js` maps purpose to circuit ID, encoding, and artifact descriptor, plus the
  standalone `inheritance-claim-groth16-bn254-v1` definition;
- `publicSignalSpecs.js` freezes field names, order, bit widths, and lengths, including
  `inheritance-claim-v1`;
- `proofEnvelopeCodec.js` normalizes snarkjs points and builds `ProofEnvelope`.

Browser artifact descriptors live in `frontend/src/shared/zk/proofDescriptors.ts`; Node descriptors
live in `lib/proofDescriptors.js`. Both consume the same proof-core definitions. Runtime artifacts
are published under `frontend/public/zk/`:

- `person_commitment.wasm`, `person_commitment_final.zkey`, `person_commitment.vkey.json`;
- `disclosure_binding.wasm`, `disclosure_binding_final.zkey`,
  `disclosure_binding.vkey.json`;
- `family_inheritance_claim.wasm`, `family_inheritance_claim_final.zkey`,
  `family_inheritance_claim.vkey.json`.

The inheritance claim witness is assembled by `buildInheritanceClaimWitness` in
`packages/protocol-core/inheritance.js`, which recomputes every leaf and root and rejects a mismatch
before proving.

Proof generation and KDF work execute in dedicated Workers. Worker messages and long-lived caches
must never retain raw passphrases, salts, derived secrets, content digests, or witnesses after the
operation freezes its non-sensitive submission package.

## Development and Release Workflow

Supported top-level commands:

| Command                        | Purpose                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `npm run zk:fetch`             | Install the pinned Circom toolchain                        |
| `npm run zk:build`             | Compile all three circuits                                 |
| `npm run zk:development:setup` | Rebuild all development proving/verifier/browser artifacts |
| `npm run zk:production:setup`  | Produce and verify fresh production Phase-2 artifacts      |
| `npm run zk:check`             | Generate and verify real proofs for every circuit          |
| `npm run zk:artifacts:check`   | Rebuild and cross-check published artifacts                |
| `npm run zk:ceremony:verify`   | Verify production setup evidence                           |

The checked-in keys and current protocol release manifest are development-only. The manifest marks
identity/file KDF suite 1 as `candidate-awaiting-device-benchmark`, trusted setup as requiring a
fresh v1 ceremony, and deployments as absent. Do not describe the protocol as production-frozen
until device benchmarks, attacker-cost analysis, a fresh reviewed setup, artifact hashes, golden
vectors, and deployment/runtime evidence have all been recorded and the release gates pass.

`zk:development:setup` records no ceremony evidence and is never a substitute for a production
ceremony. Both it and production setup use the pinned public Phase-1 pTau committed at
`circuits/ptau/ppot_0080_16.ptau` or the file selected by `ZK_PTAU_PATH`; both check
its pinned hashes before use, and no command downloads it.

Once the circuits and KDF profiles are frozen, run `npm run zk:production:setup`, review and commit
the transcript, manifest, verifier contracts, and browser artifacts together, then run:

```bash
npm run zk:ceremony:verify
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
- A public-signal ABI change requires a new purpose/entrypoint and protocol generation.

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
