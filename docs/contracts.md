# Contracts Reference

## DeepFamily.sol
Core genealogy & versioning + endorsement + NFT mint + story shards.

### Important Constants
| Name | Value | Purpose |
|------|-------|---------|
| MAX_LONG_TEXT_LENGTH | 256 | Limit for variable length strings (tags, CIDs, etc.) |
| MAX_QUERY_PAGE_SIZE | 100 | Upper bound pagination size |
| MAX_CHUNK_CONTENT_LENGTH | 1000 | Story shard content limit (bytes length) |
| MAX_STORY_CHUNKS | 100 | Max shards per NFT story |

### Key Structures
- `PersonBasicInfo` (name, birth info, gender)
- `PersonVersion` (hashes, parent references, tag, metadataCID)
- `PersonCoreInfo` (basic + supplement info for NFT)
- `StoryChunk` / `StoryMetadata`

### Core Functions
- `addPerson / addPersonZK` – add new version (ZK variant validates off-chain circuit proof)
- `endorseVersion` – pay token fee to shift endorsement to specific version
- `mintPersonNFT` – mint NFT after endorsing the target version
- `addStoryChunk / updateStoryChunk / sealStory` – manage biography shards
- Query suite: `listPersonHashesByFullName`, `listPersonVersions`, `listChildren`, `getVersionDetails`, `getNFTDetails`, `listStoryChunks`, etc.

### Events (subset)
| Event | Purpose |
|-------|---------|
| PersonVersionAdded | Index new version & optional parent linkage |
| PersonVersionEndorsed | Track endorsement flow & fees |
| PersonNFTMinted | NFT creation & initial URI |
| StoryChunkAdded / Updated / Sealed | Story lifecycle |
| TokenRewardDistributed | Mining reward emission |

### Access Control
- Implicit open submission model; only NFT holder modifies story chunks.
- Endorsement requires DEEP allowance & balance.

## DeepFamilyToken.sol
Mining reward ERC20 (symbol DEEP).

### Constants
| Constant | Value |
|----------|-------|
| MAX_SUPPLY | 100,000,000,000e18 |
| INITIAL_REWARD | 113,777e18 |
| MIN_REWARD | 0.1e18 |

### Reward Mechanics
Cycle lengths: 1,10,100,1k,10k,100k,1M,10M,100M then fixed 100M, halving each cycle. Reward ends when < MIN_REWARD or supply cap reached.

### Key Functions
- `initialize(deepFamilyAddress)` – one-time binding
- `mint(miner)` – callable only by DeepFamily contract, distributes reward
- `getReward(index)` – view prospective reward

### Events
- `MiningReward(miner, reward, totalAdditions)`

### Access
- Owner sets DeepFamily contract once; afterwards DeepFamily drives emission.

## ZK Verifier Interface
`IPersonHashVerifier.verifyProof(a,b,c,publicSignals)` returns bool – expected Groth16 verifier; implementation pending.
