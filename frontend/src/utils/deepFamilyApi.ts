import { makeNodeId, type NodeId } from '../types/graph'
import { QueryCache } from './queryCache'
import { csKey, cuKey, nftKey, tvKey, vdKey } from './queryKeys'

export type CheckAbort = () => void
export type CacheHook = () => void

export interface TotalVersionsOptions {
  ttlMs: number
  onCacheHit?: CacheHook
  onCacheMiss?: CacheHook
  onFetched?: CacheHook
}

export interface ListChildrenOptions {
  pageLimit: number
  checkAbort?: CheckAbort
}

export interface ListUnionOptions extends ListChildrenOptions {
  totalVersionsOptions: TotalVersionsOptions
  onTotalVersions?: (totalVersions: number) => void
}

export interface DetailQueryOptions {
  ttlMs?: number
  onCacheHit?: CacheHook
  onCacheMiss?: CacheHook
  onFetched?: CacheHook
}

export interface VersionStructFields {
  fatherHash?: string
  motherHash?: string
  fatherVersionIndex?: number
  motherVersionIndex?: number
  addedBy?: string
  timestamp?: number
  tag?: string
  metadataCID?: string
}

export interface CoreInfoFields {
  fullName?: string
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
}

export interface ParsedVersionDetails {
  version: VersionStructFields
  endorsementCount: number
  tokenId: string
}

export interface ParsedNftDetails {
  personHash: string
  versionIndex: number
  version: VersionStructFields
  core: CoreInfoFields
  endorsementCount?: number
  nftTokenURI?: string
}

export interface DeepFamilyApi {
  getTotalVersions: (personHash: string, options: TotalVersionsOptions) => Promise<number>
  listChildrenStrictAll: (parentHash: string, parentVersionIndex: number, options: ListChildrenOptions) => Promise<NodeId[]>
  listChildrenUnionAll: (parentHash: string, options: ListUnionOptions) => Promise<{ childIds: NodeId[]; totalVersions: number }>
  getVersionDetails: (personHash: string, versionIndex: number, options?: DetailQueryOptions) => Promise<ParsedVersionDetails>
  getNFTDetails: (tokenId: string, options?: DetailQueryOptions) => Promise<ParsedNftDetails>
}

export function parseVersionStruct(versionStruct: any): VersionStructFields {
  if (!versionStruct) return {}
  const fatherHash = versionStruct.fatherHash || versionStruct[1]
  const motherHash = versionStruct.motherHash || versionStruct[2]
  const fatherVersionIndex = versionStruct.fatherVersionIndex !== undefined ? Number(versionStruct.fatherVersionIndex) : (versionStruct[4] !== undefined ? Number(versionStruct[4]) : undefined)
  const motherVersionIndex = versionStruct.motherVersionIndex !== undefined ? Number(versionStruct.motherVersionIndex) : (versionStruct[5] !== undefined ? Number(versionStruct[5]) : undefined)
  const addedBy = versionStruct.addedBy || versionStruct[6]
  const timestampRaw = versionStruct.timestamp !== undefined ? versionStruct.timestamp : versionStruct[7]
  const timestamp = timestampRaw !== undefined && timestampRaw !== null ? Number(timestampRaw) : undefined
  const tag = versionStruct.tag || versionStruct[8]
  const metadataCID = versionStruct.metadataCID || versionStruct[9]
  return {
    fatherHash,
    motherHash,
    fatherVersionIndex,
    motherVersionIndex,
    addedBy,
    timestamp,
    tag,
    metadataCID
  }
}

