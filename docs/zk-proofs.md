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

The shielded inheritance pool uses a separate set of action circuits, plus a receive-code circuit that is verified only in the browser. Their proofs do not use the DeepFamily `ProofEnvelope` route.

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

## Shielded inheritance circuits

`circuits/shielded_receive_code.circom` backs a recipient's receive code. The proof shows that whoever knows the identity secret behind `identityCommitment` derived `ownerCommitment` from that secret and chose the X25519 viewing key. Its four public signals are `[identityCommitment, ownerCommitment, viewKeyLo, viewKeyHi]`. The payer's browser verifies the proof with the verification key built into the app, plus a BN254 G2 subgroup check. There is no on-chain verifier or registry. A receive code does not prove that the identity exists in DeepFamily; initial `fund` proves the intended recipient's lineage eligibility.

Five pool action circuits prove ownership and value conservation for `shield`, `fund`, `claim`, `privateTransfer`, and `unshield`. Together with the receive-code circuit there are six shielded circuits; identity and disclosure bring the build catalog to eight. Pool public inputs range from 7 (`shield`) to 27 (`fund` and `claim`); see [Shielded inheritance contracts](contracts.md#shielded-inheritance-contracts) for each layout. Each budget commits a positive uint32 `periodDays`. Fund publishes it only for publicly addressed budgets; claim proves maturity with the committed duration as a private witness, retaining 12 public period-nullifier slots.

Each pool action computes `ShieldedPoolDomain` once from its public chain ID and pool address, including their nonzero uint64/uint160 checks. Internal tag and funding components consume that constrained result; purpose tags remain separate and retain the same hash formulas. `ShieldedMerkleRoot(MAX_DEPTH)` shares path calculation and depth bounds for the 32-level note trees and 64-level lineage trees. Required memberships and conditional second-input or historical-template memberships retain their checks at the call sites. These internal changes preserve the public-signal layouts and commitment/nullifier formulas but require regenerated proving keys and Solidity verifiers.

With the pinned compiler and `--O2 --sanity_check 2`, the shared-domain implementation has 2,006 constraints for shield (previously 2,230), 57,171 for fund (62,235), 67,924 for claim (72,988), 20,131 for privateTransfer (21,323), and 11,405 for unshield (12,597). These are constraint counts, not proving-time or memory benchmarks. Claim remains above the power-16 capacity, so development setup retains the pinned power-17 Phase-1 file.

Public and private budget funding share `shield → donor VALUE → fund → child BUDGET → claim → child VALUE`. `fundMode` selects initial enrollment or additional funding. Independently, `budgetKind` selects an encrypted owner-bound private budget or a publicly delivered identity-bound budget. Public addressing needs only the selected child's existing `personHash`; the client resolves its identity commitment and proves the same lineage eligibility. It publishes the new budget's ten canonical recovery fields, ending with periodDays, while private funding publishes ten zeros. Both modes prove the donor VALUE spend, conservation, private rule/enrollment openings and the same initial-enrollment uniqueness tag.

Private budgets use domain 1015 and a policy commitment that binds periodDays. Identity budgets use terms domain 1029 and note domain 1030, binding the recipient, parent/version, rate, eligibility start and periodDays to opaque policy/enrollment commitments. The public kind-5 payload is 218 bytes padded with zeros to a 512-byte envelope; it excludes owner, rule salts and allocation-key material. The fund proof binds the parsed fields to the actual output. Donor rule openings stay in encrypted change memos. Both donor backup formats fit 400/432-byte payloads within the unchanged fixed HPKE envelope.

`claim` spends one or two compatible budgets, including a mixed pair, and proves the identity secret, current direct-child endorsement, trusted source, complete mature periods and sufficient funds. Input binding selectors are private witnesses committed by the note domains; they cannot bypass private owner or rule-opening checks. Any active owner-bound input forces an owner-bound remainder. Pure identity inputs retain their format; both remainder and VALUE are encrypted to the claimant. The 27 public signals expose neither input identity nor binding kind. Period nullifiers depend on the same identity secret, policy commitment and period index across both formats, so additional funding and format changes cannot reset allowances.

`ShieldedPoolCore` maintains the same 32-level note shards and secret-derived spend/period nullifiers for both formats. The lineage trees remain 64 levels deep. `privateTransfer` spends one or two VALUE notes into two VALUE outputs, supporting payments and consolidation; its absent second input uses a secret-bound dummy. Different public roots reveal two real inputs, while equal roots do not determine the count. `unshield` exposes its recipient and amount. Public budget facts cannot be made secret again, and fixed proof shapes do not prevent timing, wallet or small-set correlation.

`npm run zk:development:setup` prepares all 8 circuits and synchronizes browser artifacts to `frontend/public/zk/`, with the six shielded sets under `shielded/`. Generated Solidity verifiers for the five pool actions live under `contracts/Shielded*Verifier.sol`; the receive code has none. `npm run zk:production:setup` uses the same production workflow for all 8 circuits, generating independent keys for each.

To rebuild one development shielded key after changing its circuit, use `node scripts/zk-shielded-development-setup.mjs --circuit claim` (or another shielded action). The command preserves other manifest entries and keys, validates the pinned Phase-1 file, and synchronizes the complete artifact set. A fresh checkout without a complete development set needs full setup first.

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
  redeployed with the new ABI. The current unpublished fund protocol uses purpose 3 with 27 signals
  and does not retain the previous development ABI.
- A `circuitId` is not stored in `PersonVersion`, included in `personHash`, or used to infer any
  identity suite. Callers choose the route needed for each operation.

Current generated verifiers are:

- `contracts/PersonCommitmentVerifier.sol` for 5 person-relation public signals;
- `contracts/DisclosureBindingVerifier.sol` for 4 disclosure public signals;
- five shielded action verifiers for pool actions, with 7 to 27 public signals.

These seven verifiers share one `contracts/adapters/Groth16VerifierAdapter.sol` instance. The
adapter accepts the same encoding-1, 256-byte ABC payload and routes purposes 0/1 to identity
and disclosure and purposes 2–6 to the five pool actions (pool action ID + 2). Each route fixes
its verifier address and checks its expected public-signal length. The action is not a public
signal: the pool picks the purpose for its action, and the adapter handles proof transport only.

## Frontend and Shared Definitions

Cross-runtime definitions are owned by `packages/proof-core/`:

- `proofDefinitions.js` maps purpose to circuit ID, encoding, and artifact descriptor, plus the
  person and disclosure proof definitions;
- `publicSignalSpecs.js` freezes field names, order, bit widths, and lengths, including
  their corresponding public-signal layouts;
- `proofEnvelopeCodec.js` normalizes snarkjs points and builds `ProofEnvelope`.

Browser artifact descriptors live in `frontend/src/shared/zk/proofDescriptors.ts`; Node descriptors
live in `lib/proofDescriptors.js`. Both consume the same proof-core definitions. Runtime artifacts
are published under `frontend/public/zk/`:

- `person_commitment.wasm`, `person_commitment_final.zkey`, `person_commitment.vkey.json`;
- `disclosure_binding.wasm`, `disclosure_binding_final.zkey`,
  `disclosure_binding.vkey.json`;
- six shielded WASM/zkey/vkey sets under `shielded/`.

Production shielded artifacts use the same `/zk/shielded/` URLs and are installed in
`frontend/public/zk/shielded/` by `zk:production:setup` with the production manifest. Vite serves
these static files in both development and built previews. The unified `zk:artifacts:check`
checks artifact digests and derived verifiers. `zk:check` and `zk:ceremony:verify` check production
cryptography; `release:preflight` also requires the release evidence.

Shielded witnesses are assembled locally by the `shielded*Preparation` services, using
`packages/protocol-core/shielded-inheritance.js` and replayed public note and lineage events.

Proof generation and KDF work execute in dedicated Workers. Worker messages and long-lived caches
must never retain raw passphrases, salts, derived secrets, content digests, or witnesses after the
operation freezes its non-sensitive submission package.

## Development and Release Workflow

Supported top-level commands:

| Command                        | Purpose                                             |
| ------------------------------ | --------------------------------------------------- |
| `npm run zk:fetch`             | Install the pinned Circom toolchain                 |
| `npm run zk:build`             | Compile all 8 circuits                              |
| `npm run zk:development:setup` | Generate development artifacts for all 8 circuits   |
| `npm run zk:production:setup`  | Generate production artifacts for all 8 circuits    |
| `npm run zk:check`             | Check all 8 artifacts and available proof fixtures  |
| `npm run zk:artifacts:check`   | Rebuild and validate all 8 circuit artifact sets    |
| `npm run zk:ceremony:verify`   | Verify production setup evidence for all 8 circuits |

The top-level commands cover identity, disclosure, and shielded circuits together.
`zk:check` proves the identity and disclosure fixtures; in development it also checks all six
shielded artifact sets and runs the available fund/claim proof fixtures. Production checks
validate all six shielded circuit ceremonies. Release preflight additionally checks independent
audits and committed runtime benchmarks. The same testnet acceptance report verifies all 8
circuits, deployment bindings, transaction receipts, and finality before Mainnet planning.
Development keys cannot be
used for a production release.

The checked-in keys and current protocol release manifest are development-only. The manifest marks
identity/file KDF suite 1 as `candidate-awaiting-device-benchmark`, trusted setup as requiring a
fresh v1 ceremony, and deployments as absent. Do not describe the protocol as production-frozen
until device benchmarks, attacker-cost analysis, a fresh reviewed setup, artifact hashes, golden
vectors, and deployment/runtime evidence have all been recorded and the release gates pass.

`zk:development:setup` records no ceremony evidence and is never a substitute for a production
ceremony. Both it and production setup use the pinned public Phase-1 pTau committed at
`circuits/ptau/ppot_0080_17.ptau` or the file selected by `ZK_PTAU_PATH`; both check
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

The multi-asset pool protocol is version 2. `D = Poseidon3(1031, chainId, uint160(poolAddress))` and `S(purpose) = Poseidon3(1032, D, purpose)` replace each original pool-local hash domain (1010, 1011, 1014–1017, 1019, 1021, 1026–1030). The circuits compute this from the contract-supplied public chain/pool signals; commitments, spend/period/enrollment/template-use nullifiers and recursive donor backups require the same explicit scope. Global identity, owner/view keys, receive codes and lineage leaves remain unchanged. Payload and HPKE envelope format version 1 is rejected; new payloads use version 2 with the same fixed lengths. Asset pools cannot share input notes, budget templates or claim markers.

The immutable, non-upgradeable factory registers native currency and a DEEP ERC-20 pool at deployment, and anyone may create another canonical ERC-20 pool without DEEP fees, staking or approvals. Each pool tracks its own note tree and liabilities. ERC-20 entry/exit verifies both sender and recipient deltas and reserves at least totalShielded; native deposits require exact value and native exits revert on failed calls. The factory and pools have no administrator, pause, treasury, surplus withdrawal or governance entrypoint. Token import validates basic interfaces only; unsupported token behavior remains a risk limited to its pool.
