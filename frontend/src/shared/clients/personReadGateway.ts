import { QueryCache } from "../cache/QueryCache";
import { nftKey, storyKey, vdKey } from "../cache/queryKeys";
import {
  parseVersionDetailsResult,
  parseNftDetailsResult,
  type ParsedVersionDetails,
  type ParsedNftDetails,
  type DetailQueryOptions,
} from "../model/personDetailParsers";
import type { StoryChunk, StoryMetadata } from "../model";
import { parseStoryChunkRecord } from "../model/storyData";

export type { ParsedVersionDetails, ParsedNftDetails, DetailQueryOptions };

export interface PersonReadGateway {
  getVersionDetails: (
    personHash: string,
    versionIndex: number,
    options?: DetailQueryOptions,
  ) => Promise<ParsedVersionDetails>;
  getNFTDetails: (tokenId: string, options?: DetailQueryOptions) => Promise<ParsedNftDetails>;
  getStoryMetadata: (tokenId: string, options?: DetailQueryOptions) => Promise<StoryMetadata>;
  getStoryChunks: (tokenId: string, offset: number, limit: number) => Promise<StoryChunk[]>;
  listVersionEndorsements: (
    personHash: string,
    offset: number,
    limit: number,
  ) => Promise<{
    versionIndices: number[];
    endorsementCounts: number[];
    tokenIds: number[];
    totalVersions: number;
    hasMore: boolean;
    nextOffset: number;
  }>;
  listTokenUriHistory: (
    tokenId: string | number,
    offset: number,
    limit: number,
  ) => Promise<{
    uris: string[];
    totalCount: number;
    hasMore: boolean;
    nextOffset: number;
  }>;
  listStoryChunksPage: (
    tokenId: string | number,
    offset: number,
    limit: number,
  ) => Promise<{
    chunks: StoryChunk[];
    totalChunks: number;
    hasMore: boolean;
    nextOffset: number;
  }>;
}

/**
 * Creates a person-domain read gateway.
 *
 * Provides person-scoped readonly operations for version details,
 * NFT details, and story reads behind a domain interface.
 */
export function createPersonReadGateway(contract: any, queryCache: QueryCache): PersonReadGateway {
  const getVersionDetails = async (
    personHash: string,
    versionIndex: number,
    options?: DetailQueryOptions,
  ): Promise<ParsedVersionDetails> => {
    const key = vdKey(personHash, versionIndex);
    const ttlMs = options?.ttlMs ?? 0;
    // Fire cache hooks before delegating to fetchQuery
    if (ttlMs > 0) {
      const cached = queryCache.get<ParsedVersionDetails>(key, ttlMs);
      if (cached) {
        options?.onCacheHit?.();
        return cached;
      }
      options?.onCacheMiss?.();
    }

    return queryCache.fetchQuery(
      key,
      async () => {
        const ret = await contract.getVersionDetails(personHash, Number(versionIndex));
        const parsed = parseVersionDetailsResult(ret);
        options?.onFetched?.();
        return parsed;
      },
      ttlMs,
    );
  };

  const getNFTDetails = async (
    tokenId: string,
    options?: DetailQueryOptions,
  ): Promise<ParsedNftDetails> => {
    const key = nftKey(tokenId);
    const ttlMs = options?.ttlMs ?? 0;
    // Fire cache hooks before delegating to fetchQuery
    if (ttlMs > 0) {
      const cached = queryCache.get<ParsedNftDetails>(key, ttlMs);
      if (cached) {
        options?.onCacheHit?.();
        return cached;
      }
      options?.onCacheMiss?.();
    }

    return queryCache.fetchQuery(
      key,
      async () => {
        const ret = await contract.getNFTDetails(tokenId);
        const parsed = parseNftDetailsResult(ret);
        options?.onFetched?.();
        return parsed;
      },
      ttlMs,
    );
  };

  const getStoryMetadata = async (
    tokenId: string,
    options?: DetailQueryOptions,
  ): Promise<StoryMetadata> => {
    const key = storyKey(tokenId) + ":meta";
    const ttlMs = options?.ttlMs ?? 0;
    // Fire cache hooks before delegating to fetchQuery
    if (ttlMs > 0) {
      const cached = queryCache.get<StoryMetadata>(key, ttlMs);
      if (cached) {
        options?.onCacheHit?.();
        return cached;
      }
      options?.onCacheMiss?.();
    }

    return queryCache.fetchQuery(
      key,
      async () => {
        const ret = await contract.getStoryMetadata(tokenId);
        const metadata: StoryMetadata = {
          totalChunks: Number(ret?.totalChunks ?? ret?.[0] ?? 0),
          totalLength: Number(ret?.totalLength ?? ret?.[1] ?? 0),
          isSealed: Boolean(ret?.isSealed ?? ret?.[2] ?? false),
          lastUpdateTime: Number(ret?.lastUpdateTime ?? ret?.[3] ?? 0),
          fullStoryHash: String(ret?.fullStoryHash ?? ret?.[4] ?? ""),
        };
        options?.onFetched?.();
        return metadata;
      },
      ttlMs,
    );
  };

  const getStoryChunks = async (
    tokenId: string,
    offset: number,
    limit: number,
  ): Promise<StoryChunk[]> => {
    const ret: any = await contract.listStoryChunks(tokenId, offset, limit);
    const rawChunks = Array.isArray(ret?.chunks)
      ? ret.chunks
      : Array.isArray(ret?.[0])
        ? ret[0]
        : Array.isArray(ret)
          ? ret
          : [];
    return rawChunks.map(parseStoryChunkRecord);
  };

  const listVersionEndorsements = async (personHash: string, offset: number, limit: number) => {
    const out = await contract.listVersionEndorsements(personHash, offset, limit);
    return {
      versionIndices: Array.from(out?.[0] || []).map(Number),
      endorsementCounts: Array.from(out?.[1] || []).map(Number),
      tokenIds: Array.from(out?.[2] || []).map(Number),
      totalVersions: Number(out?.[3] || 0),
      hasMore: Boolean(out?.[4]),
      nextOffset: Number(out?.[5] || 0),
    };
  };

  const listTokenUriHistory = async (tokenId: string | number, offset: number, limit: number) => {
    const out = await contract.listTokenURIHistory(tokenId, offset, limit);
    return {
      uris: Array.from(out?.[0] || []).map(String),
      totalCount: Number(out?.[1] || 0),
      hasMore: Boolean(out?.[2]),
      nextOffset: Number(out?.[3] || 0),
    };
  };

  const listStoryChunksPage = async (tokenId: string | number, offset: number, limit: number) => {
    const out: any = await contract.listStoryChunks(tokenId, offset, limit);
    const rawChunks: any[] = Array.from(out?.chunks ?? out?.[0] ?? []);
    return {
      chunks: rawChunks.map(parseStoryChunkRecord),
      totalChunks: Number(out?.totalChunks ?? out?.[1] ?? 0),
      hasMore: Boolean(out?.hasMore ?? out?.[2]),
      nextOffset: Number(out?.nextOffset ?? out?.[3] ?? 0),
    };
  };

  return {
    getVersionDetails,
    getNFTDetails,
    getStoryMetadata,
    getStoryChunks,
    listVersionEndorsements,
    listTokenUriHistory,
    listStoryChunksPage,
  };
}
