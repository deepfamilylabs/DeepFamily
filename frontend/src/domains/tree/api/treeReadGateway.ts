import { makeNodeId, type NodeId } from "../../../shared/model";
import { QueryCache } from "../../../shared/cache/QueryCache";
import {
  csKey,
  cuKey,
  trustedEndorsementVisibilityKey,
  trustedEndorsersKey,
  tvKey,
} from "../../../shared/cache/queryKeys";

export type CheckAbort = () => void;
export type CacheHook = () => void;

export interface TotalVersionsOptions {
  ttlMs: number;
  onCacheHit?: CacheHook;
  onCacheMiss?: CacheHook;
  onFetched?: CacheHook;
}

export interface ListChildrenOptions {
  pageLimit: number;
  checkAbort?: CheckAbort;
}

export interface ListUnionOptions extends ListChildrenOptions {
  totalVersionsOptions: TotalVersionsOptions;
  onTotalVersions?: (totalVersions: number) => void;
}

export interface TreeReadGateway {
  getTotalVersions: (personHash: string, options: TotalVersionsOptions) => Promise<number>;
  listChildrenStrictAll: (
    parentHash: string,
    parentVersionIndex: number,
    options: ListChildrenOptions,
  ) => Promise<NodeId[]>;
  listChildrenUnionAll: (
    parentHash: string,
    options: ListUnionOptions,
  ) => Promise<{ childIds: NodeId[]; totalVersions: number }>;
  listPersonVersionsPage: (
    personHash: string,
    offset: number,
    limit: number,
  ) => Promise<{
    versions: any[];
    totalCount: number;
    hasMore: boolean;
    nextOffset: number;
  }>;
  listChildrenPage: (
    parentHash: string,
    parentVersionIndex: number,
    offset: number,
    limit: number,
  ) => Promise<{
    childHashes: string[];
    childVersions: number[];
    totalChildren: number;
    hasMore: boolean;
    nextOffset: number;
  }>;
  listTrustedEndorsersPage: (
    personHash: string,
    versionIndex: number,
    offset: number,
    limit: number,
  ) => Promise<{
    accounts: string[];
    totalCount: number;
    hasMore: boolean;
    nextOffset: number;
  }>;
  listTrustedEndorsersAll: (
    personHash: string,
    versionIndex: number,
    options: ListChildrenOptions & { ttlMs?: number },
  ) => Promise<string[]>;
  isVersionEndorsedByAny: (
    personHash: string,
    versionIndex: number,
    accounts: string[],
    options?: { ttlMs?: number },
  ) => Promise<boolean>;
}

