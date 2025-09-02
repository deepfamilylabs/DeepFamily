# On-Chain & Task API

## Hardhat Tasks (Summary)
| Task | Args | Description |
|------|------|-------------|
| add-person | fullname,birthyear,(optional)parents | Adds a new person version (non-ZK) |
| endorse | person,vindex | Endorse (pay fee) |
| mint-nft | person,vindex | Mint NFT for endorsed version |
| add-story-chunk | token,index,content | Append biography shard |
| update-story-chunk | token,index,content | Modify existing shard |
| seal-story | token | Seal story (immutable) |
| list-story-chunks | token | Enumerate shards |

Refer to `tasks/*.js` for full parameter semantics.

## Key Contract Calls
| Function | Type | Notes |
|----------|------|-------|
| addPerson | tx | Raw add without ZK proof |
| addPersonZK | tx | Groth16 proof path |
| endorseVersion | tx | Shifts endorsement (pays token) |
| mintPersonNFT | tx | Requires prior endorsement |
| addStoryChunk | tx | NFT holder only |
| updateStoryChunk | tx | NFT holder only, not sealed |
| sealStory | tx | NFT holder only |
| listPersonHashesByFullName | view | Pagination offset/limit |
| listPersonVersions | view | Version slice |
| listChildren | view | Child references |
| getVersionDetails | view | Single version + endorsements + tokenId |
| getNFTDetails | view | Aggregated NFT info |
| listStoryChunks | view | Shard pagination |

## Pagination Pattern
All list functions: `(items, totalCount, hasMore, nextOffset)` or variant arrays.
- Request with `limit=0` to fetch only counts cheaply.

## Error Handling
Custom errors (sample):
- InvalidPersonHash / InvalidVersionIndex
- DuplicateVersion
- MustEndorseVersionFirst
- VersionAlreadyMinted
- StoryAlreadySealed, ChunkIndexOutOfRange
- InvalidZKProof

## Gas Tips
- Batch reads via subgraph where possible.
- Use limit=0 probes before large pagination loops.

## Token Integration
Endorse flow needs ERC20 allowance: user approves DeepFamilyToken for at least `recentReward`.