export function parseCoreInfo(coreInfo: any): CoreInfoFields {
  if (!coreInfo) return {}
  const fullName = coreInfo?.supplementInfo?.fullName
  const gender = coreInfo?.basicInfo?.gender !== undefined ? Number(coreInfo.basicInfo.gender) : undefined
  const birthYear = coreInfo?.basicInfo?.birthYear !== undefined ? Number(coreInfo.basicInfo.birthYear) : undefined
  const birthMonth = coreInfo?.basicInfo?.birthMonth !== undefined ? Number(coreInfo.basicInfo.birthMonth) : undefined
  const birthDay = coreInfo?.basicInfo?.birthDay !== undefined ? Number(coreInfo.basicInfo.birthDay) : undefined
  const birthPlace = coreInfo?.supplementInfo?.birthPlace
  const isBirthBC = coreInfo?.basicInfo?.isBirthBC !== undefined ? Boolean(coreInfo.basicInfo.isBirthBC) : undefined
  const deathYear = coreInfo?.supplementInfo?.deathYear !== undefined ? Number(coreInfo.supplementInfo.deathYear) : undefined
  const deathMonth = coreInfo?.supplementInfo?.deathMonth !== undefined ? Number(coreInfo.supplementInfo.deathMonth) : undefined
  const deathDay = coreInfo?.supplementInfo?.deathDay !== undefined ? Number(coreInfo.supplementInfo.deathDay) : undefined
  const deathPlace = coreInfo?.supplementInfo?.deathPlace
  const isDeathBC = coreInfo?.supplementInfo?.isDeathBC !== undefined ? Boolean(coreInfo.supplementInfo.isDeathBC) : undefined
  const story = coreInfo?.supplementInfo?.story
  return {
    fullName,
    gender,
    birthYear,
    birthMonth,
    birthDay,
    birthPlace,
    isBirthBC,
    deathYear,
    deathMonth,
    deathDay,
    deathPlace,
    isDeathBC,
    story
  }
}

export function parseVersionDetailsResult(ret: any): ParsedVersionDetails {
  const versionStruct = ret?.[0]
  const endorsementCount = Number(ret?.[1] ?? 0)
  const tokenIdVal = ret?.[2]
  const tokenId = tokenIdVal !== undefined && tokenIdVal !== null ? tokenIdVal.toString() : '0'
  return {
    version: parseVersionStruct(versionStruct),
    endorsementCount,
    tokenId
  }
}

export function parseNftDetailsResult(ret: any): ParsedNftDetails {
  const personHash = ret?.[0]
  const versionIndex = Number(ret?.[1] ?? 0)
  const versionStruct = ret?.[2]
  const coreInfo = ret?.[3]
  const endorsementCountRaw = ret?.[4]
  const nftTokenURI = ret?.[5]
  const endorsementCount = endorsementCountRaw !== undefined && endorsementCountRaw !== null ? Number(endorsementCountRaw) : undefined
  return {
    personHash,
    versionIndex,
    version: parseVersionStruct(versionStruct),
    core: parseCoreInfo(coreInfo),
    endorsementCount,
    nftTokenURI
  }
}

