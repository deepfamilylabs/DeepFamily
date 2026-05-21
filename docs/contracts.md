# Smart Contracts Reference

## DeepFamily.sol - Core Protocol Contract

**Location**: `contracts/DeepFamily.sol`
**Description**: Main family tree protocol implementing multi-version person management, ZK-proof verification, community endorsement, NFT minting, and story sharding.

### Critical Constants

| Constant | Value | Purpose & Impact |
|----------|-------|------------------|
| `MAX_LONG_TEXT_LENGTH` | 256 | Max length for tags, IPFS CIDs, names, places, stories |
| `MAX_QUERY_PAGE_SIZE` | 200 | Gas-optimized pagination limit for all query functions |
| `MAX_CHUNK_CONTENT_LENGTH` | 2048 | Story chunk size limit (≈2KB per shard) |
| `PROTOCOL_FEE_BPS_MAX` | 2000 | Maximum protocol endorsement fee (20%) |
| `FEE_BPS_DENOMINATOR` | 10000 | Basis-point denominator for fee accounting |
| `MINIMUM_MINT_AGE` | 18 | Minimum age required for NFT minting |

### Core Data Structures

#### PersonBasicInfo
```solidity
struct PersonBasicInfo {
    bytes32 identityCommitment; // bytes32 form of IdentityCommitment
    bool isBirthBC;             // Birth era flag
    uint16 birthYear;           // Birth year (0=unknown)
    uint8 birthMonth;           // Birth month (1-12, 0=unknown)
    uint8 birthDay;             // Birth day (1-31, 0=unknown)
    uint8 gender;               // Gender (0=unknown, 1=male, 2=female, 3=other)
}
```

`identityCommitment` is the contract-facing identity anchor. It is derived off-chain from:

- canonicalized full name
- `derivedSecretField`
- packed birth / gender fields
- `schemaVersion`, `cryptoSuiteVersion`, and `hashAlgoId`

#### PersonVersion
```solidity
struct PersonVersion {
    bytes32 personHash;          // keccak256(bytes32(identityCommitment))
    bytes32 fatherHash;          // Father's person hash
    bytes32 motherHash;          // Mother's person hash
    uint256 versionIndex;        // Version index (starts from 1)
    uint256 fatherVersionIndex;  // Father's version reference (0=unspecified)
    uint256 motherVersionIndex;  // Mother's version reference (0=unspecified)
    address addedBy;             // Contributor address (packed with timestamp)
    uint96 timestamp;            // Addition timestamp (packed with addedBy)
    string tag;                  // Version tag/description
    string metadataCID;          // IPFS metadata CID
}
```

#### PersonCoreInfo
```solidity
struct PersonCoreInfo {
    PersonBasicInfo basicInfo;         // Hash-based identity
    PersonSupplementInfo supplementInfo; // Human-readable data
}

struct PersonSupplementInfo {
    string fullName;      // Full name (revealed for NFT)
    string birthPlace;    // Birth place
    bool isDeathBC;       // Death era flag
    uint16 deathYear;     // Death year (0=unknown)
    uint8 deathMonth;     // Death month (0-12, 0=unknown)
    uint8 deathDay;       // Death day (0-31, 0=unknown)
    string deathPlace;    // Death place
    string story;         // Life story summary
}
```

#### Story Sharding Structures
```solidity
struct StoryChunk {
    uint256 chunkIndex;   // Chunk index (starts from 0)
    bytes32 chunkHash;    // keccak256(content)
    string content;       // Chunk content (≤2048 bytes)
    uint256 timestamp;    // Creation/update timestamp
    address editor;       // Last editor address
    uint8 chunkType;      // Classification (0=narrative, 1=quote, ...)
    string attachmentCID; // Optional external attachment CID
}

struct StoryMetadata {
    uint256 totalChunks;     // Current total chunks
    bytes32 fullStoryHash;   // Rolling hash keccak(previousHash, chunkIndex, chunkHash)
    uint256 lastUpdateTime;  // Last update timestamp
    bool isSealed;           // Immutability flag
    uint256 totalLength;     // Total character count
}
```

### Core Hash Computation

The active system derives person hashes as follows:

1. Off-chain code computes `identityCommitment`
2. The contract derives `personHash` as `keccak256(bytes32(identityCommitment))`
3. Parent references are validated against wrapped parent commitments

The mint flow also computes a separate `disclosureBinding` from the disclosed full name and the same packed birth / suite metadata.

### Core Functions

#### ZK-Proof Person Addition
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

**Verification Process**:
1. Validates `publicSignals.submitter == uint256(uint160(msg.sender))`
2. Calls the registered `PersonCommitmentVerifier`
3. Wraps each non-zero identity commitment as `keccak256(bytes32(identityCommitment))`
4. Uses the proof-derived parent hashes plus the provided parent version indices to update lineage links
5. Routes to `_addPersonInternal()` for family tree update

