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
  (birthYear << 25) |
  (birthMonth << 17) |
  (birthDay << 9) |
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

This allocates non-overlapping ranges to `birthYear[25..40]`, `birthMonth[17..24]`,
`birthDay[9..16]`, `gender[1..8]`, and `isBirthBC[0]`. Gender is an unsigned
8-bit application code: `0` is unknown, `1` and `2` are conventional values,
`3` is other, and `4..255` are available for custom semantics.

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
- `gender` fits in 8 bits (`0..255`)

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

### Supported commands

Only the following top-level ZK commands are supported for routine development and release work:

| Command                       | Purpose                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| `npm run zk:fetch`            | Install the native and canonical release Circom compilers   |
| `npm run zk:ptau:fetch`       | Download or verify the fixed-digest public Phase 1 pTau     |
| `npm run zk:build`            | Compile both circuits into local build artifacts            |
| `npm run zk:dev:refresh`      | Regenerate the complete development artifact set            |
| `npm run zk:production:setup` | Generate and verify production Phase 2 artifacts            |
| `npm run zk:check`            | Generate and verify real proofs for both circuits           |
| `npm run zk:artifacts:check`  | Rebuild and cross-check all published artifacts             |
| `npm run zk:ceremony:verify`  | Verify production setup evidence and cryptographic metadata |

Circuit-specific build, setup, verifier-export, copy, proof-check, and manifest operations are
implementation details of these commands rather than separate user-facing npm entries.

### Fetch and build

From repo root:

```bash
npm run zk:fetch
npm run zk:ptau:fetch
npm run zk:build
```

`zk:fetch` installs two separate compiler roles:

- the current host's reusable native compiler at `bin/circom` (`bin/circom.exe` on Windows), used
  by development refreshes and diagnostic builds;
- the canonical official Linux amd64 release binary at
  `bin/circom-release-linux-amd64`, retained as the reviewed audit reference.

Both roles use the same repository-pinned Circom version. Installation follows this support matrix:

| Host/runtime         | Installation strategy          | Prerequisites                               | Production release host |
| -------------------- | ------------------------------ | ------------------------------------------- | ----------------------- |
| Linux x64 with glibc | Pinned official release asset  | None                                        | Yes                     |
| macOS arm64          | Build the pinned source commit | `git`, Rust/Cargo, Xcode Command Line Tools | Yes                     |
| Windows x64          | Pinned official release asset  | Visual C++ 2015–2022 Redistributable        | Yes                     |

Official x64 assets are accepted only when their fixed SHA-256 matches. Linux libc is detected from
Node's process report and musl is rejected explicitly. Windows ARM64 hosts remain unsupported even
with x64 Node emulation. The macOS arm64 runtime checks out the pinned
source repository commit, builds it with locked Cargo dependencies, verifies the exact compiler
version, and records local provenance. The installer refuses to replace unexpected files or
symbolic links.
Regardless of the host, the separately downloaded canonical release binary must match the fixed
Linux amd64 glibc digest.

Linux x64 with glibc, macOS arm64, and Windows x64 are the only supported host/runtime pairs. Other
platform and architecture combinations fail closed instead of selecting a foreign toolchain. CI
uses GitHub's `ubuntu-latest` x64/glibc runner and separately exercises macOS arm64 and Windows x64.

All circuit compilation passes `--O2` explicitly, so a compiler release cannot silently change the
constraint system by changing its default optimization level. `zk:artifacts:check` compares the
rebuilt R1CS hash with the manifest and the rebuilt WASM bytes with the published browser artifact.
The native compiler's output must therefore match the hashes reviewed for the canonical Linux
toolchain; version equality alone is insufficient release evidence. On a non-Linux host the check
validates the canonical binary's fixed digest but does not execute that foreign-platform binary.

Local development and diagnostic acceptance may use the reusable native compiler installed by
`zk:fetch`. For a source target, `zk:production:setup` and `release:preflight` instead ignore that
gitignored cache and perform a fresh locked build of the pinned commit in an isolated per-user
build directory. These
source checkouts live under a protected per-user build directory, reject external ancestor Cargo
configuration, remove inherited Git, Cargo, Rust, Node, dynamic-loader, npm, compiler, linker, and
package-discovery overrides, resolve Git/Cargo/Rustc to protected absolute executables, and use a
controlled PATH with private home/Cargo/XDG/temporary directories. Ambient Git configuration and
hooks are disabled. The resulting compiler is copied into private release staging. Production setup checks all
four R1CS/WASM hashes against the reviewed manifest and only
then permits either Groth16 Setup or Phase 2 contribution. The ceremony transcript records the
actual compiler target, strategy, version, binary hash, Linux libc evidence, pinned source commit,
and Cargo/Rust versions. The compiler and pTau live in the user's private OS temporary directory,
and their inputs are rechecked immediately before each Groth16 setup and again before installation.
The canonical `bin/circom-release-linux-amd64` file remains a fixed-digest audit reference and is
not executed on a foreign platform.

