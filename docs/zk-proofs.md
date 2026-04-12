# Zero-Knowledge Proofs in DeepFamily

## Overview

DeepFamily currently uses two Groth16 circuits:

1. `circuits/person_commitment.circom`
   - Proves the identity commitment for a person and optional parents
   - Used by `DeepFamily.addPersonVersion()`

2. `circuits/disclosure_binding.circom`
   - Proves that an NFT mint request discloses the same canonical full name and birth fields that were used to build an existing identity commitment
   - Used by `DeepFamily.mintPersonVersionNFT()`

## Current Hash Architecture

The active design is field-native and versioned. The circuits no longer consume raw `keccak(fullName)` limbs or expose 128-bit limb pairs as public signals. Instead, they operate on a small set of field elements plus explicit metadata version fields.

### Canonical Full Name

The frontend canonicalizes names before proof generation:

- Unicode normalization: `NFKC`
- Whitespace normalization: collapse repeated whitespace to a single space
- Trim leading and trailing whitespace

The contract does not perform Unicode normalization during mint validation. `mintPersonVersionNFT()` expects the exact canonicalized string bytes that were used when the proof was generated.

### Domain Constants

The current implementation uses these fixed domains:

- `DOMAIN_SUITE = 1000`
- `DOMAIN_NAME_SECRET = 1001`
- `DOMAIN_IDENTITY = 1002`
- `DOMAIN_DISCLOSURE = 1003`
- `DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2"`

### Core Derivations

At a high level, the active flow is:

```text
canonicalFullName
  -> namePrehash = keccak256(DOMAIN_NAME_PREHASH || utf8(canonicalFullName))
  -> nameField = uint256(namePrehash) mod SNARK_FIELD

passphrase + salt
  -> derivedSecretHex via Argon2id
  -> derivedSecretField = uint256(derivedSecretHex) mod SNARK_FIELD

suiteCommitment =
  Poseidon4(DOMAIN_SUITE, schemaVersion, cryptoSuiteVersion, hashAlgoId)

nameSecretCommitment =
  Poseidon4(DOMAIN_NAME_SECRET, nameField, derivedSecretField, suiteCommitment)

packedBirthGenderField =
  (birthYear << 24) |
  (birthMonth << 16) |
  (birthDay << 8) |
  (gender << 1) |
  isBirthBC

identityCommitment =
  Poseidon4(
    DOMAIN_IDENTITY,
    nameSecretCommitment,
    packedBirthGenderField,
    suiteCommitment
  )

personHash = keccak256(bytes32(identityCommitment))

disclosureBinding =
  Poseidon4(
    DOMAIN_DISCLOSURE,
    nameField,
    packedBirthGenderField,
    suiteCommitment
  )
```

## Circuit 1: Person Commitment

File: `circuits/person_commitment.circom`

### Purpose

This circuit proves:

- the person's `identityCommitment`
- the optional father's `identityCommitment`
- the optional mother's `identityCommitment`
- the submitter address bound to the proof
- the active schema / crypto suite / hash algorithm identifiers

It is used for private submission into the lineage graph through `addPersonVersion()`.

### Main Inputs

```circom
// Person
signal input nameField;
signal input derivedSecretField;
signal input isBirthBC;
signal input birthYear;
signal input birthMonth;
signal input birthDay;
signal input gender;

// Father
signal input fatherNameField;
signal input fatherDerivedSecretField;
signal input fatherIsBirthBC;
signal input fatherBirthYear;
signal input fatherBirthMonth;
signal input fatherBirthDay;
signal input fatherGender;

// Mother
signal input motherNameField;
signal input motherDerivedSecretField;
signal input motherIsBirthBC;
signal input motherBirthYear;
signal input motherBirthMonth;
signal input motherBirthDay;
signal input motherGender;

// Control + metadata
signal input hasFather;
signal input hasMother;
signal input submitter;
signal input schemaVersion;
signal input cryptoSuiteVersion;
signal input hashAlgoId;
```

### Internal Structure

`IdentityCommitmentCore()` computes three internal values:

1. `packedBirthGenderField`
2. `nameSecretCommitment`
3. `identityCommitment`