export function createTreeReadGateway(contract: any, queryCache: QueryCache): TreeReadGateway {
  const normalizeAccounts = (accounts: string[]) =>
    Array.from(
      new Set(
        accounts
          .map((account) =>
            String(account || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));

  const getTotalVersions = async (
    personHash: string,
    options: TotalVersionsOptions,
  ): Promise<number> => {
    const key = tvKey(personHash);
    // Fire cache hooks before delegating to fetchQuery
    const cached = queryCache.get<number>(key, options.ttlMs);
    if (Number.isFinite(cached)) {
      options.onCacheHit?.();
      return Number(cached);
    }
    options.onCacheMiss?.();

    return queryCache.fetchQuery(
      key,
      async () => {
        const out: any = await contract.listPersonVersions(personHash, 0, 0);
        let totalVersions = Number(out?.totalVersions ?? out?.[1] ?? 0);
        if (!Number.isFinite(totalVersions) || totalVersions < 0) totalVersions = 0;
        options.onFetched?.();
        return totalVersions;
      },
      options.ttlMs,
    );
  };

  const listChildrenStrictAll = async (
    parentHash: string,
    parentVersionIndex: number,
    options: ListChildrenOptions,
  ): Promise<NodeId[]> => {
    const inflightKey = csKey(parentHash, parentVersionIndex);
    const inflight = queryCache.getInflight<NodeId[]>(inflightKey);
    if (inflight) return inflight;

    const p = (async () => {
      const childIds: NodeId[] = [];
      const seen = new Set<string>();
      let offset = 0;

      while (true) {
        options.checkAbort?.();
        const resp = await contract.listChildren(
          parentHash,
          Number(parentVersionIndex),
          offset,
          options.pageLimit,
        );
        const hashes = resp[0] as string[];
        const versions = resp[1] as Array<number | bigint>;
        for (let i = 0; i < hashes.length; i++) {
          const id = makeNodeId(hashes[i], Number(versions[i]));
          if (seen.has(id)) continue;
          seen.add(id);
          childIds.push(id);
        }
        const hasMore = Boolean(resp[3]);
        const nextOffset = Number(resp[4]);
        if (!hasMore || nextOffset === offset) break;
        offset = nextOffset;
      }

      childIds.sort((a, b) => a.localeCompare(b));
      return childIds;
    })();

    queryCache.setInflight(inflightKey, p);
    try {
      return await p;
    } finally {
      queryCache.deleteInflight(inflightKey);
    }
  };

  const listChildrenUnionAll = async (
    parentHash: string,
    options: ListUnionOptions,
  ): Promise<{ childIds: NodeId[]; totalVersions: number }> => {
    const inflightKey = cuKey(parentHash);
    const inflight = queryCache.getInflight<{ childIds: NodeId[]; totalVersions: number }>(
      inflightKey,
    );
    if (inflight) return inflight;

    const p = (async () => {
      const totalVersions = await getTotalVersions(parentHash, options.totalVersionsOptions);
      options.onTotalVersions?.(totalVersions);
      const childIds: NodeId[] = [];
      const seen = new Set<string>();

      for (let parentVer = 0; parentVer <= totalVersions; parentVer++) {
        let offset = 0;
        while (true) {
          options.checkAbort?.();
          const resp = await contract.listChildren(
            parentHash,
            parentVer,
            offset,
            options.pageLimit,
          );
          const hashes = resp[0] as string[];
          const versions = resp[1] as Array<number | bigint>;
          for (let i = 0; i < hashes.length; i++) {
            const id = makeNodeId(hashes[i], Number(versions[i]));
            if (seen.has(id)) continue;
            seen.add(id);
            childIds.push(id);
          }
          const hasMore = Boolean(resp[3]);
          const nextOffset = Number(resp[4]);
          if (!hasMore || nextOffset === offset) break;
          offset = nextOffset;
        }
      }

      childIds.sort((a, b) => a.localeCompare(b));
      return { childIds, totalVersions };
    })();

    queryCache.setInflight(inflightKey, p);
    try {
      return await p;
    } finally {
      queryCache.deleteInflight(inflightKey);
    }
  };

  const listPersonVersionsPage = async (personHash: string, offset: number, limit: number) => {
    const out = await contract.listPersonVersions(personHash, offset, limit);
    return {
      versions: Array.from(out?.[0] || []),
      totalCount: Number(out?.[1] || 0),
      hasMore: Boolean(out?.[2]),
      nextOffset: Number(out?.[3] || 0),
    };
  };

  const listChildrenPage = async (
    parentHash: string,
    parentVersionIndex: number,
    offset: number,
    limit: number,
  ) => {
    const out = await contract.listChildren(parentHash, parentVersionIndex, offset, limit);
    return {
      childHashes: Array.from(out?.[0] || []).map(String),
      childVersions: Array.from(out?.[1] || []).map(Number),
      totalChildren: Number(out?.[2] || 0),
      hasMore: Boolean(out?.[3]),
      nextOffset: Number(out?.[4] || 0),
    };
  };

  const listTrustedEndorsersPage = async (
    personHash: string,
    versionIndex: number,
    offset: number,
    limit: number,
  ) => {
    const out = await contract.listTrustedEndorsers(
      personHash,
      Number(versionIndex),
      offset,
      limit,
    );
    return {
      accounts: Array.from(out?.[0] || []).map(String),
      totalCount: Number(out?.[1] || 0),
      hasMore: Boolean(out?.[2]),
      nextOffset: Number(out?.[3] || 0),
    };
  };

  const listTrustedEndorsersAll = async (
    personHash: string,
    versionIndex: number,
    options: ListChildrenOptions & { ttlMs?: number },
  ): Promise<string[]> => {
    const key = trustedEndorsersKey(personHash, versionIndex);
    const ttlMs = options.ttlMs ?? 0;

    return queryCache.fetchQuery(
      key,
      async () => {
        const accounts: string[] = [];
        const seen = new Set<string>();
        let offset = 0;

        while (true) {
          options.checkAbort?.();
          const out = await contract.listTrustedEndorsers(
            personHash,
            Number(versionIndex),
            offset,
            options.pageLimit,
          );
          const pageAccounts = Array.from(out?.[0] || []).map((account) =>
            String(account).toLowerCase(),
          );
          for (const account of pageAccounts) {
            if (seen.has(account)) continue;
            seen.add(account);
            accounts.push(account);
          }
          const hasMore = Boolean(out?.[2]);
          const nextOffset = Number(out?.[3] || 0);
          if (!hasMore || nextOffset === offset) break;
          offset = nextOffset;
        }

        return accounts;
      },
      ttlMs,
    );
  };

  const isVersionEndorsedByAny = async (
    personHash: string,
    versionIndex: number,
    accounts: string[],
    options: { ttlMs?: number } = {},
  ): Promise<boolean> => {
    const normalizedAccounts = normalizeAccounts(accounts);
    if (normalizedAccounts.length === 0) return false;

    const key = trustedEndorsementVisibilityKey(personHash, versionIndex, normalizedAccounts);
    return queryCache.fetchQuery(
      key,
      async () =>
        Boolean(
          await contract.isVersionEndorsedByAny(
            personHash,
            Number(versionIndex),
            normalizedAccounts,
          ),
        ),
      options.ttlMs ?? 0,
    );
  };

  return {
    getTotalVersions,
    listChildrenStrictAll,
    listChildrenUnionAll,
    listPersonVersionsPage,
    listChildrenPage,
    listTrustedEndorsersPage,
    listTrustedEndorsersAll,
    isVersionEndorsedByAny,
  };
}