#### Community Endorsement
```solidity
function endorseVersion(
    bytes32 personHash,
    uint256 versionIndex,
    AttestationRef calldata attestationRef
) external
```

**Endorsement Mechanics**:
- Endorsers pay `recentReward` amount in DEEP utility points (ERC20)
- **Fee Distribution**: Majority flows to NFT holder (if minted) or original contributor, with a small protocol share (default 5%, max 20%) for sustainability
- Protocol share goes to contract owner or burned if ownership renounced
- Each account can endorse only one version per person
- Switching endorsements rebalances vote counts
- Phase 3 requires `attestationRef` to bind high-trust endorsement references to this action

#### NFT Minting with Disclosure Proof
```solidity
function mintPersonVersionNFT(
    ProofEnvelope calldata proof,
    DisclosureBindingPublicSignals calldata publicSignals,
    uint256 versionIndex,
    string calldata _tokenURI,
    PersonCoreInfo calldata coreInfo,
    AttestationRef calldata attestationRef
) external nonReentrant
```

**Minting Requirements**:
1. Caller must have endorsed this version
2. `DisclosureBindingVerifier.verifyProof()` must succeed
3. `publicSignals.identityCommitment` must match `coreInfo.basicInfo.identityCommitment`
4. `publicSignals.disclosureBinding` must match the contract's recomputed disclosure binding
5. `publicSignals.minter` must equal `uint256(uint160(msg.sender))`
6. `personHash` is derived from `publicSignals.identityCommitment`
7. `_enforceAdult(coreInfo.basicInfo)` must pass
8. Phase 3 `attestationRef` must match the mint action digest and version subject

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
function sealStory(uint256 tokenId, AttestationRef calldata attestationRef) external
```

**Story Management**:
- Only NFT holders can append chunks
- Chunks must be added sequentially starting from index 0
- Content hash validation prevents corruption
- Optional `chunkType` classifies content (narrative/quote/etc.)
- Optional `attachmentCID` links to decentralized media evidence
- Sealing makes stories permanently immutable
- Phase 3 `attestationRef` binds the seal to the token and current story hash

**chunkType Mapping**

| Value | Meaning |
|-------|---------|
| 0 | Narrative (primary storyline) |
| 1 | Work / Achievement |
| 2 | Quote |
| 3 | Media (photo/audio/video notes) |
| 4 | Timeline event |
| 5 | Commentary |
| 6 | Source / citation |
| 7 | Correction |
| 8 | Editorial note |

### Query Functions (Paginated)

#### Version Queries
```solidity
function getVersionDetails(bytes32 personHash, uint256 versionIndex) external view returns (PersonVersion memory, uint256, uint256)
function listPersonVersions(bytes32 personHash, uint256 offset, uint256 limit) external view returns (PersonVersion[] memory, uint256, bool, uint256)
```

#### Family Tree Queries
```solidity
function listChildren(bytes32 parentHash, uint256 parentVersionIndex, uint256 offset, uint256 limit) external view returns (bytes32[] memory, uint256[] memory, uint256, bool, uint256)
```

#### NFT Queries
```solidity
function getNFTDetails(uint256 tokenId) external view returns (bytes32, uint256, PersonVersion memory, PersonCoreInfo memory, uint256, string memory)
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
event PersonVersionAdded(bytes32 indexed personHash, uint256 indexed versionIndex, address indexed addedBy, uint256 timestamp, bytes32 fatherHash, uint256 fatherVersionIndex, bytes32 motherHash, uint256 motherVersionIndex, string tag);

event PersonVersionEndorsed(bytes32 indexed personHash, address indexed endorser, uint256 versionIndex, address recipient, uint256 recipientShare, address protocolRecipient, uint256 protocolShare, uint256 endorsementFee, uint256 timestamp);

event EndorsementCancelled(bytes32 indexed personHash, address indexed user, uint256 versionIndex, uint256 timestamp);

event PersonNFTMinted(bytes32 indexed personHash, uint256 indexed tokenId, address indexed owner, uint256 versionIndex, string tokenURI, uint256 timestamp);

event PersonHashZKVerified(bytes32 indexed personHash, address indexed prover);

event TokenRewardDistributed(address indexed miner, bytes32 indexed personHash, uint256 indexed versionIndex, uint256 reward);

event TokenURIUpdated(uint256 indexed tokenId, address indexed owner, string oldURI, string newURI);

event EndorsementFeeUpdated(uint256 previousBps, uint256 newBps);

event VerifierUpdated(uint16 indexed proofSystemId, uint8 indexed purpose, address verifier);
```

#### Story Events
```solidity
event StoryChunkAdded(uint256 indexed tokenId, uint256 indexed chunkIndex, bytes32 chunkHash, address indexed editor, uint256 contentLength, uint8 chunkType, string attachmentCID);

