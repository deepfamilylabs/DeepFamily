import type { QueryCache } from "../cache/QueryCache";
import { getEventScanConfig } from "../config/env";

export type AccountVersionRow = {
  personHash: string;
  versionIndex: number;
  blockNumber: number;
  timestamp: number;
};

export type AccountEndorsementRow = {
  personHash: string;
  versionIndex: number;
  endorsementCount?: number;
  tokenId?: number;
};

export type AccountNftRow = {
  tokenId: number;
  personHash: string;
  versionIndex: number;
  /** Revealed on mint; absent if the core-info read fails. */
  fullName?: string;
};

export type AccountPage<T> = {
  rows: T[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number;
  /** True when the log scan stopped on its chunk budget rather than reaching fromBlock. */
  truncated: boolean;
};

export type MintedIdentity = { tokenId: number; fullName?: string };

/** Key for a (personHash, versionIndex) pair. */
export function identityKey(personHash: string, versionIndex: number): string {
  return `${String(personHash).toLowerCase()}:${versionIndex}`;
}

export interface AccountReadGateway {
  /**
   * Names for (person, version) pairs that have been minted.
   *
   * A person hash alone is unreadable; a name only becomes public when the
   * version is minted, so resolve the mint first and then its core info.
   * Unminted pairs are simply absent from the result.
   */
  resolveMintedIdentities: (
    pairs: { personHash: string; versionIndex: number }[],
  ) => Promise<Record<string, MintedIdentity>>;
  listVersionsByCreator: (
    account: string,
    offset: number,
    limit: number,
  ) => Promise<AccountPage<AccountVersionRow>>;
  listEndorsementsByAccount: (
    account: string,
    offset: number,
    limit: number,
  ) => Promise<AccountPage<AccountEndorsementRow>>;
  listNftsByOwner: (
    account: string,
    offset: number,
    limit: number,
  ) => Promise<AccountPage<AccountNftRow>>;
}

const SCAN_TTL_MS = 60_000;

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * `nftCoreInfo` is a public mapping of a struct-of-structs, so its auto-getter
 * returns (basicInfo, supplementInfo). Named access first, positional fallback.
 */
function readFullName(coreInfo: any): string | undefined {
  const supplement = coreInfo?.supplementInfo ?? coreInfo?.[1];
  const name = supplement?.fullName ?? supplement?.[0];
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function paginate<T>(
  rows: T[],
  offset: number,
  limit: number,
  truncated = false,
): AccountPage<T> {
  const start = Math.max(0, offset);
  const page = rows.slice(start, start + Math.max(0, limit));
  return {
    rows: page,
    totalCount: rows.length,
    hasMore: start + page.length < rows.length,
    nextOffset: start + page.length,
    truncated,
  };
}

/**
 * Walks `PersonVersionAdded` logs backwards from head in bounded chunks.
 *
 * `addedBy` is an indexed topic, so the node does the filtering; the chunking
 * exists purely because providers cap the block span of a single `eth_getLogs`.
 */
async function scanVersionsByCreator(
  contract: any,
  account: string,
): Promise<{ rows: AccountVersionRow[]; truncated: boolean }> {
  const { fromBlock, blockChunk, maxChunks, maxResults } = getEventScanConfig();
  const provider = contract?.runner?.provider ?? contract?.provider;
  if (!provider || typeof provider.getBlockNumber !== "function") {
    throw new Error("No provider available for log scan");
  }

  const latest = toNumber(await provider.getBlockNumber());
  const filter = contract.filters.PersonVersionAdded(null, null, account);

  const collected: AccountVersionRow[] = [];
  let toBlock = latest;
  let chunks = 0;
  let truncated = false;

  while (toBlock >= fromBlock) {
    if (chunks >= maxChunks) {
      truncated = true;
      break;
    }
    const start = Math.max(fromBlock, toBlock - blockChunk + 1);
    const logs = await contract.queryFilter(filter, start, toBlock);
    chunks += 1;

    // queryFilter returns ascending; we accumulate newest-first.
    for (let i = logs.length - 1; i >= 0; i -= 1) {
      const log = logs[i];
      const args = log?.args ?? {};
      collected.push({
        personHash: String(args.personHash ?? args[0] ?? ""),
        versionIndex: toNumber(args.versionIndex ?? args[1]),
        blockNumber: toNumber(log?.blockNumber),
        timestamp: toNumber(args.timestamp ?? args[3]),
      });
      if (collected.length >= maxResults) return { rows: collected, truncated: true };
    }

    if (start <= fromBlock) break;
    toBlock = start - 1;
  }

  return { rows: collected, truncated };
}

/**
 * Account-scoped reads. Backed by the MAIN DeepFamily contract, not the reader:
 * `userEndorsedPersons*`, ERC721Enumerable ownership and the event log all live
 * there and are absent from DeepFamilyReader's ABI.
 */
export function createAccountReadGateway(
  contract: any,
  reader: any,
  queryCache: QueryCache,
): AccountReadGateway {
  const listVersionsByCreator = async (account: string, offset: number, limit: number) => {
    const key = `account.versions:${String(account).toLowerCase()}`;
    let cached = queryCache.get<{ rows: AccountVersionRow[]; truncated: boolean }>(
      key,
      SCAN_TTL_MS,
    );
    if (!cached) {
      cached = await scanVersionsByCreator(contract, account);
      queryCache.set(key, cached);
    }
    return paginate(cached.rows, offset, limit, cached.truncated);
  };

  const listEndorsementsByAccount = async (account: string, offset: number, limit: number) => {
    // The reader aggregates this into one paginated call; enumerating the
    // mapping on the main contract costs 2N+1 round trips for the same rows.
    if (typeof reader?.listUserEndorsements === "function") {
      const out = await reader.listUserEndorsements(account, offset, limit);
      const personHashes: string[] = out?.personHashes ?? out?.[0] ?? [];
      const versionIndices = out?.versionIndices ?? out?.[1] ?? [];
      const endorsementCounts = out?.endorsementCounts ?? out?.[2] ?? [];
      const tokenIds = out?.tokenIds ?? out?.[3] ?? [];
      return {
        rows: personHashes.map((personHash, index) => ({
          personHash: String(personHash),
          versionIndex: toNumber(versionIndices[index]),
          endorsementCount: toNumber(endorsementCounts[index]),
          tokenId: toNumber(tokenIds[index]),
        })),
        totalCount: toNumber(out?.totalCount ?? out?.[4]),
        hasMore: Boolean(out?.hasMore ?? out?.[5]),
        nextOffset: toNumber(out?.nextOffset ?? out?.[6]),
        truncated: false,
      };
    }

    // Fallback: walk the on-chain index directly.
    const total = toNumber(await contract.userEndorsedPersonsCount(account));
    const start = Math.max(0, offset);
    const end = Math.min(total, start + Math.max(0, limit));

    const indices: number[] = [];
    for (let i = start; i < end; i += 1) indices.push(i);

    const personHashes = await Promise.all(
      indices.map(async (index) => String(await contract.userEndorsedPersonAt(account, index))),
    );
    const rows = await Promise.all(
      personHashes.map(async (personHash) => ({
        personHash,
        versionIndex: toNumber(await contract.endorsedVersionIndex(personHash, account)),
      })),
    );

    return {
      rows,
      totalCount: total,
      hasMore: end < total,
      nextOffset: end,
      truncated: false,
    };
  };

  const listNftsByOwner = async (account: string, offset: number, limit: number) => {
    const total = toNumber(await contract.balanceOf(account));
    const start = Math.max(0, offset);
    const end = Math.min(total, start + Math.max(0, limit));

    const indices: number[] = [];
    for (let i = start; i < end; i += 1) indices.push(i);

    const tokenIds = await Promise.all(
      indices.map(async (index) => toNumber(await contract.tokenOfOwnerByIndex(account, index))),
    );
    const rows = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const [personHash, versionIndex, coreInfo] = await Promise.all([
          contract.tokenIdToPerson(tokenId),
          contract.tokenIdToVersionIndex(tokenId),
          // A minted NFT reveals its person on-chain; a bare token id is not
          // useful on its own, so surface the name with the row.
          Promise.resolve(contract.nftCoreInfo?.(tokenId)).catch(() => undefined),
        ]);
        return {
          tokenId,
          personHash: String(personHash ?? ""),
          versionIndex: toNumber(versionIndex),
          fullName: readFullName(coreInfo),
        };
      }),
    );

    return {
      rows,
      totalCount: total,
      hasMore: end < total,
      nextOffset: end,
      truncated: false,
    };
  };

  const resolveMintedIdentities = async (
    pairs: { personHash: string; versionIndex: number }[],
  ): Promise<Record<string, MintedIdentity>> => {
    const resolved: Record<string, MintedIdentity> = {};
    if (typeof contract?.versionToTokenId !== "function") return resolved;

    await Promise.all(
      pairs.map(async ({ personHash, versionIndex }) => {
        try {
          const tokenId = toNumber(await contract.versionToTokenId(personHash, versionIndex));
          if (tokenId <= 0) return;
          let fullName: string | undefined;
          try {
            fullName = readFullName(await contract.nftCoreInfo?.(tokenId));
          } catch {
            // Minted but unreadable: still worth showing the token.
          }
          resolved[identityKey(personHash, versionIndex)] = { tokenId, fullName };
        } catch {
          // A single unreadable pair must not blank the whole list.
        }
      }),
    );

    return resolved;
  };

  return {
    listVersionsByCreator,
    listEndorsementsByAccount,
    listNftsByOwner,
    resolveMintedIdentities,
  };
}
