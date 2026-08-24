# Smart Contracts Reference

## DeepFamily.sol - Core Protocol Contract

**Location**: `contracts/DeepFamily.sol`
**Description**: Main family tree protocol implementing multi-version person management, ZK-proof verification, community endorsement, NFT minting, and story sharding.
**Upgradeability**: Deployed behind a UUPS (ERC-1967) proxy. State is wired via `initialize(...)` rather than a constructor; upgrades are gated by `_authorizeUpgrade` (`onlyOwner`, intended owner = `TimelockController`). See [Upgradeability & Governance (UUPS)](#upgradeability--governance-uups).

### Critical Constants

| Constant                   | Value | Purpose and impact                                      |
| -------------------------- | ----- | ------------------------------------------------------- |
| `MAX_LONG_TEXT_LENGTH`     | 256   | Maximum bytes for NFT names, places, story, and token URI |
| `MAX_CHUNK_CONTENT_LENGTH` | 2048  | Public NFT story chunk byte limit                       |
| `PROTOCOL_FEE_BPS_MAX`     | 2000  | Maximum protocol endorsement fee (20%)                  |
| `FEE_BPS_DENOMINATOR`      | 10000 | Basis-point denominator                                 |

### Core Data Structures

#### PersonBasicInfo

```solidity
struct PersonBasicInfo {
  bytes32 identityCommitment; // bytes32 form of IdentityCommitment
  bool isBirthBC; // Birth era flag
  uint16 birthYear; // Birth year (0=unknown)
  uint8 birthMonth; // Birth month (1-12, 0=unknown)
  uint8 birthDay; // Birth day (1-31, 0=unknown)
  uint8 gender; // Gender code (0=unknown, 1=male, 2=female, 3=other, 4-255=custom)
}
```

`identityCommitment` is the contract-facing identity anchor. It is derived off-chain from:

- canonicalized full name
- `derivedSecretField`
- packed birth / gender fields
- the role's atomic nonzero `identitySuiteId`, committed as
  `Poseidon4(1000, identitySuiteId, 0, 0)`

The packed field uses non-overlapping bit ranges: `birthYear[25..40]`,
`birthMonth[17..24]`, `birthDay[9..16]`, `gender[1..8]`, and `isBirthBC[0]`.

#### PersonVersion

```solidity
struct PersonVersion {
  bytes32 personHash; // keccak256(bytes32(identityCommitment))
  bytes32 fatherHash; // Father's person hash
  bytes32 motherHash; // Mother's person hash
  uint256 versionIndex; // Version index (starts from 1)
  uint256 fatherVersionIndex; // Father's version reference (0=unspecified)
  uint256 motherVersionIndex; // Mother's version reference (0=unspecified)
  uint256 versionCommitment; // Keyed canonical-metadata commitment from the relation proof
  address addedBy; // Contributor address (packed with timestamp)
  uint96 timestamp; // Addition timestamp (packed with addedBy)
}
```

`tag` and private `biography` are encrypted inside the metadata envelope; neither is stored as a
plaintext `PersonVersion` field. `versionCommitment` is deterministic for a canonical plaintext and
identity secret, while the encrypted envelope is randomized.

#### Proof Transport and Public Signals

```solidity
enum ProofPurpose { PersonRelation, DisclosureBinding }

struct ProofEnvelope {
  uint32 circuitId;
  uint8 proofEncodingId;
  bytes proofData;
}

struct PersonProofPublicSignals {
  uint256 identityCommitment;
  uint256 fatherIdentityCommitment;
  uint256 motherIdentityCommitment;
  uint256 submitterAndSelfSuiteId;
  uint256 versionCommitment;
}

struct DisclosureBindingPublicSignals {
  uint256 identityCommitment;
  uint256 disclosureBinding;
  uint256 minter;
  uint256 suiteCommitment;
}
```

`ProofEnvelope` has exactly the three fields shown above. The entrypoint fixes the purpose,
`circuitId` chooses one exact permanent verifier route under that purpose, and `proofEncodingId`
only describes the bytes encoding understood by the adapter.

#### PersonCoreInfo

```solidity
struct PersonCoreInfo {
  PersonBasicInfo basicInfo; // Hash-based identity
  PersonSupplementInfo supplementInfo; // Human-readable data
}

struct PersonSupplementInfo {
  string fullName; // Full name (revealed for NFT)
  string birthPlace; // Birth place
  bool isDeathBC; // Death era flag
  uint16 deathYear; // Death year (0=unknown)
  uint8 deathMonth; // Death month (0-12, 0=unknown)
  uint8 deathDay; // Death day (0-31, 0=unknown)
  string deathPlace; // Death place
  string story; // Life story summary
}
```

#### Story Sharding Structures

```solidity
struct StoryChunk {
  uint256 chunkIndex; // Chunk index (starts from 0)
  bytes32 chunkHash; // keccak256(content)
  string content; // Chunk content (≤2048 bytes)
  uint256 timestamp; // Creation/update timestamp
  address editor; // Last editor address
  uint8 chunkType; // Classification (0=narrative, 1=quote, ...)
  string attachmentCID; // Optional external attachment CID
}

struct StoryMetadata {
  uint256 totalChunks; // Current total chunks
  bytes32 fullStoryHash; // Rolling hash keccak(previousHash, chunkIndex, chunkHash)
  uint256 lastUpdateTime; // Last update timestamp
  bool isSealed; // Immutability flag
  uint256 totalLength; // Total character count
}
```

### Core Hash Computation

The active system derives person hashes as follows:

1. Off-chain code computes `identityCommitment`
2. The contract derives `personHash` as `keccak256(bytes32(identityCommitment))`
3. Parent references are validated against wrapped parent commitments

For canonical metadata bytes, the client splits `keccak256(canonicalJsonBytes)` into low/high
128-bit limbs. The relation circuit publishes
`Poseidon4(1004,derivedSecretField,contentDigestLo,contentDigestHi)` as `versionCommitment`, using
the same self secret as `identityCommitment`. This proves keying, but not that the private digest
matches the encrypted plaintext; clients must verify that after decryption.

The mint flow computes a separate `disclosureBinding` from the intentionally disclosed canonical
full name, packed birth/gender fields, and the proof's `suiteCommitment`.

### Core Functions

#### ZK-Proof Person Addition

```solidity
function addPersonVersion(
    ProofEnvelope calldata proof,
    PersonProofPublicSignals calldata publicSignals,
    uint256 fatherVersionIndex,
    uint256 motherVersionIndex,
    bytes calldata metadataEnvelope
) external
```

**Verification Process**:

1. Requires the one-time `metadataArchive` binding to be configured.
2. Reads only the 20-byte envelope common prefix: magic `DFM1`, nonzero `formatVersion`, and the
   nonzero big-endian self suite at bytes `0x10..0x13`.
3. Requires `submitterAndSelfSuiteId` to equal the caller in the low 160 bits plus that header suite
   in the next 32 bits; bits above 191 are therefore rejected.
4. Selects `verifierRegistry[PersonRelation][proof.circuitId]` and sends the five ordered public
   signals to its adapter.
5. Wraps each nonzero identity commitment as `keccak256(bytes32(identityCommitment))` and validates
   the parent references.
6. Rejects a duplicate `versionHash` scoped to the person, parent references, and
   `versionCommitment`.
7. Creates the version and calls the fixed Archive with the exact envelope in the same transaction.

DeepFamily does not parse format-1 selectors, salts, IVs, ciphertext, GCM tags, gzip, or JSON. It
also does not calculate `versionCommitment` from `contentCiphertext`; the contract has neither the
plaintext nor the identity secret required to do so.

**Mining Reward Semantics**:

- Each `personHash` can receive at most one mining reward, on its first version whose proof-derived father and mother identity commitments are both non-zero.
- A person may be added without parents and claim the one-time reward later when a complete-parent version is submitted.
- Parent records do not need to exist on-chain. Both parent version indices may remain `0` (“unspecified”).
- Later versions do not mint another reward for that person.

#### Community Endorsement

```solidity
function endorseVersion(
    bytes32 personHash,
    uint256 versionIndex
) external
```

**Endorsement Mechanics**:

- Endorsers pay `recentReward` amount in DEEP utility points (ERC20)
- `recentReward` is `0` before the first successful mining reward, tracks the most recently minted reward during mining, and returns to `0` when mining rewards end
- **Fee Distribution**: Majority flows to NFT holder (if minted) or original contributor, with a small protocol share (default 5%, max 20%) for sustainability
- Protocol share goes to contract owner or burned if ownership renounced
- Each account can endorse only one version per person
- Switching endorsements rebalances vote counts

#### NFT Minting with Disclosure Proof

```solidity
function mintPersonVersionNFT(
    ProofEnvelope calldata proof,
    DisclosureBindingPublicSignals calldata publicSignals,
    uint256 versionIndex,
    string calldata _tokenURI,
    PersonCoreInfo calldata coreInfo
) external nonReentrant
```

**Minting Requirements**:

1. Caller must have endorsed this version
2. The permanent `verifierRegistry[DisclosureBinding][proof.circuitId]` route must accept the proof
3. `publicSignals.identityCommitment` must match `coreInfo.basicInfo.identityCommitment`
4. `publicSignals.disclosureBinding` must match the contract's recomputed disclosure binding
5. `publicSignals.minter` must equal `uint256(uint160(msg.sender))`
6. `personHash` is derived from `publicSignals.identityCommitment`
7. `publicSignals.suiteCommitment` is used in the contract's disclosure-binding recomputation
8. Linked `AdultAgeGate` age validation must pass

The frontend obtains the target self suite from the archived envelope before proof generation. The
Mint contract itself does not read or parse the envelope header. Private encrypted `biography` and
the public NFT `PersonSupplementInfo.story` are independent fields; copying one into the other is
an explicit product action, not protocol behavior.

#### Story Sharding System

```solidity
function addStoryChunk(
    uint256 tokenId,
    uint256 chunkIndex,
    uint8 chunkType,
    string calldata content,
    string calldata attachmentCID,
    bytes32 expectedHash
) external
function sealStory(uint256 tokenId) external
```

**Story Management**:

- Only NFT holders can append chunks
- Chunks must be added sequentially starting from index 0
- Content hash validation prevents corruption
- Optional `chunkType` classifies content (narrative/quote/etc.)
- Optional `attachmentCID` links to decentralized media evidence
- Sealing makes stories permanently immutable

**chunkType Mapping**

| Value | Meaning                         |
| ----- | ------------------------------- |
| 0     | Narrative (primary storyline)   |
| 1     | Work / Achievement              |
| 2     | Quote                           |
| 3     | Media (photo/audio/video notes) |
| 4     | Timeline event                  |
| 5     | Commentary                      |
| 6     | Source / citation               |
| 7     | Correction                      |
| 8     | Editorial note                  |

## MetadataArchiveV1.sol - Opaque On-Chain Metadata Archive

`MetadataArchiveV1` is a non-upgradeable, ownerless blob writer and reference index. Its constructor
immutably binds one DeepFamily proxy in `DEEP_FAMILY`; only that address can call `store`.

```solidity
struct MetadataRef {
  address pointer;
  bytes32 payloadHash;
  uint32 payloadLength;
}

function store(
  bytes32 personHash,
  uint256 versionIndex,
  bytes calldata envelope
) external returns (MetadataRef memory metadata);

function metadataRef(
  bytes32 personHash,
  uint256 versionIndex
) external view returns (MetadataRef memory metadata);
```

For every nonempty envelope of at most 16,384 bytes, the Archive deploys a data contract whose
runtime code is exactly `0x00 || envelope`. The leading `0x00` is a safe `STOP` opcode and is not
included in `payloadLength` or `payloadHash`. The Archive derives
`payloadHash = keccak256(envelope)` and `payloadLength = envelope.length` from the actual calldata,
stores one immutable ref per `(personHash,versionIndex)`, and emits `MetadataStored`.

The Archive deliberately does not understand DFM1, `formatVersion`, JSON, compression, KDFs,
ciphers, or identity suites. `V1` names the storage/ref ABI, not the envelope format. As long as the
data-contract encoding, 16 KiB limit, and `MetadataRef` ABI remain unchanged, the same Archive can
hold later envelope formats. DeepFamily permanently binds one Archive with the one-time,
proxy-only, owner-only `setMetadataArchive`; there is no Archive ID, registry, active route, or
per-version Archive selection. If the data-contract encoding, size limit, ref ABI, or Archive logic
itself must change incompatibly, this simplified generation requires a new DeepFamily protocol
deployment rather than routing old and new versions between Archive contracts.

### DFM1 Contract-Visible Prefix and Format-1 Layout

All envelopes accepted by the current `addPersonVersion` ABI share a permanent 20-byte prefix:

| Envelope offset | Bytes | Meaning checked by DeepFamily |
| ---: | ---: | --- |
| `0x00` | 4 | ASCII `DFM1` (`0x44464d31`) |
| `0x04` | 1 | nonzero `formatVersion` |
| `0x05..0x0f` | 11 | format-specific; not interpreted by DeepFamily |
| `0x10` | 4 | nonzero big-endian `uint32` self identity-suite ID |

The current client implements format 1 with this exact layout:

| Offset | Bytes | Field | Format-1 rule |
| ---: | ---: | --- | --- |
| `0x00` | 4 | magic | `DFM1` |
| `0x04` | 1 | `formatVersion` | `1` |
| `0x05` | 1 | flags | `0` |
| `0x06` | 1 | plaintext codec | `1`, canonical JSON v1 |
| `0x07` | 1 | compression suite | `1`, gzip-v1 |
| `0x08` | 1 | cipher suite | `1`, AES-256-GCM |
| `0x09` | 1 | file-KDF suite | `1`, candidate Argon2id profile |
| `0x0a` | 2 | header length | big-endian `112` |
| `0x0c` | 4 | content ciphertext length `N` | big-endian, `1..16,256` |
| `0x10` | 4 | self identity-suite ID | nonzero big-endian `uint32` |
| `0x14` | 4 | reserved | zero |
| `0x18` | 16 | random file salt | file-KEK salt |
| `0x28` | 12 | wrap IV | AES-GCM DEK wrapping |
| `0x34` | 12 | content IV | AES-GCM content encryption |
| `0x40` | 32 | wrapped DEK | ciphertext without tag |
| `0x60` | 16 | wrapped-DEK tag | AES-GCM tag |
| `0x70` | `N` | content ciphertext | encrypted `gzip(canonical JSON)` |
| `0x70 + N` | 16 | content tag | AES-GCM tag |

The envelope length is exactly `128 + N`. The data-contract STOP byte precedes envelope offset
zero, so runtime code length is `129 + N`; none of the table offsets include STOP. Archive and
Reader enforce none of these format-1 rows. DeepFamily enforces only the common-prefix rows, while
the client strictly validates the complete table before running a KDF.

## DeepFamilyReader.sol - Aggregated Read Contract

Phase 3 moves expensive detail and paginated read aggregation out of `DeepFamily`.
`DeepFamilyReader` is constructed after Archive binding with the DeepFamily proxy address. It
validates the proxy's configured Archive and the Archive's reverse `DEEP_FAMILY` binding, then
stores both as immutables. Write calls continue to target `DeepFamily`.

Reader returns references; it never returns or parses the large envelope. Clients read the pointer
with `eth_getCode`, require runtime length `payloadLength + 1`, require the leading STOP, hash
`code[1:]`, parse the 20-byte common prefix, and only then dispatch a supported format parser.

### Query Functions (Paginated)

#### Version Queries

```solidity
function getVersionDetails(bytes32 personHash, uint256 versionIndex)
  external view returns (PersonVersion memory, MetadataRef memory, uint256, uint256)
function listPersonVersions(bytes32 personHash, uint256 offset, uint256 limit) external view returns (PersonVersion[] memory, uint256, bool, uint256)
function getVersionMetadataRef(bytes32 personHash, uint256 versionIndex) external view returns (MetadataRef memory)
```

#### Family Tree Queries

```solidity
function listChildren(bytes32 parentHash, uint256 parentVersionIndex, uint256 offset, uint256 limit) external view returns (bytes32[] memory, uint256[] memory, uint256, bool, uint256)
```

#### NFT Queries

```solidity
function getNFTDetails(uint256 tokenId)
  external view returns (bytes32, uint256, PersonVersion memory, MetadataRef memory, PersonCoreInfo memory, uint256, string memory)
```

#### Story Queries

```solidity
function getStoryMetadata(uint256 tokenId) external view returns (StoryMetadata memory)
function getStoryChunk(uint256 tokenId, uint256 chunkIndex) external view returns (StoryChunk memory)
function listStoryChunks(uint256 tokenId, uint256 offset, uint256 limit) external view returns (StoryChunk[] memory, uint256, bool, uint256)
```

### Events System

#### Core Events

```solidity
event PersonVersionAdded(
  bytes32 indexed personHash,
  uint256 indexed versionIndex,
  address indexed addedBy,
  uint256 timestamp,
  bytes32 fatherHash,
  uint256 fatherVersionIndex,
  bytes32 motherHash,
  uint256 motherVersionIndex,
  uint256 versionCommitment
);

event PersonVersionEndorsed(
  bytes32 indexed personHash,
  address indexed endorser,
  uint256 versionIndex,
  address recipient,
  uint256 recipientShare,
  address protocolRecipient,
  uint256 protocolShare,
  uint256 endorsementFee,
  uint256 timestamp
);

event EndorsementCancelled(
  bytes32 indexed personHash,
  address indexed user,
  uint256 versionIndex,
  uint256 timestamp
);

event PersonNFTMinted(
  bytes32 indexed personHash,
  uint256 indexed tokenId,
  address indexed owner,
  uint256 versionIndex,
  string tokenURI,
  uint256 timestamp
);

event PersonHashZKVerified(bytes32 indexed personHash, address indexed prover);

event TokenRewardDistributed(
  address indexed miner,
  bytes32 indexed personHash,
  uint256 indexed versionIndex,
  uint256 reward
);

event TokenURIUpdated(uint256 indexed tokenId, address indexed owner, string oldURI, string newURI);

event EndorsementFeeUpdated(uint256 previousBps, uint256 newBps);

event CircuitVerifierSet(
  uint8 indexed purpose,
  uint32 indexed circuitId,
  address indexed adapter
);

event MetadataArchiveSet(address indexed archive);
```

`MetadataArchiveV1` separately emits:

```solidity
event MetadataStored(
  bytes32 indexed personHash,
  uint256 indexed versionIndex,
  address pointer,
  bytes32 payloadHash,
  uint32 payloadLength
);
```

#### Story Events

```solidity
event StoryChunkAdded(
  uint256 indexed tokenId,
  uint256 indexed chunkIndex,
  bytes32 chunkHash,
  address indexed editor,
  uint256 contentLength,
  uint8 chunkType,
  string attachmentCID
);

event StorySealed(
  uint256 indexed tokenId,
  uint256 totalChunks,
  bytes32 fullStoryHash,
  address indexed sealer
);
```

### Key Storage Mappings

```solidity
mapping(bytes32 => PersonVersion[]) public personVersions;                    // Person hash => versions array
mapping(bytes32 => mapping(bytes32 => bool)) public versionExists;            // Duplicate prevention
mapping(bytes32 => mapping(address => uint256)) public endorsedVersionIndex; // User endorsements
mapping(bytes32 => mapping(uint256 => uint256)) public versionEndorsementCount; // Vote counts
mapping(bytes32 => mapping(uint256 => ChildRef[])) public childrenOf;         // Parent-child relationships
mapping(uint256 => bytes32) public tokenIdToPerson;                           // NFT => person mapping
mapping(uint256 => uint256) public tokenIdToVersionIndex;                     // NFT => version mapping
mapping(uint256 => PersonCoreInfo) public nftCoreInfo;                        // NFT core data
mapping(bytes32 => mapping(uint256 => uint256)) public versionToTokenId;      // Version => NFT mapping
mapping(uint8 => mapping(uint32 => address)) public verifierRegistry;         // purpose => circuitId => adapter
address public metadataArchive;                                               // One-time protocol binding
```

### Access Control & Security

#### Permission Model

- **Open Submission**: Anyone can add person versions with valid ZK proofs
- **Endorsement Gating**: Requires DEEP utility point (ERC20) balance and allowance
- **NFT Holder Rights**: Exclusive story management and tokenURI updates
- **Immutability**: Sealed public stories and archived metadata blobs cannot be modified

#### Security Features

- **50+ Custom Errors**: Explicit revert reasons for all failure cases
- **Reentrancy Guards**: `ReentrancyGuardTransient` (EIP-1153) on all external value transfers
- **Input Validation**: Comprehensive parameter checking with constraints
- **Native-Currency Rejection**: Contract rejects direct native-currency transfers (ETH on Ethereum,
  CFX on Conflux eSpace; receive/fallback revert)
- **Permanent ZK Routing**: Each `(purpose,circuitId)` adapter route is once-set and can neither be
  replaced nor cleared; the contract never designates one route as current or newer
- **Opaque Archive Boundary**: DeepFamily checks only the fixed DFM1 common prefix and packed
  caller/self-suite binding; Archive and Reader do not interpret envelope formats
- **Atomic Version Storage**: proof verification, duplicate marking, version creation, and Archive
  write all succeed or revert in one transaction

## Upgradeability & Governance (UUPS)

`DeepFamily` is deployed as a **UUPS (ERC-1967) proxy**, so its logic can evolve while its address
and state persist. The other contracts are **not**
upgradeable by design: `DeepFamilyToken` (the value contract is kept minimal/immutable),
`MetadataArchiveV1`, `DeepFamilyReader` (immutable bindings; redeploy to change read logic), the ZK
verifiers, the verifier adapter, and the libraries.

### Proxy & Initialization

- The proxy is a thin `ERC1967Proxy` wrapper (`contracts/proxy/UUPSProxy.sol`).
- The implementation disables initializers in its constructor (`_disableInitializers()`), so the
  logic contract can never be initialized directly — only the proxy is, exactly once.
- `DeepFamily.initialize(token, initialOwner)` replaces the constructor. The token address, which
  was previously `immutable`, is now plain storage written once in
  `initialize` with no setter (effectively immutable; `immutable` is unusable behind a proxy).

### Upgrade Authorization & Governance

- Upgrades are gated by `_authorizeUpgrade(newImplementation) onlyOwner` on the proxy.
- Intended production owner is **`GovernanceTimelock`** (an OpenZeppelin `TimelockController`)
  whose `PROPOSER`/`CANCELLER` and `EXECUTOR` roles are held solely by a production **Safe Proxy**.
  The Safe approval policy decides _who_ can propose or execute; the Timelock separately
  enforces a public delay so the community can audit, exit, or cancel before a change lands.
- The same Timelock is the **DEEP protocol treasury**. Paid endorsements send their protocol share
  to `DeepFamily.owner()`, which is the Timelock in production. A treasury transfer is therefore a
  Timelock operation and must pass the Safe Proxy plus the configured delay. This token
  balance is unrelated to ERC-20 ownership: `DeepFamilyToken.owner()` remains `address(0)`.
- On live networks the deployment refuses to keep upgrade authority on an EOA:
  `GOVERNANCE_TIMELOCK_ADDRESS` identifies an already-deployed `GovernanceTimelock`, which must
  match the current runtime bytecode and have a non-zero delay. Ownership
  of `DeepFamily` is handed over after wiring. Local/simulated networks keep the deployer as
  `DeepFamily.owner()` for test flows.
- `DeepFamilyToken` is deliberately outside Timelock **administrative ownership**. Its deployer owner
  exists only to authorize the one-time reciprocal binding. A successful
  `token.initialize(DeepFamily)` atomically sets `owner()` to `address(0)` on every network; Token
  contract ownership is never transferred to the multisig or Timelock, and the binding cannot be
  changed afterward. The Timelock can still hold and transfer its own DEEP balance like any account.
- A Safe must not be assigned as `DeepFamily.owner()` directly: that would remove the Timelock
  delay. `GOVERNANCE_SAFE_ADDRESS` identifies the Safe Proxy contract. Live deployment requires it
  to contain contract code, expose
  `getOwners()` and `getThreshold()` state with threshold at least 2, and to be the sole holder of
  the timelock's `PROPOSER_ROLE`, `CANCELLER_ROLE`, and `EXECUTOR_ROLE`. It rejects EOAs,
  single-signer policies, lookalike contracts that merely expose `getMinDelay()`, open roles, and
  extra role holders.

The one-time `metadataArchive` setter and once-set verifier routes are protocol invariants expected
of every supported implementation. Because DeepFamily remains a governed UUPS proxy, a malicious
upgrade could deliberately violate storage semantics; the storage-layout and release gates reduce
accidental changes but are not an immutable trust root.

#### Protocol component order

A fresh deployment wires protocol components in this order:

```text
Token
→ Poseidon/age-gate libraries, both Groth16 verifiers, and their adapter
→ DeepFamily implementation and ERC-1967 proxy
→ initialize proxy and perform the one-time Token/DeepFamily binding
→ MetadataArchiveV1(proxy)
→ proxy.setMetadataArchive(archive) exactly once
→ DeepFamilyReader(proxy), after Archive binding
→ proxy.setCircuitVerifier(purpose,circuitId,adapter) for each permanent route
→ transfer DeepFamily ownership to the validated governance Timelock on live networks
→ verify proxy/implementation slot, Archive reverse binding, Reader immutables, routes,
  parameterized runtimes, and release-manifest hashes
```

The Archive must bind the proxy, not the implementation. Archive and Reader immutables change their
deployed runtime bytes, so release validation computes expected runtime hashes with the actual
deployment arguments rather than treating every instance as byte-identical.

#### Production setup

For a new Conflux eSpace Mainnet governance wallet, configure the approved deployer, exactly three
distinct EOA/hardware-wallet owner addresses in their final order, a fixed
`EVM_MAINNET_SAFE_SALT_NONCE`, and a separate Safe factory-call budget in
`EVM_MAINNET_SAFE_MAX_NATIVE`. The `espace:mainnet:*` command interprets that shared setting as CFX;
set it explicitly for the current plan/execution rather than carrying it across chains.
`GOVERNANCE_SAFE_PROFILE` selects the pinned implementation and three-owner, 2/3 policy; it is not
an address. Keep `GOVERNANCE_SAFE_ADDRESS` empty, then generate a read-only plan:

```bash
npm run espace:mainnet:safe:plan
```

The creator supports only canonical Safe v1.3.0, the exact ordered three-owner setup, and threshold
`2`. Owner order and salt both change the deterministic address. After independent review, pass the
exact printed digest to the explicit execute command:

```bash
npm run espace:mainnet:safe:execute -- --digest 0x...
```

Rerunning that command with the same digest safely resumes the one factory call. Only a hashless
checkpoint recovery adds `--recovery-tx 0xTransactionHash`. The creator reads only public addresses;
owner private keys, signatures, seed phrases, and keystores must remain in the controllers' external
signing system.

Before protocol release, two real owners must externally execute the documented refund-free
`0 CFX`, empty-calldata `CALL` to `EVM_MAINNET_EXPECTED_DEPLOYER`. Put the outer transaction
hash in `EVM_MAINNET_SAFE_ACCEPTANCE_TX` and run:

```bash
npm run espace:mainnet:safe:status
```

Only after that read-only validation should the reviewed Safe Proxy address be copied to
`GOVERNANCE_SAFE_ADDRESS`. Do not configure `GOVERNANCE_TIMELOCK_ADDRESS` for a fresh Mainnet
release: the orchestrator deploys and checkpoints the Timelock itself. That setting is reserved as
a temporary input for a later manual/reuse/upgrade command that explicitly needs an existing
Timelock. The release requires this acceptance to be the Safe's first and only
execution (`nonce == 1`); do not submit another Safe transaction before release planning and
execution finish.

Next reserve the deployer EOA, query its exact pending nonce, and freeze the manifest-ready eSpace
deployment projection before producing the final testnet rehearsal evidence:

```bash
npm run build
npm run espace:mainnet:release:projection -- \
  --deployer 0xReviewedDeployer \
  --nonce 123
```

Copy the output's exact `deployments` object into `protocol-release-manifest.json`, commit the
chain-specific release state, run `npm run release:preflight`, and rerun eSpace acceptance in
`release-rehearsal` mode from that exact commit. Any nonce, artifact, manifest, or commit drift
requires a new projection, preflight, and rehearsal. The release planner independently rejects a
chain ID, address, immutable, artifact, runtime, or stable-projection mismatch before broadcast.

Then run the protocol release plan command with its separate CFX budget, block-confirmation count,
finality timeout, and testnet evidence:

```bash
npm run espace:mainnet:release:plan
```

Before this command can plan a release, the development proving keys must have been replaced with
`npm run zk:production:setup` as described in [zk-ceremony.md](zk-ceremony.md), every generated
artifact must have been reviewed and committed together, `npm run release:preflight` must pass from
that clean commit, and a successful eSpace `release-rehearsal` must have automatically published the
exact schema-v5 `releaseReady=true` evidence to the chain-specific, Git-ignored
`tmp/release-evidence/espace-release-rehearsal.json`. The Mainnet release reads that fixed file
automatically and rejects a missing file or evidence from an older commit, a different artifact
input, or a different production `MIN_DELAY >= 86400`. Diagnostic, failed, and recovery acceptance
runs never overwrite the published evidence. The default ZK setup records one Phase 2 contributor
under `trustModel=single-operator`; this is
independent of the three-owner, 2/3 governance Safe.

Acceptance modes deliberately prove different things:

- `diagnostic` uses the built-in 30-second Testnet delay and runs all four real governance windows.
  It is fast lifecycle coverage and never release evidence.
- `release-rehearsal` deploys the initial production shape with `MIN_DELAY >= 86400`, but schedules
  no Timelock operation and waits zero Timelock windows. Its schema-v5 report contains no Mock,
  upgrade, or governance migration and records `evidenceType=initial-mainnet-release` with
  `governanceLifecycleIncluded=false`.
- a fresh Mainnet release follows the same zero-wait shape. Its 48-hour Timelock delay constrains
  the first future governance operation, not deployment itself.

The plan command is always read-only. After review, at least two current Safe owners sign the
complete printed EIP-191 plan-approval message externally. Store the printed digest and signatures
in the operation-specific, Git-ignored
`tmp/release-evidence/espace-mainnet-release-approval.json` file containing exactly these fields:

```json
{
  "planDigest": "0x...",
  "signatures": ["0xFirstOwnerSignature...", "0xSecondOwnerSignature..."]
}
```

Then execute or resume with:

```bash
npm run espace:mainnet:release:execute -- --approval-file tmp/release-evidence/espace-mainnet-release-approval.json
```

For a hashless protocol checkpoint, put the exact runner-label-to-transaction-hash mapping in a
separate Git-ignored `tmp/release-evidence/espace-mainnet-release-recovery.json` file and add
`--recovery-file tmp/release-evidence/espace-mainnet-release-recovery.json` to that execute command. The
orchestrator deploys and validates the Timelock before the protocol, records an atomic checkpoint,
verifies every source, waits for finalized coverage, and validates the terminal governance state.
It does not write test person/NFT/story data to Mainnet. Full configuration and recovery
instructions are in the
[eSpace Mainnet release runbook](espace-mainnet-release.md).

Ethereum uses a separate guarded profile rather than changing the eSpace command's network. The
equivalent fixed entries are:

```bash
# Destructive Sepolia acceptance; chain ID is fixed to 11155111.
npm run ethereum:acceptance

# Ethereum Mainnet Safe plan, digest-bound execute, and read-only owner-smoke validation.
npm run ethereum:mainnet:safe:plan
npm run ethereum:mainnet:safe:execute -- --digest 0x...
npm run ethereum:mainnet:safe:status

# Ethereum Mainnet protocol plan and approval-file-bound execute.
npm run ethereum:mainnet:release:plan
npm run ethereum:mainnet:release:execute -- --approval-file tmp/release-evidence/ethereum-mainnet-release-approval.json
```

The Ethereum production flow requires
`GOVERNANCE_SAFE_PROFILE=ethereum-safe-1.3.0-2of3`, a canonical Safe v1.3.0 L1 singleton,
exactly three ordered EOA owners with threshold `2`, ETH-denominated values in the shared
`EVM_MAINNET_SAFE_MAX_NATIVE` and `EVM_MAINNET_MAX_NATIVE` budget settings, a real Etherscan API key,
reviewed production ZK setup artifacts, and an exact Sepolia schema-v5 fresh-release rehearsal
report automatically published at the chain-specific, Git-ignored
`tmp/release-evidence/ethereum-release-rehearsal.json`. The Ethereum Mainnet release reads that fixed
file automatically and rejects it when missing or tied to an older commit; diagnostic, failed, and
recovery acceptance runs do not overwrite it. Safe planning and execution are separate commands;
the execute command requires the exact reviewed digest through `--digest`. Protocol release planning
and execution are also separate commands. Release execution requires an operation-specific approval
JSON file with the exact printed `planDigest` and distinct valid EIP-191 `signatures` from at least
two current Safe owners over the complete printed approval message. A Safe hashless-checkpoint
recovery uses `--recovery-tx`, while protocol recovery uses a separate runner-label-to-hash JSON file
at `tmp/release-evidence/ethereum-mainnet-release-recovery.json` through `--recovery-file`. These
transient authorization and recovery values do not belong in long-lived environment configuration.

As with eSpace, the repository never accepts a production Safe owner's private key. After Safe
deployment, two real owners must externally execute the exact refund-free zero-ETH smoke
transaction. `npm run ethereum:mainnet:safe:status` validates its public outer transaction hash;
the protocol release requires that smoke transaction to remain the Safe's first and only execution
(`nonce == 1`).

Complete Ethereum environment, digest review, execution, checkpoint and recovery instructions are
in the [Ethereum Mainnet release runbook](ethereum-mainnet-release.md). The local Sepolia
acceptance procedure is in `ethereum-sepolia-acceptance.local.md`.

For manual deployment on another supported network, or an explicitly reviewed recovery, deploy the
Timelock first with one Safe Proxy. The deploy script requires `MIN_DELAY` and
`GOVERNANCE_SAFE_ADDRESS` explicitly on every non-local network, validates the delay as a positive
safe integer, and checks the `getOwners()`/`getThreshold()` state. This confirms the reported threshold
and owners, but it does not independently attest the Safe implementation or bytecode; verify
the wallet deployment, signer policy, modules, and guards before funding or transferring ownership.

Conflux eSpace is an EVM-compatible execution environment within Conflux Network, not an Ethereum
L2. Its guarded flow rehearses on `confluxTestnet` and releases on `conflux`; the guarded Ethereum
flow rehearses on `sepolia` and releases on `mainnet`. EVM compatibility does not make their
production controls interchangeable. eSpace pins the canonical Safe v1.3.0 L2 singleton, CFX,
Conflux charging, Conflux RPC/ConfluxScan and `deployments/conflux/`; Ethereum pins the canonical
Safe v1.3.0 L1 singleton, ETH, receipt `gasUsed`, Sepolia Blockscout, Mainnet Etherscan and
`deployments/mainnet/`.
`CONFLUX_TESTNET_RPC_URL` and `CONFLUX_RPC_URL` override the corresponding eSpace RPC endpoint;
blank or whitespace-only values use the official public endpoints configured in the project.
`ETHEREUM_SEPOLIA_RPC_URL` and `ETHEREUM_MAINNET_RPC_URL` explicitly select Ethereum endpoints;
when blank, the project can derive them from `INFURA_API_KEY`.

The named `espace:*` and `ethereum:*` npm entries select immutable profiles in code and verify the
raw chain ID. Do not invoke lower-level entry scripts with an arbitrary `--network`, copy an
authorization digest between profiles, or point one profile at another chain. Safe singleton type,
plan-digest domain, currency budget, wallet derivation, gas accounting, explorer policy, report
directory and checkpoints all form part of the reviewed evidence.

Here `GOVERNANCE_SAFE_ADDRESS` is the Safe Proxy that receives the Timelock's proposer, canceller,
and executor roles. `GOVERNANCE_TIMELOCK_ADDRESS` is the already-deployed Timelock that becomes
`DeepFamily.owner()`; pass it only to the exact manual/reuse/upgrade command that needs it. Fresh
Mainnet release does not configure this address because its orchestrator deploys the Timelock.

The wrapper internally fixes the external admin to `address(0)`, makes role membership enumerable,
and restricts `grantRole`, `revokeRole`, and `renounceRole` to timelock self-calls. OpenZeppelin's
timelock still grants `DEFAULT_ADMIN_ROLE` to itself, so roles can be migrated, but only by scheduling
and executing a delayed timelock operation. A zero delay is rejected both initially and on updates.

```bash
# Advanced stepwise example: temporary overrides using the actual testnet Safe Proxy.
MIN_DELAY=172800 GOVERNANCE_SAFE_ADDRESS=0xSafeProxy... \
  npm run deploy:timelock --net=confluxTestnet

# Use the resulting Timelock address, not the Safe Proxy, as the protocol owner.
GOVERNANCE_TIMELOCK_ADDRESS=0xTimelock... GOVERNANCE_SAFE_ADDRESS=0xSafeProxy... \
  npm run deploy:net --net=confluxTestnet
```

`deploy:timelock`, `deploy:net`, and one-contract `verify:net` do not provide the mainnet
orchestrator's single release digest, cross-phase checkpoint, automatic complete verification,
finalized coverage, or terminal-state report. Do not mix manual commands with an active
guarded checkpoint: `deployments/conflux/mainnet-release-state.json` for eSpace or
`deployments/mainnet/mainnet-release-state.json` for Ethereum.

To verify contracts on ConfluxScan, run for example
`npm run verify:net --net=confluxTestnet -- 0xContractAddress`, appending constructor arguments
when that contract has them.
When `EXPLORER_API_KEY` is blank, the configuration supplies ConfluxScan's non-secret `espace`
placeholder automatically. Sepolia uses Hardhat's API-key-free Blockscout provider:
`npm run verify:net --net=sepolia -- 0xContractAddress`.
Ethereum Mainnet retains Etherscan and requires a real `EXPLORER_API_KEY`; do not reuse the
Conflux placeholder for Mainnet verification.

Only in-process simulated networks and the explicitly named `localhost` network permit the local
defaults (`MIN_DELAY=120` with the deployer as role holder). A remote HTTP network is treated as live
even if it uses chain ID 31337.

#### General owner operations

Use `governance-schedule` and `governance-execute` for ordinary `onlyOwner` configuration. For
example, `updateEndorsementFee(750)` sets the protocol fee to 750 basis points (7.5%):

```bash
npx hardhat --config hardhat.config.mjs governance-schedule --network confluxTestnet \
  --target main --function updateEndorsementFee --args '[750]'

# Run only after the schedule transaction is mined and the configured delay has elapsed.
npx hardhat --config hardhat.config.mjs governance-execute --network confluxTestnet \
  --target main --function updateEndorsementFee --args '[750]'

# Cancel a still-pending governance or upgrade operation using its printed operation ID.
npx hardhat --config hardhat.config.mjs governance-cancel --network confluxTestnet \
  --target main --operation-id 0x...
```

The two commands must use exactly the same target, function, arguments, and optional `--salt`; these
values derive the operation ID. Omitting `--salt` uses a deterministic value. To schedule the exact
same call again after it has already executed, provide a new bytes32 salt to both commands. Function
arguments are a JSON array; quote large integers as strings so JavaScript cannot round them. A full
signature such as `updateEndorsementFee(uint256)` can be used if a function name is overloaded.

The task resolves only allowlisted deployment targets (`main`), encodes calls against the recorded
ABI, fixes the native-currency value and predecessor to zero, requires at least the timelock minimum
delay, and simulates the target call before scheduling unless `--skip-simulation` is explicitly
supplied. It does not accept an arbitrary destination or raw calldata. `upgradeTo`, `upgradeToAndCall`,
`transferOwnership`, and `renounceOwnership` are rejected: upgrades must pass the dedicated storage
and bytecode checks below, ownership transfers must use the validated migration process, and
renouncing ownership is reserved for an independently constructed and audited final-exit operation.

When the configured CLI signer has the required Timelock role, the task sends the transaction. When
the role belongs to a multisig—or no local private key is configured—it prints `to`, `value`, `data`,
and `operation` for submission through that wallet. The delay starts when the Timelock schedule
transaction is mined, not when the multisig transaction is first proposed.

#### Protocol treasury

The current `GovernanceTimelock` is both `DeepFamily.owner()` and the receiver of the protocol share
of each paid endorsement. Use the read-only status task to verify the Timelock and Token runtimes,
the DeepFamily/Token binding, the Timelock role policy, and its DEEP balance. The report prints both
the raw token-unit balance and its human-readable value, together with symbol/decimals, raw/formatted
total supply, minimum delay, and the multisig threshold:

```bash
npx hardhat --config hardhat.config.mjs treasury-status --network confluxTestnet \
  --contract-name GovernanceTimelock --token-contract-name DeepFamilyToken
```

To transfer 125.5 DEEP from the treasury to a reviewed non-zero recipient, schedule and execute the
same operation through the Safe Proxy:

```bash
npx hardhat --config hardhat.config.mjs treasury-transfer --network confluxTestnet \
  --phase schedule --recipient 0xRecipient... --amount 125.5 \
  --contract-name GovernanceTimelock --token-contract-name DeepFamilyToken

# Run after the multisig's schedule transaction is mined and the delay has elapsed.
npx hardhat --config hardhat.config.mjs treasury-transfer --network confluxTestnet \
  --phase execute --recipient 0xRecipient... --amount 125.5 \
  --contract-name GovernanceTimelock --token-contract-name DeepFamilyToken
```

`--amount` is a human-readable decimal DEEP amount, not the raw 18-decimal integer. The task rejects
zero recipients, the Timelock/Token/DeepFamily addresses as recipients, zero amounts, insufficient
treasury balances, arbitrary tokens, and arbitrary targets. It always resolves
`deployments/<network>/DeepFamilyToken.json`, verifies the exact selected Token and Timelock runtimes
and their binding, and encodes `DeepFamilyToken.transfer(recipient, amount)`. Schedule and execute
must use identical recipient, amount, optional `--salt`, and artifact arguments. Omitting `--salt`
derives a deterministic call-bound value. Scheduling does not reserve DEEP; execution re-checks the
live balance. If the CLI signer lacks the required role, each phase prints generic `to`, `value`,
`data`, and `operation` fields for submission through the Safe Proxy.

This treasury design deliberately puts protocol spending behind the same approval threshold and
public delay as administrative changes. Do not send unrelated or unsupported assets to the
Timelock: the dedicated tooling only manages the deployed DEEP token.

#### Final governance exit

`DeepFamily.renounceOwnership()` is retained at the contract layer, but the ordinary governance
tasks intentionally reject it. Renouncing is not automatically equivalent to decentralization; it
is an irreversible decision to freeze the current implementation and all owner-controlled policy.
After execution, upgrades, new verifier-route registrations, protocol-fee changes, ownership migration, and every
other `onlyOwner` operation become permanently unavailable. Future protocol fee shares are burned
because `owner()` is `address(0)`, while DEEP already held by the Timelock is not automatically
transferred or burned.

There is intentionally no convenience task for this operation. If a final, immutable protocol is a
documented governance objective, first complete an end-state audit, decide and execute the treasury
disposition, publish the exact consequences and calldata, and obtain explicit Safe-owner approval.
Only then construct the raw Timelock `schedule` and `execute` calls for `renounceOwnership()` and
wait the full configured delay. Losing keys or accidentally executing this call provides no recovery
path and must not be treated as a routine maintenance action.

#### Governance status and lifecycle maintenance

Inspect the current Timelock runtime, delay, complete enumerable role membership, inferred multisig
threshold/owners, and an optional operation ID without changing state:

```bash
npx hardhat --config hardhat.config.mjs timelock-status --network confluxTestnet
npx hardhat --config hardhat.config.mjs timelock-status --network confluxTestnet \
  --contract-name GovernanceTimelock --operation-id 0x...
```

The report is marked `DANGER` for a runtime mismatch, zero delay, non-self admin, extra/open/split
role membership, a codeless role holder, an invalid multisig inspection response, a multisig
threshold below 2, a non-zero `DeepFamilyToken.owner()`, or broken bidirectional wiring.
The inspection interface cannot prove the wallet implementation or that a module/guard cannot bypass
the advertised threshold; verify those separately. `--contract-name` defaults to the
current `GovernanceTimelock` artifact and can select a retained versioned artifact for an older
deployment.

If the selected artifact does not expose the required Timelock inspection ABI, the task fails
instead of producing a partial status report.

Replace the Timelock's sole governance Safe Proxy using one atomic batch. The batch first grants all
three roles to the inspected new Safe Proxy, then revokes all three from the expected old Safe
Proxy.
The task rejects a codeless or threshold-1 replacement, unexpected existing role membership, a
non-self admin, and a runtime that does not match the selected `--contract-name` artifact:

```bash
npx hardhat --config hardhat.config.mjs timelock-migrate-multisig --network confluxTestnet \
  --contract-name GovernanceTimelock --phase schedule \
  --old-multisig 0xOldMultisig... --new-multisig 0xNewMultisig...

# Run after the schedule transaction is mined and its delay has elapsed.
npx hardhat --config hardhat.config.mjs timelock-migrate-multisig --network confluxTestnet \
  --contract-name GovernanceTimelock --phase execute \
  --old-multisig 0xOldMultisig... --new-multisig 0xNewMultisig...
```

Use the same optional `--salt` in both phases. `--delay` may be supplied to the schedule phase but
cannot be below the current minimum. Pass the new `GOVERNANCE_SAFE_ADDRESS` to subsequent operator
commands only after the execute transaction and final role state are confirmed. Changing owners or
threshold _inside the same Safe Proxy address_ is a wallet-internal operation and is not delayed by
this Timelock.

Change the minimum delay through a Timelock self-call. The update itself is always scheduled using
the current delay; zero and no-op values are rejected. Raising the delay does not extend operations
that were already scheduled:

```bash
npx hardhat --config hardhat.config.mjs timelock-update-delay --network confluxTestnet \
  --contract-name GovernanceTimelock --phase schedule --new-delay 259200
npx hardhat --config hardhat.config.mjs timelock-update-delay --network confluxTestnet \
  --contract-name GovernanceTimelock --phase execute --new-delay 259200
```

To replace the Timelock contract, first deploy a new `GovernanceTimelock` using the intended new
Safe Proxy as a one-command override. Keep the persistent operator environment pointed at the old
governance until migration is confirmed:

```bash
MIN_DELAY=259200 GOVERNANCE_SAFE_ADDRESS=0xNewSafeProxy... \
  npm run deploy:timelock --net=confluxTestnet
```

Then migrate governance and the DEEP treasury in one atomic `scheduleBatch`/`executeBatch`. The
batch has exactly two calls in this order: `DeepFamily.transferOwnership(newTimelock)`, followed by
an old-Timelock self-call to `sweepERC20(DEEP, newTimelock)`. The sweep reads the complete old
Timelock balance during execution, so it includes protocol fees received while the delay was
running; a zero balance is also valid. `DeepFamilyToken.owner()` remains zero throughout. The
following example redeploys the same runtime. For a code-changing V1-to-V2 migration, replace the
two Timelock artifact arguments with the separately retained versioned artifact names:

```bash
npx hardhat --config hardhat.config.mjs timelock-migrate-owner --network confluxTestnet \
  --phase schedule --old-timelock 0xOldTimelock... --new-timelock 0xNewTimelock... \
  --old-multisig 0xOldMultisig... --new-multisig 0xNewMultisig... \
  --old-contract-name GovernanceTimelock --new-contract-name GovernanceTimelock \
  --proxy-contract-name UUPSProxy --deep-family-contract-name DeepFamily \
  --token-contract-name DeepFamilyToken

npx hardhat --config hardhat.config.mjs timelock-migrate-owner --network confluxTestnet \
  --phase execute --old-timelock 0xOldTimelock... --new-timelock 0xNewTimelock... \
  --old-multisig 0xOldMultisig... --new-multisig 0xNewMultisig... \
  --old-contract-name GovernanceTimelock --new-contract-name GovernanceTimelock \
  --proxy-contract-name UUPSProxy --deep-family-contract-name DeepFamily \
  --token-contract-name DeepFamilyToken
```

This migration requires explicit expected old/new Safe Proxy addresses and explicit artifacts for both
Timelocks, the proxy, the current `DeepFamily` implementation, and the token. It verifies every
selected runtime, both exact role policies and multisig thresholds, non-zero delays, bidirectional
proxy/token wiring, `DeepFamily.owner() == oldTimelock`, and `DeepFamilyToken.owner() == address(0)`.
The old selected Timelock artifact must expose the self-call-only
`sweepERC20(address,address)` function. Keep audited, version-named source/artifacts for every
deployed Timelock; the old and new contracts are deliberately verified independently—for example,
as `GovernanceTimelockV1` and `GovernanceTimelockV2`—and there is no unsafe bypass.
It rejects a new Timelock whose delay is shorter than the old one. If a shorter delay is an
intentional governance decision, first execute `timelock-update-delay` on the old Timelock, then
deploy the replacement with a delay at least equal to that approved value. Pass the new
`GOVERNANCE_TIMELOCK_ADDRESS` to later operator commands only after the ownership and treasury
migration is confirmed. Do not persist this migration override in a fresh-release environment. A directly sent DEEP
dust balance that arrives at the old Timelock after execution is not part of the already-completed
migration and is reported separately rather than making the completed operation appear to fail.

All lifecycle and treasury mutating tasks require an explicit `--phase schedule|execute`, derive a
call-bound deterministic salt, check operation state, and print generic `to/value/data/operation`
fields when no local role-holder signer is available. Preserve the printed
addresses, salt, and operation ID in the governance record. A pending lifecycle operation can be
cancelled with `governance-cancel` while the old Timelock still owns `main`.

### Storage-Layout Safety

- All upgradeable bases use OpenZeppelin v5 **ERC-7201 namespaced storage**, so each leaf contract's
  own variables are the only sequential storage. New state in a future implementation is added by
  **appending variables after the existing ones** (append-only). The leaf contracts intentionally
  carry **no `__gap`** — for a leaf with namespaced parents a gap adds no protection that the
  append-only checker doesn't already provide.
- `npm run storage:check` (`scripts/check-storage-layout.mjs`) diffs the current layout against the
  committed baselines in `storage-layouts/*.json`, and additionally runs a positive mock
  (`DeepFamilyV2Mock` must pass) and a negative mock (`UnsafeUpgradeMock` must fail) so the checker
  cannot silently break. It is part of `npm run contracts:check`.
- The `upgrade-schedule` / `upgrade-execute` Hardhat tasks (`tasks/upgrade-schedule.mjs`,
  `tasks/upgrade-execute.mjs`) additionally validate the _specific_ candidate implementation against
  the proxy baseline and verify the on-chain runtime bytecode (metadata-stripped, library-linked)
  before staging an upgrade through the timelock. When `upgrade-schedule` deploys a candidate, it
  prints an exact source-verification command and exits without scheduling; after explorer
  verification succeeds, rerun with that address in `--implementation` to create the operation.
- The current baseline includes the single `metadataArchive` slot and the `PersonVersion`
  `versionCommitment` field. A supported implementation must not move, reuse, clear, or reinterpret
  that Archive binding, and must not reintroduce the retired plaintext version fields.

### Reentrancy Guard

`DeepFamily` uses OpenZeppelin's **`ReentrancyGuardTransient`** (EIP-1153 transient storage). It has
no constructor and no persistent storage, so it is proxy-safe without an initializer, occupies no
storage-layout slots, and is cheaper than the storage-based guard. This requires Cancun-capable
chains (all current targets — Ethereum, Conflux eSpace ≥ v3.0, local Hardhat — support EIP-1153).

### Build Requirements

The upgradeable stack requires **solc 0.8.28**, **`viaIR` enabled**, and **`evmVersion: cancun`**
(OpenZeppelin 5.6 emits `MCOPY`, and `ReentrancyGuardTransient` uses `TSTORE`/`TLOAD`). Ethereum's
EIP-170 deployed-code limit is 24,576 bytes, while Conflux eSpace permits 49,152 bytes. The project
still treats the stricter 24,576-byte ceiling as its conservative cross-network build budget;
without `viaIR`, the `DeepFamily` implementation exceeds that portable budget. The compiler also
emits `storageLayout` so the upgrade-safety checker can diff proxy contracts.

See the official Conflux documentation for the
[eSpace EVM compatibility differences](https://doc.confluxnetwork.org/docs/espace/build/evm-compatibility/)
and the [v3.0 transient-storage fix](https://doc.confluxnetwork.org/docs/general/hardforks/v3.0/).

`UNLIMITED_SIZE=true` relaxes the size check only for the local Hardhat development network. It does
not change any live network's code-size rules and must not be used to reason that a Conflux eSpace or
Ethereum deployment is unlimited.

## DeepFamilyToken.sol - DEEP ERC20 Utility Point

**Location**: `contracts/DeepFamilyToken.sol`
**Description**: Standard ERC20 utility point with progressive halving issuance mechanics for family tree protocol incentives.

> Disclaimer: The DEEP token is solely a platform utility point used to access and operate DeepFamily functionality. It carries no investment attributes, makes no promise of profit or returns, and must not be used to initiate fundraising, wealth‑management, investment plans, or speculative trading of any kind.

### Mining Constants

```solidity
uint256 public constant MAX_SUPPLY = 100_000_000_000e18;  // 100 billion cap
uint256 public constant INITIAL_REWARD = 113_777e18;      // Initial reward
uint256 public constant FIXED_LENGTH = 100_000_000;      // Fixed cycle length after 9th cycle

uint256[] public cycleLengths = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000];
```

### Progressive Halving Mechanics

**Cycle Progression**:

- Cycles: 1 → 10 → 100 → 1K → 10K → 100K → 1M → 10M → 100M → Fixed 100M
- Each cycle completion halves reward via bit shifting: `INITIAL_REWARD >> cycleIndex`
- Mining stops when the live supply reaches `MAX_SUPPLY` or integer right-shifting makes the next reward zero
- `MAX_SUPPLY` is a hard live-supply ceiling, not a guaranteed final issuance target
- Maximum supply is capped at `100 billion DEEP`; actual scheduled mining issuance may be slightly lower because halvings use integer arithmetic
- Because the cap checks `totalSupply()`, burns create an equal amount of live-supply headroom; the remaining reward schedule and `totalAdditions` still limit subsequent minting

**Reward Calculation**:

```solidity
function getReward(uint256 recordCount) public view returns (uint256) {
  if (recordCount == 0) revert InvalidRecordCount();

  uint256 cycleIndex;
  uint256 countLeft = recordCount;

  // Determine cycle index based on record count
  for (uint256 i = 0; i < cycleLengths.length; i++) {
    uint256 len = cycleLengths[i];
    if (countLeft <= len) {
      cycleIndex = i;
      break;
    }
    countLeft -= len;

    // Handle post-9th cycle fixed lengths
    if (i == cycleLengths.length - 1) {
      uint256 extraCycles = (countLeft - 1) / FIXED_LENGTH + 1;
      cycleIndex = i + extraCycles;
      break;
    }
  }

  return INITIAL_REWARD >> cycleIndex;
}
```

### Core Functions

#### Initialization

```solidity
function initialize(address _deepFamilyContract) external
```

- Performs an explicit owner check and can run only once; the deployer owner exists only before binding
- Registers authorized DeepFamily contract address
- Rejects zero addresses, EOAs, contracts that do not expose the expected token binding, and DeepFamily contracts configured for a different token
- On success, automatically transfers Token ownership to `address(0)` in the same transaction
- The Token is never owned by governance and cannot be rebound after initialization
- Do not manually call inherited ownership-transfer/renounce functions during bootstrap; use the integrated deployment so binding and owner retirement occur atomically
- Prevents unauthorized minting after deployment

#### Mining

```solidity
function mint(address miner) external onlyDeepFamilyContract returns (uint256 reward)
```

- **Callable only by DeepFamily contract**
- Checks reward calculation for next addition index
- Enforces MAX_SUPPLY cap with partial reward if needed
- Updates `totalAdditions` counter and `recentReward` for endorsement pricing
- Returns 0 when `MAX_SUPPLY` is reached or the next integer reward is zero

#### View Functions

```solidity
function recentReward() external view returns (uint256)  // Latest minted amount
function getReward(uint256 recordCount) public view returns (uint256)  // Reward for specific index
```

### State Variables

| Variable             | Type    | Purpose                                          |
| -------------------- | ------- | ------------------------------------------------ |
| `deepFamilyContract` | address | Authorized minting contract                      |
| `initialized`        | bool    | Prevents re-initialization                       |
| `totalAdditions`     | uint256 | Count of successful reward-generating additions  |
| `recentReward`       | uint256 | Latest minted amount (used for endorsement fees) |

### Events

```solidity
event MiningReward(address indexed miner, uint256 reward, uint256 totalAdditions);
```

### Access Control

**Restricted Functions**:

- `mint()`: Protected by `onlyDeepFamilyContract` modifier
- `initialize()`: Owner-only before binding; success permanently leaves `owner() == address(0)`

**Security Features**:

- Hard live-supply cap enforcement (never exceeds 100B utility points)
- Progressive halving ensures controlled supply distribution
- One-time contract-code and reciprocal token-binding validation
- Automatic owner removal after binding eliminates residual Token administration
- Custom error types for precise debugging
- OpenZeppelin's secure ERC20 base implementation

## ZK Verifier Contracts

### PersonCommitmentVerifier.sol

**Purpose**: Validates person identity commitments and optional parent commitments for `addPersonVersion()`
**Public Signals**: 5 values (`identityCommitment`, `fatherIdentityCommitment`,
`motherIdentityCommitment`, `submitterAndSelfSuiteId`, `versionCommitment`)
**Verification**: Groth16 proof with circuit `person_commitment.circom`

### DisclosureBindingVerifier.sol

**Purpose**: Validates mint disclosure binding for `mintPersonVersionNFT()`
**Public Signals**: 4 values (`identityCommitment`, `disclosureBinding`, `minter`,
`suiteCommitment`)
**Verification**: Groth16 proof with circuit `disclosure_binding.circom`

Both verifiers are auto-generated from circom circuits. DeepFamily does not call them directly;
the permanent `(purpose,circuitId)` route selects an `IProofVerifierAdapter`. Encoding ID `1`
requires a 256-byte ABI encoding of Groth16 `a/b/c`, and the adapter forwards to the typed verifier:

```solidity
// PersonCommitmentVerifier (5 public signals)
function verifyProof(
  uint256[2] calldata a,
  uint256[2][2] calldata b,
  uint256[2] calldata c,
  uint256[5] calldata publicSignals
) external view returns (bool);

// DisclosureBindingVerifier (4 public signals)
function verifyProof(
  uint256[2] calldata a,
  uint256[2][2] calldata b,
  uint256[2] calldata c,
  uint256[4] calldata publicSignals
) external view returns (bool);
```

## Contract Security Summary

### Comprehensive Error Handling

All contracts implement extensive custom error types for precise debugging:

**DeepFamily.sol Errors** (50+ types):

```solidity
// Input validation errors
error InvalidPersonHash();
error InvalidVersionIndex();
error InvalidFullName();
error InvalidZKProof();

// Business logic errors
error DuplicateVersionCommitment();
error MustEndorseVersionFirst();
error VersionAlreadyMinted();

// Access control errors
error MustBeNFTHolder();
error StoryAlreadySealed();
error TokenContractNotSet();
```

### Security Patterns

- **Reentrancy Guards**: External value transfers protected via OpenZeppelin `ReentrancyGuardTransient` (EIP-1153 transient storage; proxy-safe, no initializer)
- **Upgradeability**: `DeepFamily` is a UUPS proxy; upgrades are gated by `_authorizeUpgrade` (timelock-owned) and storage-layout safety checks (see [Upgradeability & Governance (UUPS)](#upgradeability--governance-uups))
- **Input Validation**: Comprehensive parameter checking with custom constraints
- **Access Control**: Role-based permissions with explicit error types
- **Immutability Controls**: Sealed stories and initialized contracts prevent further modification
- **Domain Separation**: domain constants (1000–1004) in Poseidon inputs + Keccak wrapping for
  `personHash` and a distinct Keccak domain for `versionHash`

### Gas Optimization Features

- **Struct Packing**: Optimized storage layout (`address` + `uint96` timestamp in single slot)
- **Paginated Queries**: All list functions support efficient pagination with `MAX_QUERY_PAGE_SIZE`
- **Event-Driven Architecture**: Frontend synchronization via indexed blockchain events
- **Field-Native Public Signals**: Current ZK flows expose full field-element commitments instead of limb pairs
- **Batch-Ready Design**: Functions designed for future batch operation implementations
