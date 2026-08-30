import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAccountGateway,
  usePersonGateway,
  type ParsedNftDetails,
  type AccountEndorsementRow,
  type AccountNftRow,
  type AccountPage,
  type AccountVersionRow,
} from "../../../domains/person";
import { getFriendlyErrorMessage } from "../../../shared/lib/errors";
import { getPreviousPageOffset } from "../model/searchPageModel";

export type AccountFacetState<T> = {
  data: T[];
  total: number;
  offset: number;
  loading: boolean;
  error: string | null;
  queried: boolean;
  hasMore: boolean;
  /** Log scan stopped on its chunk budget; the list may be incomplete. */
  truncated: boolean;
};

export type AccountFacet<T> = {
  state: AccountFacetState<T>;
  actions: {
    query: (account: string, pageSize: number, startOffset?: number) => Promise<void>;
    reset: () => void;
    next: () => Promise<void>;
    prev: () => Promise<void>;
  };
};

function emptyState<T>(): AccountFacetState<T> {
  return {
    data: [],
    total: 0,
    offset: 0,
    loading: false,
    error: null,
    queried: false,
    hasMore: false,
    truncated: false,
  };
}

/**
 * One facet driven by a single subject key (an account, or a person hash). Mirrors the shape of the person facets in
 * `useSearchPageController` so the unified page can treat them uniformly,
 * minus the per-section form those still carry.
 */
function useAccountFacet<T>(
  load: ((account: string, offset: number, limit: number) => Promise<AccountPage<T>>) | null,
  toMessage: (error: unknown) => string,
): AccountFacet<T> {
  const [state, setState] = useState<AccountFacetState<T>>(emptyState<T>);
  const lastRef = useRef<{ account: string; pageSize: number }>({ account: "", pageSize: 0 });

  const query = useCallback(
    async (account: string, pageSize: number, startOffset = 0) => {
      lastRef.current = { account, pageSize };
      setState((prev) => ({
        ...(startOffset === 0 ? emptyState<T>() : prev),
        loading: true,
        error: null,
        queried: true,
      }));
      try {
        if (!load) throw new Error("gateway unavailable");
        const page = await load(account, startOffset, pageSize);
        setState({
          data: page.rows,
          total: page.totalCount,
          offset: page.nextOffset,
          loading: false,
          error: null,
          queried: true,
          hasMore: page.hasMore,
          truncated: page.truncated,
        });
      } catch (error) {
        setState((prev) => ({ ...prev, loading: false, error: toMessage(error) }));
      }
    },
    [load, toMessage],
  );

  const reset = useCallback(() => setState(emptyState<T>()), []);

  const next = useCallback(async () => {
    const { account, pageSize } = lastRef.current;
    if (!account) return;
    await query(account, pageSize, state.offset);
  }, [query, state.offset]);

  const prev = useCallback(async () => {
    const { account, pageSize } = lastRef.current;
    if (!account) return;
    await query(account, pageSize, getPreviousPageOffset(state.offset, pageSize));
  }, [query, state.offset]);

  return { state, actions: { query, reset, next, prev } };
}

export function useAccountFacets() {
  const { t } = useTranslation();
  const gateway = useAccountGateway();

  const toMessage = useCallback(
    (error: unknown) => getFriendlyErrorMessage(error, t as any, t("search.queryFailed")),
    [t],
  );

  const versions = useAccountFacet<AccountVersionRow>(
    gateway ? gateway.listVersionsByCreator : null,
    toMessage,
  );
  const endorsements = useAccountFacet<AccountEndorsementRow>(
    gateway ? gateway.listEndorsementsByAccount : null,
    toMessage,
  );
  const nfts = useAccountFacet<AccountNftRow>(gateway ? gateway.listNftsByOwner : null, toMessage);

  return { versions, endorsements, nfts };
}

export type AccountFacets = ReturnType<typeof useAccountFacets>;

export type PersonNftRow = {
  tokenId: number;
  versionIndex: number;
  endorsementCount: number;
  /** Full identity revealed at mint; absent when the details read fails. */
  core?: ParsedNftDetails["core"];
};

/**
 * NFTs minted from a person's versions.
 *
 * There is no "list NFTs of a person" view on chain, but `listVersionEndorsements`
 * returns the token id per version in one call — a non-zero token id IS the mint.
 * Names come from the reader's NFT details, which the gateway caches.
 */
export function usePersonNftFacet(): AccountFacet<PersonNftRow> {
  const { t } = useTranslation();
  const personGateway = usePersonGateway();

  const toMessage = useCallback(
    (error: unknown) => getFriendlyErrorMessage(error, t as any, t("search.queryFailed")),
    [t],
  );

  const load = useCallback(
    async (personHash: string, offset: number, limit: number) => {
      if (!personGateway) throw new Error("gateway unavailable");
      const out = await personGateway.listVersionEndorsements(personHash, offset, limit);

      const minted: PersonNftRow[] = [];
      (out.versionIndices ?? []).forEach((versionIndex, index) => {
        const tokenId = Number(out.tokenIds?.[index] ?? 0);
        if (tokenId > 0) {
          minted.push({
            tokenId,
            versionIndex: Number(versionIndex),
            endorsementCount: Number(out.endorsementCounts?.[index] ?? 0),
          });
        }
      });

      const rows = await Promise.all(
        minted.map(async (row) => {
          try {
            const details = await personGateway.getNFTDetails(String(row.tokenId));
            return { ...row, core: details?.core };
          } catch {
            // The token is real even when its details cannot be read.
            return row;
          }
        }),
      );

      return {
        rows,
        totalCount: rows.length,
        hasMore: Boolean(out.hasMore),
        nextOffset: Number(out.nextOffset ?? 0),
        truncated: false,
      };
    },
    [personGateway],
  );

  return useAccountFacet<PersonNftRow>(personGateway ? load : null, toMessage);
}
