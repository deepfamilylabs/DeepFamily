# Subgraph Guide

## Status
Scaffold only. Implement handlers & entities before deployment.

## Files
- `subgraph/schema.graphql`
- `subgraph/subgraph.yaml`
- `subgraph/src/mapping.ts`

## Suggested Entities
```graphql
type Person @entity {
  id: ID!              # personHash
  versions: [PersonVersion!]! @derivedFrom(field: "person")
}

type PersonVersion @entity {
  id: ID!              # personHash-versionIndex
  person: Person!
  versionIndex: BigInt!
  fatherHash: Bytes
  motherHash: Bytes
  fatherVersionIndex: BigInt
  motherVersionIndex: BigInt
  tag: String
  metadataCID: String
  addedBy: Bytes!
  timestamp: BigInt!
  endorsementCount: BigInt!
  token: Token @derivedFrom(field: "version")
}

type Token @entity {
  id: ID!              # tokenId
  personVersion: PersonVersion!
  personHash: Bytes!
  versionIndex: BigInt!
  owner: Bytes!
  tokenURI: String
  mintedAt: BigInt!
}

# Optional story chunk indexing (consider size limits)
type StoryChunk @entity {
  id: ID!              # tokenId-chunkIndex
  token: Token!
  chunkIndex: BigInt!
  chunkHash: Bytes!
  length: Int!
  timestamp: BigInt!
  lastEditor: Bytes!
}
```

## Event Mapping (Planned)
| Event | Handler | Entity Impact |
|-------|---------|---------------|
| PersonVersionAdded | handlePersonVersionAdded | Create Person (if new) + PersonVersion |
| PersonVersionEndorsed | handlePersonVersionEndorsed | Increment endorsementCount |
| PersonNFTMinted | handlePersonNFTMinted | Create Token & link to PersonVersion |
| StoryChunkAdded | handleStoryChunkAdded | Create StoryChunk, update aggregates |
| StoryChunkUpdated | handleStoryChunkUpdated | Update StoryChunk + aggregates |
| StorySealed | handleStorySealed | Mark metadata sealed (if tracked) |

## Deployment Steps (Example)
```bash
yarn global add @graphprotocol/graph-cli
# Prepare (after filling manifest addresses)
yarn graph codegen
yarn graph build
# Authenticate (hosted)
graph auth --product hosted-service <ACCESS_TOKEN>
# Deploy
graph deploy --product hosted-service <ACCOUNT>/<SUBGRAPH_NAME>
```

## Considerations
- Pagination duplication: subgraph can offer richer sorting than contract's index.
- Large story content: optional to index chunk content; can store only hash + length for lighter subgraph.
- Reorg safety: keep handlers idempotent, rely on deterministic IDs.
