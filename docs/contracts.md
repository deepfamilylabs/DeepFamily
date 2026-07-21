# Smart Contracts Reference

## DeepFamily.sol - Core Protocol Contract

**Location**: `contracts/DeepFamily.sol`
**Description**: Main family tree protocol implementing multi-version person management, ZK-proof verification, community endorsement, NFT minting, and story sharding.
**Upgradeability**: Deployed behind a UUPS (ERC-1967) proxy. State is wired via `initialize(...)` rather than a constructor; upgrades are gated by `_authorizeUpgrade` (`onlyOwner`, intended owner = `TimelockController`). See [Upgradeability & Governance (UUPS)](#upgradeability--governance-uups).

### Critical Constants

| Constant | Value | Purpose & Impact |
|----------|-------|------------------|
| `MAX_LONG_TEXT_LENGTH` | 256 | Max length for tags, IPFS CIDs, names, places, stories |
| `MAX_CHUNK_CONTENT_LENGTH` | 2048 | Story chunk size limit (≈2KB per shard) |
| `PROTOCOL_FEE_BPS_MAX` | 2000 | Maximum protocol endorsement fee (20%) |
| `FEE_BPS_DENOMINATOR` | 10000 | Basis-point denominator for fee accounting |

### Core Data Structures

#### PersonBasicInfo
```solidity
struct PersonBasicInfo {
    bytes32 identityCommitment; // bytes32 form of IdentityCommitment
    bool isBirthBC;             // Birth era flag
    uint16 birthYear;           // Birth year (0=unknown)
    uint8 birthMonth;           // Birth month (1-12, 0=unknown)
    uint8 birthDay;             // Birth day (1-31, 0=unknown)
    uint8 gender;               // Gender code (0=unknown, 1=male, 2=female, 3=other, 4-255=custom)
}
```

`identityCommitment` is the contract-facing identity anchor. It is derived off-chain from:

- canonicalized full name
- `derivedSecretField`
- packed birth / gender fields
- `schemaVersion`, `cryptoSuiteVersion`, and `hashAlgoId`

The packed field uses non-overlapping bit ranges: `birthYear[25..40]`,
`birthMonth[17..24]`, `birthDay[9..16]`, `gender[1..8]`, and `isBirthBC[0]`.

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

**Mining Reward Semantics**:
- Each `personHash` can receive at most one mining reward, on its first version whose proof-derived father and mother identity commitments are both non-zero.
- A person may be added without parents and claim the one-time reward later when a complete-parent version is submitted.
- Parent records do not need to exist on-chain. Both parent version indices may remain `0` (“unspecified”).
- Later versions, including replaying the same proof with a different free-form `tag`, do not mint another reward for that person.

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
2. `DisclosureBindingVerifier.verifyProof()` must succeed
3. `publicSignals.identityCommitment` must match `coreInfo.basicInfo.identityCommitment`
4. `publicSignals.disclosureBinding` must match the contract's recomputed disclosure binding
5. `publicSignals.minter` must equal `uint256(uint160(msg.sender))`
6. `personHash` is derived from `publicSignals.identityCommitment`
7. Linked `AdultAgeGate` age validation must pass

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

## DeepFamilyReader.sol - Aggregated Read Contract

Phase 3 moves expensive detail and paginated read aggregation out of `DeepFamily`.
`DeepFamilyReader` is constructed with the main contract address and uses the main
contract's primitive getters. Write calls continue to target `DeepFamily`.

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
- **Reentrancy Guards**: `ReentrancyGuardTransient` (EIP-1153) on all external value transfers
- **Input Validation**: Comprehensive parameter checking with constraints
- **Native-Currency Rejection**: Contract rejects direct native-currency transfers (ETH on Ethereum,
  CFX on Conflux eSpace; receive/fallback revert)
- **ZK Proof Validation**: Verifier registry routes person and name-disclosure proofs by proof purpose

## Upgradeability & Governance (UUPS)

`DeepFamily` is deployed as a **UUPS (ERC-1967) proxy**, so its logic can evolve while its address
and state persist. The other contracts are **not**
upgradeable by design: `DeepFamilyToken` (the value contract is kept minimal/immutable),
`DeepFamilyReader` (stateless; redeploy + point at the same proxy to change read logic), the ZK
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
  whose `PROPOSER`/`CANCELLER` and `EXECUTOR` roles are held by a **governance multisig**.
  The multisig approval policy decides *who* can propose or execute; the timelock separately
  enforces a public delay so the community can audit, exit, or cancel before a change lands.
- The same Timelock is the **DEEP protocol treasury**. Paid endorsements send their protocol share
  to `DeepFamily.owner()`, which is the Timelock in production. A treasury transfer is therefore a
  Timelock operation and must pass the governance multisig plus the configured delay. This token
  balance is unrelated to ERC-20 ownership: `DeepFamilyToken.owner()` remains `address(0)`.
- On live networks the deployment refuses to keep upgrade authority on an EOA: `GOVERNANCE_OWNER`
  must match the current `GovernanceTimelock` runtime bytecode and have a non-zero delay. Ownership
  of `DeepFamily` is handed over after wiring. Local/simulated networks keep the deployer as
  `DeepFamily.owner()` for test flows.
- `DeepFamilyToken` is deliberately outside Timelock **administrative ownership**. Its deployer owner
  exists only to authorize the one-time reciprocal binding. A successful
  `token.initialize(DeepFamily)` atomically sets `owner()` to `address(0)` on every network; Token
  contract ownership is never transferred to the multisig or Timelock, and the binding cannot be
  changed afterward. The Timelock can still hold and transfer its own DEEP balance like any account.
- A multisig must not be assigned as `DeepFamily.owner()` directly: that would remove the timelock
  delay. Live deployment requires `GOVERNANCE_MULTISIG` to contain contract code, expose
  `getOwners()` and `getThreshold()` state with threshold at least 2, and to be the sole holder of
  the timelock's `PROPOSER_ROLE`, `CANCELLER_ROLE`, and `EXECUTOR_ROLE`. It rejects EOAs,
  single-signer policies, lookalike contracts that merely expose `getMinDelay()`, open roles, and
  extra role holders.

#### Production setup

Deploy the timelock first with one governance multisig. The deploy script requires `MIN_DELAY` and
`GOVERNANCE_MULTISIG` explicitly on every non-local network, validates the delay as a positive safe
integer, and checks the `getOwners()`/`getThreshold()` state. This confirms the reported threshold
and owners, but it does not independently attest the multisig implementation or bytecode; verify
the wallet deployment, signer policy, modules, and guards before funding or transferring ownership.

Conflux eSpace is the primary deployment target: rehearse the complete deployment and governance
flow on `confluxTestnet`, then use `conflux` with reviewed production addresses for Mainnet. Conflux
eSpace is an EVM-compatible execution environment within Conflux Network, not an Ethereum L2.
Ethereum Mainnet and Sepolia remain optional compatibility targets.
`CONFLUX_TESTNET_RPC_URL` and `CONFLUX_RPC_URL` override the corresponding eSpace RPC endpoint;
blank or whitespace-only values use the official public endpoints configured in the project.

The wrapper internally fixes the external admin to `address(0)`, makes role membership enumerable,
and restricts `grantRole`, `revokeRole`, and `renounceRole` to timelock self-calls. OpenZeppelin's
timelock still grants `DEFAULT_ADMIN_ROLE` to itself, so roles can be migrated, but only by scheduling
and executing a delayed timelock operation. A zero delay is rejected both initially and on updates.

```bash
# Example: rehearse the intended 48-hour production delay. Use the actual testnet multisig address.
MIN_DELAY=172800 GOVERNANCE_MULTISIG=0xMultisig... \
  npm run deploy:timelock --net=confluxTestnet

# Use the resulting timelock address, not the multisig address, as the protocol owner.
GOVERNANCE_OWNER=0xTimelock... GOVERNANCE_MULTISIG=0xMultisig... \
  npm run deploy:net --net=confluxTestnet
```

To verify contracts on ConfluxScan, run for example
`npm run verify:net --net=confluxTestnet -- 0xContractAddress`, appending constructor arguments
when that contract has them.
When `EXPLORER_API_KEY` is blank, the configuration supplies ConfluxScan's non-secret `espace`
placeholder automatically. Ethereum Mainnet and Sepolia instead require a real Etherscan key for
the current invocation, for example
`EXPLORER_API_KEY=... npm run verify:net --net=sepolia -- 0xContractAddress`.
Do not reuse the Conflux placeholder for Ethereum verification.

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
same operation through the governance multisig:

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
`data`, and `operation` fields for submission through the governance multisig.

This treasury design deliberately puts protocol spending behind the same approval threshold and
public delay as administrative changes. Do not send unrelated or unsupported assets to the
Timelock: the dedicated tooling only manages the deployed DEEP token.

#### Final governance exit

`DeepFamily.renounceOwnership()` is retained at the contract layer, but the ordinary governance
tasks intentionally reject it. Renouncing is not automatically equivalent to decentralization; it
is an irreversible decision to freeze the current implementation and all owner-controlled policy.
After execution, upgrades, verifier changes, protocol-fee changes, ownership migration, and every
other `onlyOwner` operation become permanently unavailable. Future protocol fee shares are burned
because `owner()` is `address(0)`, while DEEP already held by the Timelock is not automatically
transferred or burned.

There is intentionally no convenience task for this operation. If a final, immutable protocol is a
documented governance objective, first complete an end-state audit, decide and execute the treasury
disposition, publish the exact consequences and calldata, and obtain explicit multisig approval.
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

Replace the Timelock's sole governance multisig using one atomic batch. The batch first grants all
three roles to the inspected new multisig, then revokes all three from the expected old multisig.
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
cannot be below the current minimum. Update the operator's `GOVERNANCE_MULTISIG` only after the
execute transaction and final role state are confirmed. Changing owners or threshold *inside the
same multisig address* is a wallet-internal operation and is not delayed by this Timelock.

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
multisig as a one-command override. Keep the persistent operator environment pointed at the old
governance until migration is confirmed:

```bash
MIN_DELAY=259200 GOVERNANCE_MULTISIG=0xNewMultisig... \
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

This migration requires explicit expected old/new multisig addresses and explicit artifacts for both
Timelocks, the proxy, the current `DeepFamily` implementation, and the token. It verifies every
selected runtime, both exact role policies and multisig thresholds, non-zero delays, bidirectional
proxy/token wiring, `DeepFamily.owner() == oldTimelock`, and `DeepFamilyToken.owner() == address(0)`.
The old selected Timelock artifact must expose the self-call-only
`sweepERC20(address,address)` function. Keep audited, version-named source/artifacts for every
deployed Timelock; the old and new contracts are deliberately verified independently—for example,
as `GovernanceTimelockV1` and `GovernanceTimelockV2`—and there is no unsafe bypass.
It rejects a new Timelock whose delay is shorter than the old one. If a shorter delay is an
intentional governance decision, first execute `timelock-update-delay` on the old Timelock, then
deploy the replacement with a delay at least equal to that approved value. Only update
`GOVERNANCE_OWNER` after the ownership and treasury migration is confirmed. A directly sent DEEP
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
  `tasks/upgrade-execute.mjs`) additionally validate the *specific* candidate implementation against
  the proxy baseline and verify the on-chain runtime bytecode (metadata-stripped, library-linked)
  before staging an upgrade through the timelock. When `upgrade-schedule` deploys a candidate, it
  prints an exact source-verification command and exits without scheduling; after explorer
  verification succeeds, rerun with that address in `--implementation` to create the operation.

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
- **Reentrancy Guards**: External value transfers protected via OpenZeppelin `ReentrancyGuardTransient` (EIP-1153 transient storage; proxy-safe, no initializer)
- **Upgradeability**: `DeepFamily` is a UUPS proxy; upgrades are gated by `_authorizeUpgrade` (timelock-owned) and storage-layout safety checks (see [Upgradeability & Governance (UUPS)](#upgradeability--governance-uups))
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