event StorySealed(uint256 indexed tokenId, uint256 totalChunks, bytes32 fullStoryHash, address indexed sealer);
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
```

### Access Control & Security

#### Permission Model
- **Open Submission**: Anyone can add person versions with valid ZK proofs
- **Endorsement Gating**: Requires DEEP utility point (ERC20) balance and allowance
- **NFT Holder Rights**: Exclusive story management and tokenURI updates
- **Immutability**: Sealed stories cannot be modified by anyone

#### Security Features
- **50+ Custom Errors**: Explicit revert reasons for all failure cases
- **Reentrancy Guards**: Protection on all external value transfers
- **Input Validation**: Comprehensive parameter checking with constraints
- **ETH Rejection**: Contract rejects direct ETH transfers (receive/fallback revert)
- **ZK Proof Validation**: Verifier registry routes person and name-disclosure proofs by proof purpose

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
- Mining continues indefinitely with progressively smaller rewards until MAX_SUPPLY is reached
- Final supply: approaches 100 billion DEEP (rewards continue halving asymptotically)

**Reward Calculation**:
```solidity
function getReward(uint256 recordCount) public view returns (uint256) {
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
function initialize(address _deepFamilyContract) external onlyOwner
```
- Owner-only, single-use function
- Registers authorized DeepFamily contract address
- Prevents unauthorized minting after deployment

#### Mining
```solidity
function mint(address miner) external onlyDeepFamilyContract returns (uint256 reward)
```
- **Callable only by DeepFamily contract**
- Checks reward calculation for next addition index
- Enforces MAX_SUPPLY cap with partial reward if needed
- Updates `totalAdditions` counter and `recentReward` for endorsement pricing
- Returns 0 only when MAX_SUPPLY is reached

#### View Functions
```solidity
function recentReward() external view returns (uint256)  // Latest minted amount
function getReward(uint256 recordCount) public view returns (uint256)  // Reward for specific index
```

### State Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `deepFamilyContract` | address | Authorized minting contract |
| `initialized` | bool | Prevents re-initialization |
| `totalAdditions` | uint256 | Count of successful reward-generating additions |
| `recentReward` | uint256 | Latest minted amount (used for endorsement fees) |

### Events

```solidity
event MiningReward(address indexed miner, uint256 reward, uint256 totalAdditions);
```

### Access Control

**Restricted Functions**:
- `mint()`: Protected by `onlyDeepFamilyContract` modifier
- `initialize()`: Owner-only, single-use initialization

**Security Features**:
- Supply cap enforcement (halts at 100B utility points)
- Progressive halving ensures controlled supply distribution
- Custom error types for precise debugging
- OpenZeppelin's secure ERC20 base implementation

## ZK Verifier Contracts

### PersonCommitmentVerifier.sol
**Purpose**: Validates person identity commitments and optional parent commitments for `addPersonVersion()`
**Public Signals**: 7 values (`identityCommitment`, `fatherIdentityCommitment`, `motherIdentityCommitment`, `submitter`, `schemaVersion`, `cryptoSuiteVersion`, `hashAlgoId`)
**Verification**: Groth16 proof with circuit `person_commitment.circom`

### DisclosureBindingVerifier.sol
**Purpose**: Validates mint disclosure binding for `mintPersonVersionNFT()`
**Public Signals**: 6 values (`identityCommitment`, `disclosureBinding`, `minter`, `schemaVersion`, `cryptoSuiteVersion`, `hashAlgoId`)
**Verification**: Groth16 proof with circuit `disclosure_binding.circom`

Both verifiers are auto-generated from circom circuits. `DeepFamily` calls them through typed interfaces:
```solidity
// PersonCommitmentVerifier (7 public signals)
function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[7] calldata publicSignals
) external view returns (bool);

// DisclosureBindingVerifier (6 public signals)
function verifyProof(
    uint256[2] calldata a,
    uint256[2][2] calldata b,
    uint256[2] calldata c,
    uint256[6] calldata publicSignals
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
error DuplicateVersion();
error MustEndorseVersionFirst();
error VersionAlreadyMinted();

// Access control errors
error MustBeNFTHolder();
error StoryAlreadySealed();
error TokenContractNotSet();
```

### Security Patterns
- **Reentrancy Guards**: All external value transfers protected via OpenZeppelin's `nonReentrant`
- **Input Validation**: Comprehensive parameter checking with custom constraints
- **Access Control**: Role-based permissions with explicit error types
- **Immutability Controls**: Sealed stories and initialized contracts prevent further modification
- **Domain Separation**: domain constants (1000–1003) in Poseidon inputs + keccak256 wrapping for personHash

### Gas Optimization Features
- **Struct Packing**: Optimized storage layout (`address` + `uint96` timestamp in single slot)
- **Paginated Queries**: All list functions support efficient pagination with `MAX_QUERY_PAGE_SIZE`
- **Event-Driven Architecture**: Frontend synchronization via indexed blockchain events
- **Field-Native Public Signals**: Current ZK flows expose full field-element commitments instead of limb pairs
- **Batch-Ready Design**: Functions designed for future batch operation implementations
