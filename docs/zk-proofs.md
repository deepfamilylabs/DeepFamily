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

The current pool protocol, receive-code format, note payload and HPKE envelope each use version `1`. Exact format checks, cryptographic domain labels, factory registration and custody boundaries are specified in [Shielded inheritance contracts](contracts.md#shielded-inheritance-contracts).

`circuits/shielded_receive_code.circom` backs version-1 receive codes. Its nine public signals are `[identityCommitment, ownerCommitment, viewKeyLo, viewKeyHi, keyMode, identitySuiteId, assetSuiteId, assetDerivationVersion, receiveCodeVersion]`; the four metadata values are `[1, 1, 1, 1]`. It proves identity-secret knowledge and a nonzero secret opening the owner commitment. Identity-derived mode 0 constrains that secret to `Poseidon(1012, derivedSecretField)`; asset-root-derived mode 1 permits an independent nonzero secret. Both bind `ownerCommitment = Poseidon(1013, spendingSecret)`. The viewing key is bound but its derivation and the asset root's random/signature source are not proved. Source metadata never enters the statement. Browser verification includes a BN254 G2 subgroup check and payers confirm the complete receive-code fingerprint. There is no on-chain receive-code verifier or payment-key registry. A code does not prove that the identity exists in DeepFamily; initial `fund` proves lineage eligibility.

Seven pool circuits cover five actions: shield, fund, claim, privateTransfer and unshield, with separate eight-input transfer/exit variants. Together with receiveCode there are eight shielded circuits, and ten circuits including identity/disclosure. Pool public input counts range from 7 to 32; fund and claim retain 27. See [Shielded inheritance contracts](contracts.md#shielded-inheritance-contracts) for each layout. Every budget fixes a positive uint32 `periodDays`; claim keeps 12 public period-nullifier slots.

Each pool action computes `D = Poseidon3(1031, chainId, uint160(poolAddress))` once through `ShieldedPoolDomain`, including nonzero uint64/uint160 checks. Pool-specific hashes use `S(purpose) = Poseidon3(1032, D, purpose)` for purposes 1010, 1011, 1014–1017, 1019, 1021, 1026–1030 and 1033. Commitments, owner authorization, spend/period/enrollment/template-use nullifiers and allocation-key commitments require the same explicit scope as donor memo recovery. Notes, budget templates and claim markers cannot cross asset pools; identity, lineage and owner/view derivation remain independent of the scope.

Fund reuses its donor's constrained VALUE tag for change. Fund and claim compute the private/identity budget tags once per action; each budget component selects the tag and owner/terms field using its constrained boolean binding kind. This adds no public signals and keeps claim's binding selectors private. Purpose tags retain the same hash formulas.

`ShieldedMerkleRoot(MAX_DEPTH)` wraps `BinaryMerkleRoot` from exactly `@zk-kit/binary-merkle-root.circom@2.0.0` for the 32-level note trees and 64-level lineage trees. The project wrapper statically restricts `MAX_DEPTH` to 32 or 64 and unconditionally checks the depth's bit width and `depth <= MAX_DEPTH`, including disabled membership slots. The library constrains the index to `MAX_DEPTH` bits and computes the path with the same circomlib Poseidon ordering and compact path semantics. The bare library does not reject an excessive depth, so the wrapper's bounds must remain. Required root equality, conditional memberships and unused-slot normalization remain at their call sites. The Merkle wrapper preserves compact-path roots and does not itself change commitment/nullifier formulas. Current shielded proving/verification keys, browser artifacts, Solidity verifiers and manifests must match the complete circuit statements, including mode-bound owner authorization and receive-code version checks; future circuit changes require regenerating the matching artifacts.

Circuit quality takes precedence over constraint counts: interfaces must make their trust assumptions clear, security bounds must remain explicit, and tests must check protocol semantics independently. `ShieldedBudgetNoteTags` owns the private-budget, identity-budget and owner-authorization purpose tags so fund, claim and their test harness share one definition. Merkle tests compare every legal depth against independently computed JS Poseidon roots, with separate direction, invalid-witness and disabled-slot cases. Pinning the dependency does not replace the project's bounds or regression tests; any library upgrade requires another review and regenerated artifacts. The library's core has related historical PSE review evidence, but that does not constitute a complete audit of version 2.0.0, this wrapper or the protocol.

With the pinned compiler and `--O2 --sanity_check 2`, the shielded circuits have 1,681 constraints for receiveCode, 2,006 for shield, 57,700 for fund, 68,714 for claim, 20,136 for privateTransfer, 11,405 for unshield, 75,070 for privateTransfer8 and 75,357 for unshield8. Shared domains, purpose tags and bit-width reuse remain in place. Claim and the eight-input VALUE circuits exceed power-16 capacity; development setup retains the pinned power-17 Phase-1 file. These counts do not establish proving-time or memory improvements.

The following historical experiment predates the switch back to the fixed library. On 2026-10-04, the second optimization round (budget-tag reuse plus the project-owned Merkle selector) was compared with the preceding shared-domain implementation on macOS, Node v26.9.0 and snarkjs 0.7.5. It did not isolate the Merkle change. Each variant received one warmup and five alternating measured runs in fresh Node CLI processes. `groth16 fullprove` timing includes witness calculation and proving; proof verification runs separately. The fund fixture creates an initial private budget; claim uses 12 periods and a second identity-bound budget. Every proof verified and every public signal matched between variants.

| Circuit | Median fullprove, first → second round | Median peak RSS, first → second round | zkey bytes, first → second round |
| ------- | ------------------------------------ | ----------------------------------- | ------------------------------ |
| fund    | 2.164 s → 2.108 s                    | 1,373.94 MiB → 1,374.70 MiB         | 35,834,726 → 35,482,066        |
| claim   | 2.741 s → 2.831 s                    | 1,821.02 MiB → 1,819.98 MiB         | 51,855,886 → 51,501,838        |

The FFT domains were unchanged. These small historical samples showed reduced constraints and key sizes, but did not establish a consistent proving-time or memory improvement. A later isolated comparison, holding all other current circuitry constant, likewise did not detect a stable browser proving-time difference between the library and project-owned Merkle implementations. CLI process measurements do not establish browser or mobile performance. The library choice is based on reviewability and maintenance responsibility; the unconditional project bounds and full protocol regressions remain necessary.

Public and private funding share `shield → donor VALUE → fund → child BUDGET → claim → child VALUE`. Initial/continuation `fundMode` is separate from budget kind and key mode. The three legal entries are public identity-derived `(1,0)`, private identity-derived `(0,0)` and private asset-root-derived `(0,1)`. Public initial funding needs only the child's `personHash`, publishes ten canonical recovery fields and implicitly fixes the identity-derived owner. Private initial funding verifies a matching receive code and publishes ten zeros. All entries prove donor ownership, conservation and the same identity/P-based initial-enrollment nullifier. A continuation preserves binding, mode, private owner, P/E, period and start; cross-structure or mode conversion is rejected.

Private kind-2 budgets are 283 bytes and bind keyMode through `Poseidon3(S(1033), ownerCommitment, keyMode)` in domain 1015. Public kind-5 budgets retain the 218-byte terms/identity structure in domains 1029/1030 and implicit mode 0, padded to a 512-byte clear envelope. The proof binds all published recovery fields to the output. Private rule openings and allocation keys remain in donor-only encrypted memos. Identity memo payloads use 400/432 bytes and private memos use 427/459 bytes without/with allocation key; the latter include the original recipient viewing key for unchanged refill delivery. Recovery accepts these memo templates only at an authenticated Fund output boundary.

`claim` spends one or two budgets sharing binding kind, mode, owner and all policy/enrollment terms. It proves the identity, current lineage, mature unpaid periods and the authorized owner secret. Mode 0 requires the identity-derived secret; mode 1 requires the independent asset secret with no identity fallback. Owner-bound budgets require their rule openings; identity budgets do not. The remainder preserves binding/mode and the VALUE payout preserves the authorized owner; VALUE has no persistent keyMode. All 27 public signals exclude the private input identity, binding and mode. Period nullifiers remain `H(identitySecret, P, epoch, scope)` across entries and exclude owner/mode/root source. This prevents allowance resets but permits a funder knowing the complete identity secret and P to precompute real period markers and associate claims with epochs without knowing an independent funds root.

`ShieldedPoolCore` maintains 32-level note shards and secret-derived spend/period nullifiers. The lineage trees remain 64 levels deep. `privateTransfer` has two- and eight-input circuits; `unshield` has one- and eight-input circuits. Every real VALUE input has a positive uint128 amount and the same owner, chain and pool. Eight-slot enabled inputs are contiguous; disabled private openings are zero, their public shard/root repeat slot zero, and their slot-specific dummy nullifiers are distinct. The real spend nullifier is identical across capacities. Input sums use 131 bits; each of the two outputs remains uint128, and unshield has one change output plus a zero dummy. Different public roots reveal multiple real inputs, while equal roots do not determine the count. `unshield` exposes its recipient and amount. Public budget facts cannot be made secret again, and proof shapes do not prevent timing, wallet or small-set correlation.

`npm run zk:development:setup` prepares all 10 circuits and synchronizes browser artifacts to `frontend/public/zk/`, with eight shielded sets under `shielded/`. The shielded catalog is receiveCode, shield, fund, claim, privateTransfer, unshield, privateTransfer8 and unshield8. Seven pool verifier contracts live under `contracts/Shielded*Verifier.sol`; the receive code has none. `npm run zk:production:setup` uses the same production workflow for all 10 circuits, generating independent keys for each. The rebuilt local keys remain explicitly development-only and are not production ceremony evidence.

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
- seven shielded verifier routes, with 7 to 32 public signals.

These nine verifiers share one `contracts/adapters/Groth16VerifierAdapter.sol` instance. The
adapter accepts the same encoding-1, 256-byte ABC payload and routes purposes 0/1 to identity
and disclosure, purposes 2–6 to the five small-capacity pool actions (pool action ID + 2), and
purposes 7/8 to privateTransfer8/unshield8 (30/32 public signals). Each route fixes
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
- eight shielded WASM/zkey/vkey sets under `shielded/`.

Production shielded artifacts use the same `/zk/shielded/` URLs and are installed in
`frontend/public/zk/shielded/` by `zk:production:setup` with the production manifest. Only the
`.vkey.json` files are committed. The WASM/zkey files are pinned by the manifests' `wasmSha256`
and `zkeySha256` and hosted on R2 at `<VITE_ZK_ASSET_BASE_URL>/<sha256>/<file name>`:
`zk:assets:publish` uploads new files and `zk:assets:fetch` installs them in a checkout. The Vite
dev server serves the local copies; builds fetch from R2 and reject any file whose SHA-256 differs
from the manifest digest embedded at build time. The unified `zk:artifacts:check`
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
| `npm run zk:build`             | Compile all 10 circuits                              |
| `npm run zk:development:setup` | Generate development artifacts for all 10 circuits   |
| `npm run zk:production:setup`  | Generate production artifacts for all 10 circuits    |
| `npm run zk:check`             | Check all 10 artifacts and available proof fixtures  |
| `npm run zk:artifacts:check`   | Rebuild and validate all 10 circuit artifact sets    |
| `npm run zk:ceremony:verify`   | Verify production setup evidence for all 10 circuits |

The top-level commands cover identity, disclosure, and shielded circuits together.
`zk:check` proves the identity and disclosure fixtures; in development it also checks all eight
shielded artifact sets and runs the available fund/claim proof fixtures. Production checks
validate all eight shielded circuit ceremonies. Release preflight additionally checks independent
audits and committed runtime benchmarks. The same testnet acceptance report verifies all 10
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