The Phase 2 contribution helper and its local dependency are reconstructed from the exact release
commit's Git blobs. Their object IDs are checked when staged, and their SHA-256 digests are verified
once before entropy generation and again immediately before the entropy pipe is handed to the child
process.

Release-only temporary roots are validated as current-user-only before use. POSIX roots must be
owned by the current UID with mode `0700`. Windows roots have ACL inheritance and existing access
rules removed, are assigned to the current user SID with the sole full-control rule, and are
re-read to verify that policy; hardening failure aborts and removes the directory.

Both development and production use the same pinned public power-13 Phase 1 file:

```text
tmp/zk-production/powersOfTau28_hez_final_13.ptau
```

The downloader validates its expected byte length, SHA-256, and BLAKE2b-512 before use. Sharing
this reviewed Phase 1 file does not make the two setup modes equivalent: security also depends on
the circuit-specific Phase 2 contributions.

### Development Full Refresh

```bash
npm run zk:dev:refresh
```

This is a self-contained development workflow. It fetches or verifies the shared pTau, compiles
both circuits, regenerates both development zkeys and verification keys, exports both Solidity
verifiers, copies the complete browser artifact set to `frontend/public/zk/`, and updates the
development manifest.

The development Phase 2 flow deliberately uses one operator and hard-coded public entropy. This
supplies no independent secret contribution, and the operator may retain the circuit-specific toxic
waste. These keys are therefore suitable only for local development and tests even though their
Phase 1 input is the same reviewed pTau used by production. The command overwrites the checked-in
proving artifacts with keys whose manifest status remains `development`.

The copy stage only copies already-generated WASM, zkey, and verification-key files. If any source
artifact is missing, it fails explicitly instead of generating or exporting another file as an
undocumented side effect.

### Production Setup

Do not use `zk:dev:refresh` for production. After the circuits are frozen, start from a clean commit
on any supported host and run:

```bash
npm run zk:production:setup
```

The command downloads or reuses the repository-pinned public power-13 pTau, generates separate
OS-CSPRNG Phase 2 entropy for both circuits, creates one contribution per circuit under the explicit
`single-operator` trust model, applies a local finalization value, exports every release artifact,
and verifies the result before returning. It does not commit or deploy anything.

The current artifact manifest is schema v3. It hashes the installed snarkjs runtime as a logical
production dependency graph using each package's content, identity, version, and logical dependency
path, so the digest does not depend on the checkout location or whether npm physically nested or
hoisted an equivalent graph. Production setup copies only the verified runtime into private
staging, makes its package files read-only on POSIX, and executes snarkjs from that snapshot. Before
the contribution helper reads either secret, it re-hashes the snapshot and runs without inherited
release injection variables, so hashing only the CLI file is not treated as sufficient production
evidence.

Schema-v2 manifests remain readable for legacy compatibility inspection and ceremony verification,
but they cannot start `zk:production:setup` or pass `release:preflight`. The latter creates and
re-checks its own private schema-v3 snarkjs runtime snapshot for the cryptographic verification
commands.

Review and commit the manifest, transcript, Solidity verifiers, and frontend ZK artifacts together.
Then run the full gate from that clean commit:

```bash
npm run zk:ptau:fetch
npm run zk:ceremony:verify
npm run release:preflight
```

`ZK_PTAU_PATH` is optional. With no override, verification uses
`tmp/zk-production/powersOfTau28_hez_final_13.ptau`; an override must contain the same file hash
recorded by the production manifest. The detailed procedure and optional multi-party enhancement
are documented in [zk-ceremony.md](./zk-ceremony.md).

### Protocol Versioning Policy

`schemaVersion`, `cryptoSuiteVersion`, and `hashAlgoId` identify cryptographic semantics; they are
not application release numbers. Before the first public deployment, an incompatible circuit or
packing change may still replace the development `v1` only when every development chain is reset
and the circuit, proving artifacts, verifier, contract, frontend, fixtures, and seed output are
refreshed together.

The first production deployment freezes those `v1` semantics. After that point, an incompatible
packing, circuit, or hash change must use a new suite/verifier route and versioned frontend
artifacts, while retaining an explicit compatibility or migration path for existing identities.

### Trusted Setup Status

The proving keys currently checked into `frontend/public/zk/` remain development-only until the
manifest records a verified production setup. A production release must replace them with
`npm run zk:production:setup`, publish the generated contribution transcript and artifact hashes,
regenerate the Solidity verifiers, and verify that every deployed verifier matches the published
proving and verification keys. The default production policy deliberately trusts one local Phase 2
operator to destroy both secrets and records that assumption as `trustModel=single-operator`.
Release-rehearsal and Mainnet release scripts enforce the manifest status and cannot deploy
development keys.

The ZK contributor count has no relationship to the governance Safe threshold. DeepFamily may use
one ZK operator while the production governance Safe independently requires three owners and two
approvals. A multi-party ZK setup may be adopted later as an optional security enhancement.

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
