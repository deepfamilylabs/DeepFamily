# Data Model

## Core Hashes
| Field | Description |
|-------|-------------|
| personHash | Deterministic hash of PersonBasicInfo |
| fatherHash / motherHash | Optional parent references (0 if unknown) |
| nameHash | keccak256(fullName) used for index bucket |

## PersonBasicInfo
| Field | Type | Notes |
|-------|------|-------|
| fullName | string | UTF-8, length <= 256 |
| isBirthBC | bool | Historical BC flag |
| birthYear | uint16 | 0 = unknown |
| birthMonth | uint8 | 0 = unknown, 1–12 valid |
| birthDay | uint8 | 0 = unknown, 1–31 |
| gender | uint8 | 0 unknown / 1 male / 2 female / 3 other |

## PersonVersion
Immutable once stored.
| Field | Type | Notes |
|-------|------|-------|
| personHash | bytes32 | identity |
| fatherHash / motherHash | bytes32 | parent links |
| versionIndex | uint256 | starts at 1 |
| fatherVersionIndex / motherVersionIndex | uint256 | 0 if unspecified |
| tag | string | free-form label |
| metadataCID | string | IPFS CID for extended metadata |
| addedBy | address | creator |
| timestamp | uint96 | block time snapshot |

## NFT Core Info (PersonCoreInfo)
Combines `PersonBasicInfo` + `PersonSupplementInfo` (places, death, short story summary).

## Story Sharding
| Structure | Purpose |
|-----------|---------|
| StoryChunk | Individual biography segment (<=1000 bytes) |
| StoryMetadata | Aggregates chunk count, hash, total length, sealed flag |

`fullStoryHash = keccak256(concat(chunkHash[0..n-1]))`

## Endorsements
Mapping `endorsedVersionIndex[personHash][user]` with endorsement counts per version. Fee flows at action time.

## Indexes
- Name -> person hashes list
- Parent (hash,version) -> children list
- Version -> tokenId (if minted)
- TokenId -> story metadata & chunk map.