export function createDeepFamilyApi(contract: any, queryCache: QueryCache): DeepFamilyApi {
  const getTotalVersions = async (personHash: string, options: TotalVersionsOptions): Promise<number> => {
    const key = tvKey(personHash)
    const cached = queryCache.get<number>(key, options.ttlMs)
    if (Number.isFinite(cached)) {
      options.onCacheHit?.()
      return Number(cached)
    }
    options.onCacheMiss?.()

    const inflight = queryCache.getInflight<number>(key)
    if (inflight) return inflight

    const p = (async () => {
      const out: any = await contract.listPersonVersions(personHash, 0, 0)
      let totalVersions = Number(out?.totalVersions ?? out?.[1] ?? 0)
      if (!Number.isFinite(totalVersions) || totalVersions < 0) totalVersions = 0
      queryCache.set(key, totalVersions)
      options.onFetched?.()
      return totalVersions
    })()
    queryCache.setInflight(key, p)
    try { return await p } finally { queryCache.deleteInflight(key) }
  }

  const listChildrenStrictAll = async (parentHash: string, parentVersionIndex: number, options: ListChildrenOptions): Promise<NodeId[]> => {
    const inflightKey = csKey(parentHash, parentVersionIndex)
    const inflight = queryCache.getInflight<NodeId[]>(inflightKey)
    if (inflight) return inflight

    const p = (async () => {
      const childIds: NodeId[] = []
      const seen = new Set<string>()
      let offset = 0
      while (true) {
        options.checkAbort?.()
        const resp = await contract.listChildren(parentHash, Number(parentVersionIndex), offset, options.pageLimit)
        const hashes = resp[0] as string[]
        const versions = resp[1] as (number | bigint)[]
        for (let i = 0; i < hashes.length; i++) {
          const id = makeNodeId(hashes[i], Number(versions[i]))
          if (seen.has(id)) continue
          seen.add(id)
          childIds.push(id)
        }
        const hasMore = Boolean(resp[3])
        const nextOffset = Number(resp[4])
        if (!hasMore || nextOffset === offset) break
        offset = nextOffset
      }
      childIds.sort((a, b) => a.localeCompare(b))
      return childIds
    })()
    queryCache.setInflight(inflightKey, p)
    try { return await p } finally { queryCache.deleteInflight(inflightKey) }
  }

  const listChildrenUnionAll = async (parentHash: string, options: ListUnionOptions): Promise<{ childIds: NodeId[]; totalVersions: number }> => {
    const inflightKey = cuKey(parentHash)
    const inflight = queryCache.getInflight<{ childIds: NodeId[]; totalVersions: number }>(inflightKey)
    if (inflight) return inflight

    const p = (async () => {
      const totalVersions = await getTotalVersions(parentHash, options.totalVersionsOptions)
      options.onTotalVersions?.(totalVersions)
      const childIds: NodeId[] = []
      const seen = new Set<string>()
      for (let parentVer = 0; parentVer <= totalVersions; parentVer++) {
        let offset = 0
        while (true) {
          options.checkAbort?.()
          const resp = await contract.listChildren(parentHash, parentVer, offset, options.pageLimit)
          const hashes = resp[0] as string[]
          const versions = resp[1] as (number | bigint)[]
          for (let i = 0; i < hashes.length; i++) {
            const id = makeNodeId(hashes[i], Number(versions[i]))
            if (seen.has(id)) continue
            seen.add(id)
            childIds.push(id)
          }
          const hasMore = Boolean(resp[3])
          const nextOffset = Number(resp[4])
          if (!hasMore || nextOffset === offset) break
          offset = nextOffset
        }
      }
      childIds.sort((a, b) => a.localeCompare(b))
      return { childIds, totalVersions }
    })()
    queryCache.setInflight(inflightKey, p)
    try { return await p } finally { queryCache.deleteInflight(inflightKey) }
  }

  const getVersionDetails = async (personHash: string, versionIndex: number, options?: DetailQueryOptions): Promise<ParsedVersionDetails> => {
    const key = vdKey(personHash, versionIndex)
    if (options?.ttlMs !== undefined) {
      const cached = queryCache.get<ParsedVersionDetails>(key, options.ttlMs)
      if (cached) {
        options.onCacheHit?.()
        return cached
      }
      options.onCacheMiss?.()
    }
    const inflight = queryCache.getInflight<ParsedVersionDetails>(key)
    if (inflight) return inflight

    const p = (async () => {
      const ret = await contract.getVersionDetails(personHash, Number(versionIndex))
      const parsed = parseVersionDetailsResult(ret)
      if (options?.ttlMs !== undefined) {
        queryCache.set(key, parsed)
      }
      options?.onFetched?.()
      return parsed
    })()
    queryCache.setInflight(key, p)
    try { return await p } finally { queryCache.deleteInflight(key) }
  }

  const getNFTDetails = async (tokenId: string, options?: DetailQueryOptions): Promise<ParsedNftDetails> => {
    const key = nftKey(tokenId)
    if (options?.ttlMs !== undefined) {
      const cached = queryCache.get<ParsedNftDetails>(key, options.ttlMs)
      if (cached) {
        options.onCacheHit?.()
        return cached
      }
      options.onCacheMiss?.()
    }
    const inflight = queryCache.getInflight<ParsedNftDetails>(key)
    if (inflight) return inflight

    const p = (async () => {
      const ret = await contract.getNFTDetails(tokenId)
      const parsed = parseNftDetailsResult(ret)
      if (options?.ttlMs !== undefined) {
        queryCache.set(key, parsed)
      }
      options?.onFetched?.()
      return parsed
    })()
    queryCache.setInflight(key, p)
    try { return await p } finally { queryCache.deleteInflight(key) }
  }

  return { getTotalVersions, listChildrenStrictAll, listChildrenUnionAll, getVersionDetails, getNFTDetails }
}
