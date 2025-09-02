
export interface GraphNode {
  personHash: string
  versionIndex: number
  tag?: string
  children?: GraphNode[]
}

export interface StoryChunk {
  chunkIndex: number
  chunkHash: string
  content: string
  timestamp: number
  lastEditor: string
}

export interface StoryMetadata {
  totalChunks: number
  fullStoryHash: string
  lastUpdateTime: number
  isSealed: boolean
  totalLength: number
}

export interface StoryChunkCreateData {
  tokenId: string
  chunkIndex: number
  content: string
  expectedHash?: string
}

export interface StoryChunkUpdateData {
  tokenId: string
  chunkIndex: number
  newContent: string
  expectedHash?: string
}

export interface NodeData {
  personHash: string
  versionIndex: number
  id: string // = makeNodeId
  tag?: string
  fatherHash?: string
  motherHash?: string
  fatherVersionIndex?: number
  motherVersionIndex?: number
  addedBy?: string
  timestamp?: number
  metadataCID?: string
  endorsementCount?: number
  tokenId?: string
  fullName?: string // coreInfo.fullName
  gender?: number
  birthYear?: number
  birthMonth?: number
  birthDay?: number
  birthPlace?: string
  isBirthBC?: boolean
  deathYear?: number
  deathMonth?: number
  deathDay?: number
  deathPlace?: string
  isDeathBC?: boolean
  story?: string
  nftTokenURI?: string
  storyMetadata?: StoryMetadata
  storyChunks?: StoryChunk[]
  hasDetailedStory?: boolean
}

export type NodeDataPatch = Partial<Omit<NodeData,'personHash'|'versionIndex'|'id'>>

export type NodeId = string

export function makeNodeId(personHash: string, versionIndex: number): NodeId {
  return `${personHash}-v-${versionIndex}`
}

export function parseNodeId(id: NodeId): { personHash: string; versionIndex: number } {
  const idx = id.lastIndexOf('-v-')
  if (idx <= 0) return { personHash: id, versionIndex: 0 }
  const hash = id.slice(0, idx)
  const v = Number(id.slice(idx + 3))
  return { personHash: hash, versionIndex: Number.isFinite(v) ? v : 0 }
}

export function shortHash(hash: string, shown = 4): string {
  if (!hash) return ''
  const start = hash.startsWith('0x') ? 2 : 0
  return `0x${hash.slice(start, start + shown)}…`
}

export function nodeLabel(node: Pick<GraphNode, 'personHash' | 'versionIndex' | 'tag'>): string {
  return `${node.personHash}  v${node.versionIndex}`
}


