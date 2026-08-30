import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  identityKey,
  useAccountGateway,
  usePersonGateway,
  type MintedIdentity,
  type ParsedNftDetails,
} from "../../../domains/person";
import { MAX_SEARCH_PAGE_SIZE } from "../model/searchPageModel";
import {
  detectSearchSubject,
  getDefaultFacet,
  getFacetDescriptor,
  getFacetsForSubject,
  isFacetRunnable,
  pushRecentQuery,
  readRecentQueries,
  toResolvedSubject,
  type ResolvedSearchSubject,
  type SearchFacetKey,
} from "../model/searchSubject";
import { useAccountFacets, usePersonNftFacet } from "./useResultFacets";
import { useSearchPageController, type SearchPageController } from "./useSearchPageController";

type RunContext = {
  subject: ResolvedSearchSubject;
  versionIndex?: number;
  tokenId?: number;
  pageSize: number;
};

/**
 * Unified search: one query box resolves a subject, facets hang off it.
 *
 * This wraps `useSearchPageController` rather than replacing it — all query,
 * pagination, validation and error handling still lives there. What is added
 * here is the subject/scope layer that removes the per-section forms.
 */
export function useUnifiedSearch() {
  const search = useSearchPageController();
  const accountFacets = useAccountFacets();
  const personNfts = usePersonNftFacet();
  const personGateway = usePersonGateway();
  const accountGateway = useAccountGateway();

  const [queryInput, setQueryInput] = useState("");
  const [submitted, setSubmitted] = useState<ResolvedSearchSubject | null>(null);
  const [activeFacet, setActiveFacet] = useState<SearchFacetKey>("versions");
  const [versionIndex, setVersionIndexState] = useState<number | undefined>(undefined);
  const [tokenId, setTokenIdState] = useState<number | undefined>(undefined);
  const [pageSize, setPageSize] = useState<number>(MAX_SEARCH_PAGE_SIZE);
  const [recent, setRecent] = useState<string[]>([]);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [nftIdentity, setNftIdentity] = useState<ParsedNftDetails | null>(null);
  const [versionStats, setVersionStats] = useState<
    Record<number, { tokenId: number; endorsementCount: number }>
  >({});
  const [rowIdentities, setRowIdentities] = useState<Record<string, MintedIdentity>>({});

  useEffect(() => {
    setRecent(readRecentQueries());
  }, []);

  const subject = useMemo(() => detectSearchSubject(queryInput), [queryInput]);
  const canSubmit = toResolvedSubject(subject) !== null;

  /**
   * Issue one facet query. The underlying react-hook-form is written first so
   * that the controller's own next/prev (which read the form) keep working.
   */
  /** Version -> token id, for the token scope picker and the row chips. */
  const tokenOptions = useMemo(() => {
    const fromStats = Object.entries(versionStats)
      .filter(([, value]) => value.tokenId > 0)
      .map(([versionIndex, value]) => ({
        versionIndex: Number(versionIndex),
        tokenId: value.tokenId,
      }));
    if (fromStats.length > 0) return fromStats;

    const stats = search.endorsement.state.data;
    const pairs: { versionIndex: number; tokenId: number }[] = [];
    (stats.tokenIds ?? []).forEach((raw, index) => {
      const id = Number(raw);
      if (Number.isFinite(id) && id > 0) {
        pairs.push({ versionIndex: Number(stats.versionIndices?.[index] ?? 0), tokenId: id });
      }
    });
    return pairs;
  }, [search.endorsement.state.data, versionStats]);

  /** An NFT is minted from a version, so the version IS the token selector. */
  const tokenForVersion = useCallback(
    (index: number | undefined) =>
      index === undefined
        ? undefined
        : tokenOptions.find((option) => option.versionIndex === index)?.tokenId,
    [tokenOptions],
  );

  const runFacet = useCallback(
    async (key: SearchFacetKey, ctx: RunContext) => {
      const { subject: target, pageSize: size } = ctx;

      if (key === "versions" && target.kind === "personHash") {
        search.versions.form.setValue("personHash", target.personHash);
        search.versions.form.setValue("pageSize", size);
        await search.versions.actions.query({ personHash: target.personHash, pageSize: size }, 0);
        return;
      }
      if (key === "endorsement" && target.kind === "personHash") {
        search.endorsement.form.setValue("personHash", target.personHash);
        search.endorsement.form.setValue("pageSize", size);
        await search.endorsement.actions.query(
          { personHash: target.personHash, pageSize: size },
          0,
        );
        return;
      }
      if (key === "trustedEndorsers" && target.kind === "personHash") {
        if (ctx.versionIndex === undefined || ctx.versionIndex < 1) return;
        search.trustedEndorsers.form.setValue("personHash", target.personHash);
        search.trustedEndorsers.form.setValue("versionIndex", ctx.versionIndex);
        search.trustedEndorsers.form.setValue("pageSize", size);
        await search.trustedEndorsers.actions.query(
          { personHash: target.personHash, versionIndex: ctx.versionIndex, pageSize: size },
          0,
        );
        return;
      }
      if (key === "children" && target.kind === "personHash") {
        if (ctx.versionIndex === undefined || ctx.versionIndex < 0) return;
        search.children.form.setValue("parentHash", target.personHash);
        search.children.form.setValue("parentVersionIndex", ctx.versionIndex);
        search.children.form.setValue("pageSize", size);
        await search.children.actions.query(
          {
            parentHash: target.personHash,
            parentVersionIndex: ctx.versionIndex,
            pageSize: size,
          },
          0,
        );
        return;
      }
      if (key === "storyChunks") {
        const id = ctx.tokenId;
        if (id === undefined || !Number.isFinite(id)) return;
        search.storyChunks.form.setValue("tokenId", id);
        search.storyChunks.form.setValue("pageSize", size);
        await search.storyChunks.actions.query({ tokenId: id, pageSize: size }, 0);
        return;
      }
      if (key === "uri") {
        const id = ctx.tokenId;
        if (id === undefined || !Number.isFinite(id)) return;
        search.uri.form.setValue("tokenId", id);
        search.uri.form.setValue("pageSize", size);
        await search.uri.actions.query({ tokenId: id, pageSize: size }, 0);
        return;
      }
      if (key === "personNfts" && target.kind === "personHash") {
        await personNfts.actions.query(target.personHash, size, 0);
        return;
      }
      if (target.kind === "address") {
        if (key === "accountVersions") {
          await accountFacets.versions.actions.query(target.address, size, 0);
          return;
        }
        if (key === "accountEndorsements") {
          await accountFacets.endorsements.actions.query(target.address, size, 0);
          return;
        }
        if (key === "accountNfts") {
          await accountFacets.nfts.actions.query(target.address, size, 0);
        }
      }
    },
    [accountFacets, personNfts, search],
  );

  const resetFacets = useCallback(() => {
    search.versions.actions.reset();
    search.endorsement.actions.reset();
    search.trustedEndorsers.actions.reset();
    search.children.actions.reset();
    search.storyChunks.actions.reset();
    search.uri.actions.reset();
    accountFacets.versions.actions.reset();
    accountFacets.endorsements.actions.reset();
    accountFacets.nfts.actions.reset();
    personNfts.actions.reset();
  }, [accountFacets, personNfts, search]);

  const submit = useCallback(async () => {
    const resolved = toResolvedSubject(subject);
    if (!resolved) return;

    resetFacets();
    setSubmitted(resolved);
    setRecent((entries) => pushRecentQuery(entries, queryInput.trim()));

    const nextVersion = undefined;
    const nextToken = resolved.kind === "tokenId" ? resolved.tokenId : undefined;
    setVersionIndexState(nextVersion);
    setTokenIdState(nextToken);

    const facet = getDefaultFacet(resolved);
    setActiveFacet(facet);
    await runFacet(facet, {
      subject: resolved,
      versionIndex: nextVersion,
      tokenId: nextToken,
      pageSize,
    });
  }, [pageSize, queryInput, resetFacets, runFacet, subject]);

  const selectFacet = useCallback(
    async (key: SearchFacetKey) => {
      setActiveFacet(key);
      if (!submitted) return;
      const descriptor = getFacetDescriptor(key);

      let effectiveVersion = versionIndex;
      let effectiveToken = tokenId;

      // Token facets inherit the version scope: show the NFT minted from the
      // version already selected, falling back to the first minted version.
      if (descriptor.scope === "token" && submitted.kind === "personHash") {
        effectiveToken = tokenForVersion(effectiveVersion);
        if (effectiveToken === undefined && tokenOptions.length > 0) {
          effectiveVersion = tokenOptions[0].versionIndex;
          effectiveToken = tokenOptions[0].tokenId;
          setVersionIndexState(effectiveVersion);
        }
        setTokenIdState(effectiveToken);
      }

      if (!isFacetRunnable(descriptor, submitted, effectiveVersion, effectiveToken)) return;
      await runFacet(key, {
        subject: submitted,
        versionIndex: effectiveVersion,
        tokenId: effectiveToken,
        pageSize,
      });
    },
    [pageSize, runFacet, submitted, tokenForVersion, tokenId, tokenOptions, versionIndex],
  );

  const setVersionIndex = useCallback(
    async (next: number | undefined) => {
      setVersionIndexState(next);
      if (!submitted) return;
      const descriptor = getFacetDescriptor(activeFacet);

      // One control drives both scopes: picking a version also picks its NFT.
      if (descriptor.scope === "token") {
        const nextToken = tokenForVersion(next);
        setTokenIdState(nextToken);
        if (!isFacetRunnable(descriptor, submitted, next, nextToken)) return;
        await runFacet(activeFacet, {
          subject: submitted,
          versionIndex: next,
          tokenId: nextToken,
          pageSize,
        });
        return;
      }

      if (descriptor.scope !== "personVersion") return;
      if (!isFacetRunnable(descriptor, submitted, next, tokenId)) return;
      await runFacet(activeFacet, { subject: submitted, versionIndex: next, tokenId, pageSize });
    },
    [activeFacet, pageSize, runFacet, submitted, tokenForVersion, tokenId],
  );

  const setTokenId = useCallback(
    async (next: number | undefined) => {
      setTokenIdState(next);
      if (!submitted) return;
      const descriptor = getFacetDescriptor(activeFacet);
      if (descriptor.scope !== "token") return;
      if (!isFacetRunnable(descriptor, submitted, versionIndex, next)) return;
      await runFacet(activeFacet, { subject: submitted, versionIndex, tokenId: next, pageSize });
    },
    [activeFacet, pageSize, runFacet, submitted, versionIndex],
  );

  /** Jump straight from a version row into a version-scoped facet. */
  const focusVersion = useCallback(
    async (nextVersionIndex: number, key: SearchFacetKey) => {
      if (!submitted) return;
      setVersionIndexState(nextVersionIndex);
      setActiveFacet(key);
      const descriptor = getFacetDescriptor(key);
      if (!isFacetRunnable(descriptor, submitted, nextVersionIndex, tokenId)) return;
      await runFacet(key, {
        subject: submitted,
        versionIndex: nextVersionIndex,
        tokenId,
        pageSize,
      });
    },
    [pageSize, runFacet, submitted, tokenId],
  );

  /** Jump from a minted version into a token-scoped facet. */
  const focusToken = useCallback(
    async (nextTokenId: number, key: SearchFacetKey) => {
      if (!submitted) return;
      setTokenIdState(nextTokenId);
      setActiveFacet(key);
      await runFacet(key, {
        subject: submitted,
        versionIndex,
        tokenId: nextTokenId,
        pageSize,
      });
    },
    [pageSize, runFacet, submitted, versionIndex],
  );

  /** Continue searching from a result row (a child hash, a parent hash, ...). */
  const searchFor = useCallback(
    async (raw: string) => {
      const nextSubject = detectSearchSubject(raw);
      const resolved = toResolvedSubject(nextSubject);
      if (!resolved) return;
      setQueryInput(raw);
      resetFacets();
      setSubmitted(resolved);
      setRecent((entries) => pushRecentQuery(entries, raw.trim()));
      const nextToken = resolved.kind === "tokenId" ? resolved.tokenId : undefined;
      setVersionIndexState(undefined);
      setTokenIdState(nextToken);
      const facet = getDefaultFacet(resolved);
      setActiveFacet(facet);
      await runFacet(facet, {
        subject: resolved,
        versionIndex: undefined,
        tokenId: nextToken,
        pageSize,
      });
    },
    [pageSize, resetFacets, runFacet],
  );

  const clear = useCallback(() => {
    setQueryInput("");
    setSubmitted(null);
    setVersionIndexState(undefined);
    setTokenIdState(undefined);
    setActiveFacet("versions");
    resetFacets();
  }, [resetFacets]);

  const changePageSize = useCallback(
    async (next: number) => {
      setPageSize(next);
      if (!submitted) return;
      const descriptor = getFacetDescriptor(activeFacet);
      if (!isFacetRunnable(descriptor, submitted, versionIndex, tokenId)) return;
      await runFacet(activeFacet, {
        subject: submitted,
        versionIndex,
        tokenId,
        pageSize: next,
      });
    },
    [activeFacet, runFacet, submitted, tokenId, versionIndex],
  );

  /** Version indices discovered by the versions facet, for the scope selector. */
  const versionOptions = useMemo(() => {
    const rows = search.versions.state.data ?? [];
    return rows
      .map((row: any) => Number(row?.versionIndex))
      .filter((value: number) => Number.isFinite(value));
  }, [search.versions.state.data]);

  // Default the version scope to the first version the page has actually seen,
  // so version-scoped facets are one click away instead of one form fill away.
  const autoVersionApplied = useRef(false);
  useEffect(() => {
    if (versionIndex !== undefined || versionOptions.length === 0) return;
    if (autoVersionApplied.current) return;
    autoVersionApplied.current = true;
    setVersionIndexState(versionOptions[0]);
  }, [versionIndex, versionOptions]);

  useEffect(() => {
    autoVersionApplied.current = false;
  }, [submitted]);

  // `listPersonVersions` carries no mint state, so a version row cannot tell you
  // whether it became an NFT. `listVersionEndorsements` returns tokenIds and
  // endorsement counts for the same index window in a single call, so pull it
  // alongside every versions page rather than waiting for the stats tab.
  const versionsData = search.versions.state.data;
  const versionsOffset = search.versions.state.offset;
  const versionsLoading = search.versions.state.loading;

  useEffect(() => {
    const rows = versionsData ?? [];
    if (!submitted || submitted.kind !== "personHash" || !personGateway) {
      setVersionStats({});
      return;
    }
    if (versionsLoading || rows.length === 0) return;

    // The controller stores the NEXT offset, so the current window starts here.
    const start = Math.max(0, versionsOffset - rows.length);
    let cancelled = false;
    void (async () => {
      try {
        const out = await personGateway.listVersionEndorsements(
          submitted.personHash,
          start,
          rows.length,
        );
        if (cancelled) return;
        const next: Record<number, { tokenId: number; endorsementCount: number }> = {};
        (out.versionIndices ?? []).forEach((versionIndex, index) => {
          next[Number(versionIndex)] = {
            tokenId: Number(out.tokenIds?.[index] ?? 0),
            endorsementCount: Number(out.endorsementCounts?.[index] ?? 0),
          };
        });
        setVersionStats(next);
      } catch {
        // Enrichment only: the version list itself stays usable without it.
        if (!cancelled) setVersionStats({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personGateway, submitted, versionsData, versionsOffset, versionsLoading]);

  // Bare person hashes are unreadable. Names become public only once a version
  // is minted, so resolve the mints behind whichever list is on screen.
  const identityPairs = useMemo(() => {
    if (activeFacet === "children") {
      const hashes = search.children.state.data?.childHashes ?? [];
      const versions = search.children.state.data?.childVersions ?? [];
      return hashes.map((personHash, index) => ({
        personHash,
        versionIndex: Number(versions[index] ?? 0),
      }));
    }
    if (activeFacet === "accountVersions") {
      return accountFacets.versions.state.data.map((row) => ({
        personHash: row.personHash,
        versionIndex: row.versionIndex,
      }));
    }
    if (activeFacet === "accountEndorsements") {
      return accountFacets.endorsements.state.data.map((row) => ({
        personHash: row.personHash,
        versionIndex: row.versionIndex,
      }));
    }
    return [];
  }, [
    accountFacets.endorsements.state.data,
    accountFacets.versions.state.data,
    activeFacet,
    search.children.state.data,
  ]);

  useEffect(() => {
    if (!accountGateway || identityPairs.length === 0) {
      setRowIdentities({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await accountGateway.resolveMintedIdentities(identityPairs);
        // Never let a gateway returning nothing turn the map into undefined.
        if (!cancelled) setRowIdentities(resolved ?? {});
      } catch {
        // Labels only: the lists stay usable as hashes.
        if (!cancelled) setRowIdentities({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountGateway, identityPairs]);

  // A token id alone says nothing about who it is. Minting reveals the person
  // on-chain, so resolve it and show the identity above the facets.
  useEffect(() => {
    if (!submitted || submitted.kind !== "tokenId" || !personGateway) {
      setNftIdentity(null);
      return;
    }
    let cancelled = false;
    setNftIdentity(null);
    void (async () => {
      try {
        const details = await personGateway.getNFTDetails(String(submitted.tokenId));
        if (!cancelled) setNftIdentity(details);
      } catch {
        // Supplementary: the story/URI facets still work without the identity.
        if (!cancelled) setNftIdentity(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personGateway, submitted]);

  const availableFacets = useMemo(() => getFacetsForSubject(submitted), [submitted]);

  const activeFacetState = useMemo(() => {
    switch (activeFacet) {
      case "versions":
        return search.versions.state;
      case "trustedEndorsers":
        return search.trustedEndorsers.state;
      case "endorsement":
        return search.endorsement.state;
      case "children":
        return search.children.state;
      case "storyChunks":
        return search.storyChunks.state;
      case "uri":
        return search.uri.state;
      case "personNfts":
        return personNfts.state;
      case "accountVersions":
        return accountFacets.versions.state;
      case "accountEndorsements":
        return accountFacets.endorsements.state;
      case "accountNfts":
        return accountFacets.nfts.state;
      default:
        return search.versions.state;
    }
  }, [
    accountFacets,
    activeFacet,
    personNfts.state,
    search.children.state,
    search.endorsement.state,
    search.storyChunks.state,
    search.trustedEndorsers.state,
    search.uri.state,
    search.versions.state,
  ]);

  const activeFacetActions = useMemo(() => {
    switch (activeFacet) {
      case "versions":
        return search.versions.actions;
      case "trustedEndorsers":
        return search.trustedEndorsers.actions;
      case "endorsement":
        return search.endorsement.actions;
      case "children":
        return search.children.actions;
      case "storyChunks":
        return search.storyChunks.actions;
      case "uri":
        return search.uri.actions;
      case "personNfts":
        return personNfts.actions;
      case "accountVersions":
        return accountFacets.versions.actions;
      case "accountEndorsements":
        return accountFacets.endorsements.actions;
      case "accountNfts":
        return accountFacets.nfts.actions;
      default:
        return search.versions.actions;
    }
  }, [
    accountFacets,
    activeFacet,
    personNfts.actions,
    search.children.actions,
    search.endorsement.actions,
    search.storyChunks.actions,
    search.trustedEndorsers.actions,
    search.uri.actions,
    search.versions.actions,
  ]);

  const activeRunnable = useMemo(
    () => isFacetRunnable(getFacetDescriptor(activeFacet), submitted, versionIndex, tokenId),
    [activeFacet, submitted, tokenId, versionIndex],
  );

  const retryActive = useCallback(async () => {
    if (!submitted || !activeRunnable) return;
    await runFacet(activeFacet, { subject: submitted, versionIndex, tokenId, pageSize });
  }, [activeFacet, activeRunnable, pageSize, runFacet, submitted, tokenId, versionIndex]);

  return {
    search,
    accountFacets,
    personNfts,
    t: search.t,
    onCopy: search.onCopy,
    queryInput,
    setQueryInput,
    subject,
    canSubmit,
    submitted,
    submit,
    searchFor,
    clear,
    recent,
    activeFacet,
    availableFacets,
    selectFacet,
    versionIndex,
    setVersionIndex,
    versionOptions,
    tokenId,
    setTokenId,
    tokenOptions,
    tokenForVersion,
    versionStats,
    focusVersion,
    focusToken,
    pageSize,
    changePageSize,
    activeFacetState,
    activeFacetActions,
    activeRunnable,
    retryActive,
    calculatorOpen,
    setCalculatorOpen,
    nftIdentity,
    rowIdentities,
    identityKey,
  };
}

export type UnifiedSearch = ReturnType<typeof useUnifiedSearch>;
export type { SearchPageController };
