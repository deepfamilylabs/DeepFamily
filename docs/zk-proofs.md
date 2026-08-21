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

## Identity and Commitment Architecture

### Canonical identity

Full names are canonicalized before identity derivation:

- Unicode NFKC;
- Unicode whitespace collapsed to one ASCII space;
- leading and trailing whitespace removed;
- the result must be nonempty and at most 256 UTF-8 bytes.

Passphrases follow a different rule: NFKD, no trim. Empty is valid and still executes Argon2id.
Identity suite 1 derives its 16-byte deterministic salt from the suite ID, canonical name, and
packed birth/gender field. The file KDF uses the same user-entered passphrase with a different
password-input domain and a random 16-byte `fileSalt`.

The candidate suite-1 byte rules are:

```text
identityPassword = UTF8("DeepFamily:IdentityKDF:v1") || 0x00 || UTF8(NFKD(rawPassphrase))
filePassword     = UTF8("DeepFamily:FileKDF:v1")     || 0x00 || UTF8(NFKD(rawPassphrase))

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
  UTF8("deepfamily:name-prehash:v2") || UTF8(canonicalFullName)
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
NFT. `PersonSupplementInfo.story`, token URI, and `StoryChunk` content are separate intentionally
public NFT data.

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
- `contracts/adapters/Groth16VerifierAdapter.sol` for the transport boundary.

## Frontend and Shared Definitions

Cross-runtime definitions are owned by `packages/proof-core/`:

- `proofDefinitions.js` maps purpose to circuit ID, encoding, and artifact descriptor;
- `publicSignalSpecs.js` freezes field names, order, bit widths, and lengths;
- `proofEnvelopeCodec.js` normalizes snarkjs points and builds `ProofEnvelope`.

Browser artifact descriptors live in `frontend/src/shared/zk/proofDescriptors.ts`; Node descriptors
live in `lib/proofDescriptors.js`. Both consume the same proof-core definitions. Runtime artifacts
are published under `frontend/public/zk/`:

- `person_commitment.wasm`, `person_commitment_final.zkey`, `person_commitment.vkey.json`;
- `disclosure_binding.wasm`, `disclosure_binding_final.zkey`,
  `disclosure_binding.vkey.json`.

Proof generation and KDF work execute in dedicated Workers. Worker messages and long-lived caches
must never retain raw passphrases, salts, derived secrets, content digests, or witnesses after the
operation freezes its non-sensitive submission package.

## Development and Release Workflow

Supported top-level commands:

| Command                       | Purpose                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `npm run zk:fetch`            | Install the pinned Circom toolchain                        |
| `npm run zk:ptau:fetch`       | Fetch/verify the pinned public Phase-1 pTau                |
| `npm run zk:build`            | Compile both circuits                                      |
| `npm run zk:dev:refresh`      | Rebuild all development proving/verifier/browser artifacts |
| `npm run zk:production:setup` | Produce and verify fresh production Phase-2 artifacts      |
| `npm run zk:check`            | Generate and verify real proofs for both circuits          |
| `npm run zk:artifacts:check`  | Rebuild and cross-check published artifacts                |
| `npm run zk:ceremony:verify`  | Verify production setup evidence                           |

The checked-in keys and current protocol release manifest are development-only. The manifest marks
identity/file KDF suite 1 as `candidate-awaiting-device-benchmark`, trusted setup as requiring a
fresh v1 ceremony, and deployments as absent. Do not describe the protocol as production-frozen
until device benchmarks, attacker-cost analysis, a fresh reviewed setup, artifact hashes, golden
vectors, and deployment/runtime evidence have all been recorded and the release gates pass.

`zk:dev:refresh` uses development entropy and is never a substitute for a production ceremony.
Once the circuits and KDF profiles are frozen, run `npm run zk:production:setup`, review and commit
the transcript, manifest, verifier contracts, and browser artifacts together, then run:

```bash
npm run zk:ptau:fetch
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