The main `PersonCommitment()` circuit:

- computes a shared `suiteCommitment`
- runs one `IdentityCommitmentCore()` for the person
- runs one `IdentityCommitmentCore()` for the father
- runs one `IdentityCommitmentCore()` for the mother
- zeroes parent commitments when `hasFather == 0` or `hasMother == 0`

### Range / Shape Constraints

The circuit enforces:

- `hasFather` and `hasMother` are 1-bit flags
- `submitter` fits in 160 bits
- `schemaVersion`, `cryptoSuiteVersion`, and `hashAlgoId` fit in 16 bits
- `isBirthBC` fits in 1 bit
- `birthYear` fits in 16 bits
- `birthMonth <= 12`
- `birthDay` fits in 5 bits
- `gender` fits in 3 bits

### Public Signals Order

The order is fixed:

```text
[
  identityCommitment,
  fatherIdentityCommitment,
  motherIdentityCommitment,
  submitter,
  schemaVersion,
  cryptoSuiteVersion,
  hashAlgoId
]
```

## Circuit 2: Disclosure Binding

File: `circuits/disclosure_binding.circom`

### Purpose

This circuit proves that the minter knows the same private witness material needed to reconstruct the person's `identityCommitment`, while also exposing a deterministic `disclosureBinding` tied to:

- canonical full name
- packed birth/gender fields
- schema / crypto suite / hash algorithm identifiers
- the intended minter address

It is used by `mintPersonVersionNFT()`.

### Main Inputs

```circom
signal input nameField;
signal input derivedSecretField;
signal input packedBirthGenderField;
signal input minter;
signal input schemaVersion;
signal input cryptoSuiteVersion;
signal input hashAlgoId;
```

### Internal Structure

The circuit computes:

1. `suiteCommitment = Poseidon4(DOMAIN_SUITE, schemaVersion, cryptoSuiteVersion, hashAlgoId)`
2. `nameSecretCommitment = Poseidon4(DOMAIN_NAME_SECRET, nameField, derivedSecretField, suiteCommitment)`
3. `identityCommitment = Poseidon4(DOMAIN_IDENTITY, nameSecretCommitment, packedBirthGenderField, suiteCommitment)`
4. `disclosureBinding = Poseidon4(DOMAIN_DISCLOSURE, nameField, packedBirthGenderField, suiteCommitment)`

### Public Signals Order

The order is fixed:

```text
[
  identityCommitment,
  disclosureBinding,
  minter,
  schemaVersion,
  cryptoSuiteVersion,
  hashAlgoId
]
```

## Smart Contract Integration

`DeepFamily` uses `ProofEnvelope` to carry:

- `proofSystemId`
- `schemaVersion`
- `cryptoSuiteVersion`
- Groth16 proof points `a`, `b`, and `c`

### Verifiers

The active verifier contracts are:

- `contracts/PersonCommitmentVerifier.sol`
- `contracts/DisclosureBindingVerifier.sol`

`DeepFamily` routes verification through `verifierRegistry[proofSystemId][purpose]`, so the business flow is decoupled from the concrete verifier address.

### Person Submission Flow

Contract entrypoint:

```solidity
function addPersonVersion(
    ProofEnvelope calldata proof,
    PersonProofPublicSignals calldata publicSignals,
    uint256 fatherVersionIndex,
    uint256 motherVersionIndex,
    string calldata tag,
    string calldata metadataCID
) external
```

`PersonProofPublicSignals` is:

```solidity
struct PersonProofPublicSignals {
    uint256 identityCommitment;
    uint256 fatherIdentityCommitment;
    uint256 motherIdentityCommitment;
    uint256 submitter;
    uint256 schemaVersion;
    uint256 cryptoSuiteVersion;
    uint256 hashAlgoId;
}
```

Verification steps:

1. `publicSignals.submitter` must equal `uint256(uint160(msg.sender))`
2. The registered `Person` verifier must accept the Groth16 proof
3. The contract wraps each non-zero identity commitment as `keccak256(bytes32(identityCommitment))`
4. If a parent commitment is zero, the corresponding parent version index must be `0`
5. The derived parent hashes plus the provided parent version indices are passed into lineage storage

