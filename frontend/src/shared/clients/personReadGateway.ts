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
import { ethers } from "ethers";
import { readStoryRecord, computeStoryRecordHash } from "@deepfamily/protocol-core";

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
  listPersonVersionsPage: (
    personHash: string,
    offset: number,
    limit: number,
  ) => Promise<{
    versions: { versionIndex: number; addedBy: string; timestamp: number }[];
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
        const ret = await contract.getStoryState(tokenId);
        const metadata: StoryMetadata = {
          totalChunks: Number(ret.totalRecords),
          totalLength: Number(ret.totalPayloadLength),
          isSealed: Boolean(ret.isSealed),
          lastUpdateTime: Number(ret.lastUpdateTime),
          fullStoryHash: String(ret.recordsHead),
        };
        options?.onFetched?.();
        return metadata;
      },
      ttlMs,
    );
  };

  const hydrateStoryRecords = async (
    tokenId: string | number,
    offset: number,
    records: any[],
  ): Promise<StoryChunk[]> => {
    const provider = contract.runner?.provider ?? contract.runner;
    const [network, archive] = await Promise.all([provider.getNetwork(), contract.ARCHIVE()]);
    return Promise.all(
      records.map(async (ref, position) => {
        const verified = await readStoryRecord({
          getCode: (address, blockTag) => provider.getCode(address, blockTag),
          recordRef: {
            blob: {
              pointer: ref.blob.pointer,
              payloadHash: ref.blob.payloadHash,
              payloadLength: ref.blob.payloadLength,
              segmentCount: ref.blob.segmentCount,
            },
            schemaId: ref.schemaId,
            author: ref.author,
            timestamp: ref.timestamp,
          },
        });
        const index = offset + position;
        return {
          chunkIndex: index,
          chunkHash: verified.payloadHash,
          content: verified.decoded?.content ?? "",
          chunkType: verified.decoded?.chunkType ?? 0,
          attachmentCID: verified.decoded?.attachmentCID ?? "",
          timestamp: Number(ref.timestamp),
          editor: ref.author,
          schemaId: ref.schemaId,
          unsupportedSchema: verified.decoded === null,
          rawPayload: ethers.hexlify(verified.payload),
          payloadLength: verified.payloadLength,
          segmentCount: verified.segmentCount,
          recordHash: computeStoryRecordHash({
            chainId: network.chainId,
            archive,
            tokenId,
            index,
            schemaId: ref.schemaId,
            payloadHash: verified.payloadHash,
            payloadLength: verified.payloadLength,
            author: ref.author,
            timestamp: ref.timestamp,
          }),
        };
      }),
    );
  };

  const getStoryChunks = async (
    tokenId: string,
    offset: number,
    limit: number,
  ): Promise<StoryChunk[]> => {
    const result = await contract.listStoryRecords(tokenId, offset, limit);
    return hydrateStoryRecords(tokenId, offset, Array.from(result.records));
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

  /** Version rows carry who submitted each version and when; endorsement counts
   *  and mint state come from listVersionEndorsements over the same window. */
  const listPersonVersionsPage = async (personHash: string, offset: number, limit: number) => {
    const out = await contract.listPersonVersions(personHash, offset, limit);
    const rows: any[] = Array.from(out?.[0] || []);
    return {
      versions: rows.map((row) => ({
        versionIndex: Number(row?.versionIndex ?? row?.[3] ?? 0),
        addedBy: String(row?.addedBy ?? row?.[7] ?? ""),
        timestamp: Number(row?.timestamp ?? row?.[8] ?? 0),
      })),
      totalVersions: Number(out?.[1] || 0),
      hasMore: Boolean(out?.[2]),
      nextOffset: Number(out?.[3] || 0),
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
    const out = await contract.listStoryRecords(tokenId, offset, limit);
    return {
      chunks: await hydrateStoryRecords(tokenId, offset, Array.from(out.records)),
      totalChunks: Number(out.totalRecords),
      hasMore: Boolean(out.hasMore),
      nextOffset: Number(out.nextOffset),
    };
  };

  return {
    getVersionDetails,
    getNFTDetails,
    getStoryMetadata,
    getStoryChunks,
    listVersionEndorsements,
    listPersonVersionsPage,
    listTokenUriHistory,
    listStoryChunksPage,
  };
}