Important consequence: the contract no longer reconstructs hashes from 128-bit limbs. It works directly with full field-element commitments.

### NFT Mint Flow

Contract entrypoint:

```solidity
function mintPersonVersionNFT(
    ProofEnvelope calldata proof,
    DisclosureBindingPublicSignals calldata publicSignals,
    uint256 versionIndex,
    string calldata _tokenURI,
    PersonCoreInfo calldata coreInfo
) external
```

`DisclosureBindingPublicSignals` is:

```solidity
struct DisclosureBindingPublicSignals {
    uint256 identityCommitment;
    uint256 disclosureBinding;
    uint256 minter;
    uint256 schemaVersion;
    uint256 cryptoSuiteVersion;
    uint256 hashAlgoId;
}
```

Verification steps:

1. The contract derives `personHash = keccak256(bytes32(identityCommitment))`
2. The target `versionIndex` must exist for that `personHash`
3. `publicSignals.minter` must equal `uint256(uint160(msg.sender))`
4. The caller must already endorse that person version
5. The registered `DisclosureBinding` verifier must accept the Groth16 proof
6. `coreInfo.basicInfo.identityCommitment` must equal `bytes32(publicSignals.identityCommitment)`
7. The contract recomputes `disclosureBinding` from:
   - `coreInfo.supplementInfo.fullName`
   - `coreInfo.basicInfo`
   - `publicSignals.schemaVersion`
   - `publicSignals.cryptoSuiteVersion`
   - `publicSignals.hashAlgoId`
8. The recomputed binding must equal `bytes32(publicSignals.disclosureBinding)`
9. `_enforceAdult(coreInfo.basicInfo)` must pass before minting

This mint proof does not reveal the private derived secret, but it does intentionally bind the public mint payload to the same canonical identity basis used in the original commitment.

## Frontend and Worker Integration

The main runtime helpers are:

- `frontend/src/shared/crypto/identityCommitment.ts`
- `frontend/src/shared/crypto/disclosureBinding.ts`
- `frontend/src/shared/zk/zk.ts`
- `frontend/src/shared/zk/zkSnark.ts`
- `frontend/src/workers/zk.worker.ts`

The frontend currently loads these artifact files at runtime:

- `/zk/person_commitment.wasm`
- `/zk/person_commitment_final.zkey`
- `/zk/person_commitment.vkey.json`
- `/zk/disclosure_binding.wasm`
- `/zk/disclosure_binding_final.zkey`
- `/zk/disclosure_binding.vkey.json`

Repository location:

- `frontend/public/zk/`

## Development Workflow

### Build Circuits

From repo root:

```bash
npm run zk:build
```

Or individually:

```bash
npm run zk:build:person
npm run zk:build:disclosure
```

### Generate Trusted Setup Artifacts

```bash
npm run zk:ptau
npm run zk:setup
```

Or individually:

```bash
npm run zk:setup:person
npm run zk:setup:disclosure
```

### Export Solidity Verifiers

```bash
npm run zk:verifier
```

### Sync Frontend Artifacts

```bash
npm run zk:sync
```

### Full Refresh

```bash
npm run zk:refresh
```

This rebuilds the circuits, regenerates proving artifacts, re-exports verifier contracts, and refreshes `frontend/public/zk/`.

## Security Properties

- Private witness material stays off-chain; only commitments and version metadata are public
- `submitter` / `minter` binding prevents proof replay across different EOAs
- `schemaVersion`, `cryptoSuiteVersion`, and `hashAlgoId` are bound into both proofs
- Parent links are validated against wrapped parent commitments, preventing arbitrary parent references
- Mint disclosure is deterministic and revalidated on-chain against the calldata payload
- `personHash` preserves the existing external identifier format while the underlying proof system works on `identityCommitment`

## Notes for Future Updates

If the circuits change again, this document must be kept in sync with all of the following:

- circuit filenames
- public signal ordering
- domain constants
- contract entrypoint names and struct fields
- frontend artifact filenames under `frontend/public/zk/`
- npm scripts in `package.json`

Any mismatch between those layers will usually show up as failed proof verification, incorrect parent linkage, or mint binding reverts.
