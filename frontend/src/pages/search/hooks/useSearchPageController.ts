import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  getChunkTypeOptions,
  type ChunkTypeOption,
  usePersonGateway,
  type PersonHashCalculatorHandle,
} from "../../../domains/person";
import { useTreeGateway } from "../../../domains/tree";
import { getFriendlyErrorMessage } from "../../../shared/lib/errors";
import type { StoryChunk } from "../../../shared/model";
import { useToast } from "../../../shared/ui";
import {
  emptyChildrenPageData,
  emptyEndorsementStatsData,
  emptyTrustedEndorsersPageData,
  formatNumericError,
  getPreviousPageOffset,
  getWatchedNumber,
  MAX_SEARCH_PAGE_SIZE,
  sanitizeNumberInput,
  type ChildrenForm,
  type ChildrenPageData,
  type EndorsementStatsData,
  type EndorsementStatsForm,
  type PersonVersionsForm,
  type StoryChunksForm,
  type TokenURIHistoryForm,
  type TrustedEndorsersForm,
  type TrustedEndorsersPageData,
} from "../model/searchPageModel";

export function useSearchPageController() {
  const { t } = useTranslation();
  const toast = useToast();
  const personGateway = usePersonGateway();
  const treeGateway = useTreeGateway();
  const getQueryErrorMessage = useCallback(
    (error: unknown) => getFriendlyErrorMessage(error, t as any, t("search.queryFailed")),
    [t],
  );

  const schemas = useMemo(
    () => ({
      endorsementStats: z.object({
        personHash: z
          .string()
          .min(1, t("search.validation.hashRequired"))
          .regex(/^0x[a-fA-F0-9]{64}$/, t("search.validation.hashInvalid")),
        pageSize: z
          .number()
          .int({ message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .max(MAX_SEARCH_PAGE_SIZE, {
            message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }),
          }),
      }),
      tokenURIHistory: z.object({
        tokenId: z
          .number({ message: t("search.validation.tokenIdRequired") })
          .int({ message: t("search.validation.tokenIdRequired") })
          .min(1, { message: t("search.validation.tokenIdRequired") }),
        pageSize: z
          .number()
          .int({ message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .max(MAX_SEARCH_PAGE_SIZE, {
            message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }),
          }),
      }),
      personVersions: z.object({
        personHash: z
          .string()
          .min(1, t("search.validation.hashRequired"))
          .regex(/^0x[a-fA-F0-9]{64}$/, t("search.validation.hashInvalid")),
        pageSize: z
          .number()
          .int({ message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .max(MAX_SEARCH_PAGE_SIZE, {
            message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }),
          }),
      }),
      trustedEndorsers: z.object({
        personHash: z
          .string()
          .min(1, t("search.validation.hashRequired"))
          .regex(/^0x[a-fA-F0-9]{64}$/, t("search.validation.hashInvalid")),
        versionIndex: z
          .number({ message: t("search.validation.versionIndexRequiredOne") })
          .int({ message: t("search.validation.versionIndexRequiredOne") })
          .min(1, { message: t("search.validation.versionIndexRequiredOne") }),
        pageSize: z
          .number()
          .int({ message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .max(MAX_SEARCH_PAGE_SIZE, {
            message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }),
          }),
      }),
      storyChunks: z.object({
        tokenId: z
          .number({ message: t("search.validation.tokenIdRequired") })
          .int({ message: t("search.validation.tokenIdRequired") })
          .min(1, { message: t("search.validation.tokenIdRequired") }),
        pageSize: z
          .number()
          .int({ message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .max(MAX_SEARCH_PAGE_SIZE, {
            message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }),
          }),
      }),
      children: z.object({
        parentHash: z
          .string()
          .min(1, t("search.validation.hashRequired"))
          .regex(/^0x[a-fA-F0-9]{64}$/, t("search.validation.hashInvalid")),
        parentVersionIndex: z
          .number({ message: t("search.validation.versionIndexRequired") })
          .int({ message: t("search.validation.versionIndexRequired") })
          .min(0, { message: t("search.validation.versionIndexRequired") }),
        pageSize: z
          .number()
          .int({ message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .min(1, { message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }) })
          .max(MAX_SEARCH_PAGE_SIZE, {
            message: t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }),
          }),
      }),
    }),
    [t],
  );

  const tokenIdValidationMessage = useMemo(() => t("search.validation.tokenIdRequired"), [t]);
  const pageSizeValidationMessage = useMemo(
    () => t("search.validation.pageSizeRange", { max: MAX_SEARCH_PAGE_SIZE }),
    [t],
  );
  const versionIndexValidationMessage = useMemo(
    () => t("search.validation.versionIndexRequired"),
    [t],
  );
  const versionIndexOneValidationMessage = useMemo(
    () => t("search.validation.versionIndexRequiredOne"),
    [t],
  );

  const copyText = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const onCopy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      if (ok) {
        toast.success(t("search.copied"));
      } else {
        toast.error(t("search.copyFailed"));
      }
    },
    [copyText, t, toast],
  );

  const [endorsementOffset, setEndorsementOffset] = useState<number>(0);
  const [endorsementLoading, setEndorsementLoading] = useState<boolean>(false);
  const [endorsementError, setEndorsementError] = useState<string | null>(null);
  const [endorsementData, setEndorsementData] =
    useState<EndorsementStatsData>(emptyEndorsementStatsData);
  const [endorsementTotal, setEndorsementTotal] = useState<number>(0);
  const [endorsementHasMore, setEndorsementHasMore] = useState<boolean>(false);
  const [endorsementQueried, setEndorsementQueried] = useState<boolean>(false);

  const [uriOffset, setUriOffset] = useState<number>(0);
  const [uriLoading, setUriLoading] = useState<boolean>(false);
  const [uriError, setUriError] = useState<string | null>(null);
  const [uriData, setUriData] = useState<string[]>([]);
  const [uriTotal, setUriTotal] = useState<number>(0);
  const [uriHasMore, setUriHasMore] = useState<boolean>(false);
  const [uriQueried, setUriQueried] = useState<boolean>(false);

  const [versionsOffset, setVersionsOffset] = useState<number>(0);
  const [versionsLoading, setVersionsLoading] = useState<boolean>(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsData, setVersionsData] = useState<any[]>([]);
  const [versionsTotal, setVersionsTotal] = useState<number>(0);
  const [versionsHasMore, setVersionsHasMore] = useState<boolean>(false);
  const [versionsQueried, setVersionsQueried] = useState<boolean>(false);

  const [trustedEndorsersOffset, setTrustedEndorsersOffset] = useState<number>(0);
  const [trustedEndorsersLoading, setTrustedEndorsersLoading] = useState<boolean>(false);
  const [trustedEndorsersError, setTrustedEndorsersError] = useState<string | null>(null);
  const [trustedEndorsersData, setTrustedEndorsersData] = useState<TrustedEndorsersPageData>(
    emptyTrustedEndorsersPageData,
  );
  const [trustedEndorsersTotal, setTrustedEndorsersTotal] = useState<number>(0);
  const [trustedEndorsersHasMore, setTrustedEndorsersHasMore] = useState<boolean>(false);
  const [trustedEndorsersQueried, setTrustedEndorsersQueried] = useState<boolean>(false);

  const [storyChunksOffset, setStoryChunksOffset] = useState<number>(0);
  const [storyChunksLoading, setStoryChunksLoading] = useState<boolean>(false);
  const [storyChunksError, setStoryChunksError] = useState<string | null>(null);
  const [storyChunksData, setStoryChunksData] = useState<StoryChunk[]>([]);
  const [storyChunksTotal, setStoryChunksTotal] = useState<number>(0);
  const [storyChunksHasMore, setStoryChunksHasMore] = useState<boolean>(false);
  const [storyChunksQueried, setStoryChunksQueried] = useState<boolean>(false);

  const [childrenOffset, setChildrenOffset] = useState<number>(0);
  const [childrenLoading, setChildrenLoading] = useState<boolean>(false);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const [childrenData, setChildrenData] = useState<ChildrenPageData>(emptyChildrenPageData);
  const [childrenTotal, setChildrenTotal] = useState<number>(0);
  const [childrenHasMore, setChildrenHasMore] = useState<boolean>(false);
  const [childrenQueried, setChildrenQueried] = useState<boolean>(false);

  const [hashHasPassphrase, setHashHasPassphrase] = useState(false);
  const hashCalcRef = useRef<PersonHashCalculatorHandle | null>(null);

  const endorsementForm = useForm<EndorsementStatsForm>({
    resolver: zodResolver(schemas.endorsementStats),
    defaultValues: { personHash: "", pageSize: MAX_SEARCH_PAGE_SIZE },
  });
  const uriForm = useForm<TokenURIHistoryForm>({
    resolver: zodResolver(schemas.tokenURIHistory),
    defaultValues: { tokenId: undefined as any, pageSize: MAX_SEARCH_PAGE_SIZE },
  });
  const versionsForm = useForm<PersonVersionsForm>({
    resolver: zodResolver(schemas.personVersions),
    defaultValues: { personHash: "", pageSize: MAX_SEARCH_PAGE_SIZE },
  });
  const trustedEndorsersForm = useForm<TrustedEndorsersForm>({
    resolver: zodResolver(schemas.trustedEndorsers),
    defaultValues: {
      personHash: "",
      versionIndex: undefined as any,
      pageSize: MAX_SEARCH_PAGE_SIZE,
    },
  });
  const storyChunksForm = useForm<StoryChunksForm>({
    resolver: zodResolver(schemas.storyChunks),
    defaultValues: { tokenId: undefined as any, pageSize: MAX_SEARCH_PAGE_SIZE },
  });
  const childrenForm = useForm<ChildrenForm>({
    resolver: zodResolver(schemas.children),
    defaultValues: {
      parentHash: "",
      parentVersionIndex: undefined as any,
      pageSize: MAX_SEARCH_PAGE_SIZE,
    },
  });

  const endorsementPageSize = Number(endorsementForm.watch("pageSize") || MAX_SEARCH_PAGE_SIZE);
  const uriPageSize = Number(uriForm.watch("pageSize") || MAX_SEARCH_PAGE_SIZE);
  const versionsPageSize = Number(versionsForm.watch("pageSize") || MAX_SEARCH_PAGE_SIZE);
  const trustedEndorsersPageSize = Number(
    trustedEndorsersForm.watch("pageSize") || MAX_SEARCH_PAGE_SIZE,
  );
  const storyChunksPageSize = Number(storyChunksForm.watch("pageSize") || MAX_SEARCH_PAGE_SIZE);
  const childrenPageSize = Number(childrenForm.watch("pageSize") || MAX_SEARCH_PAGE_SIZE);

  const chunkTypeOptions = useMemo((): ChunkTypeOption[] => getChunkTypeOptions(t), [t]);
  const getChunkTypeLabel = useCallback(
    (type: number) => {
      const numericType = Number.isFinite(type) ? Number(type) : 0;
      const match = chunkTypeOptions.find((option) => option.value === numericType);
      return match ? match.label : t("chunkTypes.unknown", "Unknown");
    },
    [chunkTypeOptions, t],
  );

  const onHashPublicFormChange = useCallback(() => {
    const nextHasPassphrase = hashCalcRef.current?.hasPassphrase() ?? false;
    setHashHasPassphrase(nextHasPassphrase);
  }, []);

  const onQueryEndorsementStats = useCallback(
    async (data: EndorsementStatsForm, startOffset?: number) => {
      setEndorsementQueried(true);
      if ((startOffset ?? 0) === 0) {
        setEndorsementData(emptyEndorsementStatsData);
        setEndorsementTotal(0);
        setEndorsementHasMore(false);
        setEndorsementOffset(0);
      }
      setEndorsementLoading(true);
      setEndorsementError(null);
      try {
        if (!personGateway) throw new Error(t("search.queryFailed"));
        const offset = startOffset !== undefined ? startOffset : endorsementOffset;
        const out = await personGateway.listVersionEndorsements(
          data.personHash,
          offset,
          data.pageSize,
        );
        const { versionIndices, endorsementCounts, tokenIds, totalVersions, hasMore, nextOffset } =
          out;
        setEndorsementData({ versionIndices, endorsementCounts, tokenIds });
        setEndorsementTotal(totalVersions);
        setEndorsementHasMore(hasMore);
        setEndorsementOffset(nextOffset);
      } catch (error: any) {
        setEndorsementError(getQueryErrorMessage(error));
      } finally {
        setEndorsementLoading(false);
      }
    },
    [endorsementOffset, getQueryErrorMessage, personGateway, t],
  );

  const onResetEndorsementQuery = useCallback(() => {
    setEndorsementData(emptyEndorsementStatsData);
    setEndorsementTotal(0);
    setEndorsementHasMore(false);
    setEndorsementOffset(0);
    setEndorsementError(null);
    setEndorsementQueried(false);
  }, []);

  const onEndorsementNext = useCallback(async () => {
    await onQueryEndorsementStats({
      personHash: endorsementForm.watch("personHash") || "",
      pageSize: endorsementPageSize,
    });
  }, [endorsementForm, endorsementPageSize, onQueryEndorsementStats]);

  const onEndorsementPrev = useCallback(async () => {
    const prev = getPreviousPageOffset(endorsementOffset, endorsementPageSize);
    await onQueryEndorsementStats(
      { personHash: endorsementForm.watch("personHash") || "", pageSize: endorsementPageSize },
      prev,
    );
  }, [endorsementForm, endorsementOffset, endorsementPageSize, onQueryEndorsementStats]);

  const onQueryTokenURIHistory = useCallback(
    async (data: TokenURIHistoryForm, startOffset?: number) => {
      setUriQueried(true);
      if ((startOffset ?? 0) === 0) {
        setUriData([]);
        setUriTotal(0);
        setUriHasMore(false);
        setUriOffset(0);
      }
      setUriLoading(true);
      setUriError(null);
      try {
        if (!personGateway) throw new Error(t("search.queryFailed"));
        const offset = startOffset !== undefined ? startOffset : uriOffset;
        if (data.tokenId === undefined || !Number.isFinite(data.tokenId)) {
          throw new Error(t("search.validation.tokenIdRequired"));
        }
        const out = await personGateway.listTokenUriHistory(data.tokenId, offset, data.pageSize);
        const { uris, totalCount, hasMore, nextOffset } = out;
        setUriData(uris);
        setUriTotal(totalCount);
        setUriHasMore(hasMore);
        setUriOffset(nextOffset);
      } catch (error: any) {
        setUriError(getQueryErrorMessage(error));
      } finally {
        setUriLoading(false);
      }
    },
    [getQueryErrorMessage, personGateway, t, uriOffset],
  );

  const onResetUriQuery = useCallback(() => {
    setUriData([]);
    setUriTotal(0);
    setUriHasMore(false);
    setUriOffset(0);
    setUriError(null);
    setUriQueried(false);
  }, []);

  const onUriNext = useCallback(async () => {
    const tokenId = getWatchedNumber(uriForm.watch("tokenId"));
    if (tokenId === undefined) {
      setUriError(t("search.validation.tokenIdRequired"));
      return;
    }
    await onQueryTokenURIHistory({ tokenId, pageSize: uriPageSize });
  }, [onQueryTokenURIHistory, t, uriForm, uriPageSize]);

  const onUriPrev = useCallback(async () => {
    const prev = getPreviousPageOffset(uriOffset, uriPageSize);
    const tokenId = getWatchedNumber(uriForm.watch("tokenId"));
    if (tokenId === undefined) {
      setUriError(t("search.validation.tokenIdRequired"));
      return;
    }
    await onQueryTokenURIHistory({ tokenId, pageSize: uriPageSize }, prev);
  }, [onQueryTokenURIHistory, t, uriForm, uriOffset, uriPageSize]);

  const onQueryPersonVersions = useCallback(
    async (data: PersonVersionsForm, startOffset?: number) => {
      setVersionsQueried(true);
      if ((startOffset ?? 0) === 0) {
        setVersionsData([]);
        setVersionsTotal(0);
        setVersionsHasMore(false);
        setVersionsOffset(0);
      }
      setVersionsLoading(true);
      setVersionsError(null);
      try {
        if (!treeGateway) throw new Error(t("search.queryFailed"));
        const offset = startOffset !== undefined ? startOffset : versionsOffset;
        const out = await treeGateway.listPersonVersionsPage(
          data.personHash,
          offset,
          data.pageSize,
        );
        const { versions, totalCount, hasMore, nextOffset } = out;
        setVersionsData(versions);
        setVersionsTotal(totalCount);
        setVersionsHasMore(hasMore);
        setVersionsOffset(nextOffset);
      } catch (error: any) {
        setVersionsError(getQueryErrorMessage(error));
      } finally {
        setVersionsLoading(false);
      }
    },
    [getQueryErrorMessage, t, treeGateway, versionsOffset],
  );

  const onResetVersionsQuery = useCallback(() => {
    setVersionsData([]);
    setVersionsTotal(0);
    setVersionsHasMore(false);
    setVersionsOffset(0);
    setVersionsError(null);
    setVersionsQueried(false);
  }, []);

  const onVersionsNext = useCallback(async () => {
    await onQueryPersonVersions({
      personHash: versionsForm.watch("personHash") || "",
      pageSize: versionsPageSize,
    });
  }, [onQueryPersonVersions, versionsForm, versionsPageSize]);

  const onVersionsPrev = useCallback(async () => {
    const prev = getPreviousPageOffset(versionsOffset, versionsPageSize);
    await onQueryPersonVersions(
      { personHash: versionsForm.watch("personHash") || "", pageSize: versionsPageSize },
      prev,
    );
  }, [onQueryPersonVersions, versionsForm, versionsOffset, versionsPageSize]);

  const onQueryTrustedEndorsers = useCallback(
    async (data: TrustedEndorsersForm, startOffset?: number) => {
      setTrustedEndorsersQueried(true);
      if ((startOffset ?? 0) === 0) {
        setTrustedEndorsersData(emptyTrustedEndorsersPageData);
        setTrustedEndorsersTotal(0);
        setTrustedEndorsersHasMore(false);
        setTrustedEndorsersOffset(0);
      }
      setTrustedEndorsersLoading(true);
      setTrustedEndorsersError(null);
      try {
        if (!treeGateway) throw new Error(t("search.queryFailed"));
        const offset = startOffset !== undefined ? startOffset : trustedEndorsersOffset;
        const versionIndex = Number(data.versionIndex);
        if (!Number.isFinite(versionIndex) || versionIndex < 1) {
          throw new Error(t("search.validation.versionIndexRequiredOne"));
        }
        const out = await treeGateway.listTrustedEndorsersPage(
          data.personHash,
          versionIndex,
          offset,
          data.pageSize,
        );
        const { accounts, totalCount, hasMore, nextOffset } = out;
        setTrustedEndorsersData({ accounts });
        setTrustedEndorsersTotal(totalCount);
        setTrustedEndorsersHasMore(hasMore);
        setTrustedEndorsersOffset(nextOffset);
      } catch (error: any) {
        setTrustedEndorsersError(getQueryErrorMessage(error));
      } finally {
        setTrustedEndorsersLoading(false);
      }
    },
    [getQueryErrorMessage, t, treeGateway, trustedEndorsersOffset],
  );

  const onResetTrustedEndorsersQuery = useCallback(() => {
    setTrustedEndorsersData(emptyTrustedEndorsersPageData);
    setTrustedEndorsersTotal(0);
    setTrustedEndorsersHasMore(false);
    setTrustedEndorsersOffset(0);
    setTrustedEndorsersError(null);
    setTrustedEndorsersQueried(false);
  }, []);

  const onTrustedEndorsersNext = useCallback(async () => {
    const versionIndex = getWatchedNumber(trustedEndorsersForm.watch("versionIndex"));
    if (versionIndex === undefined || versionIndex < 1) {
      setTrustedEndorsersError(t("search.validation.versionIndexRequiredOne"));
      return;
    }
    await onQueryTrustedEndorsers({
      personHash: trustedEndorsersForm.watch("personHash") || "",
      versionIndex,
      pageSize: trustedEndorsersPageSize,
    });
  }, [onQueryTrustedEndorsers, t, trustedEndorsersForm, trustedEndorsersPageSize]);

  const onTrustedEndorsersPrev = useCallback(async () => {
    const prev = getPreviousPageOffset(trustedEndorsersOffset, trustedEndorsersPageSize);
    const versionIndex = getWatchedNumber(trustedEndorsersForm.watch("versionIndex"));
    if (versionIndex === undefined || versionIndex < 1) {
      setTrustedEndorsersError(t("search.validation.versionIndexRequiredOne"));
      return;
    }
    await onQueryTrustedEndorsers(
      {
        personHash: trustedEndorsersForm.watch("personHash") || "",
        versionIndex,
        pageSize: trustedEndorsersPageSize,
      },
      prev,
    );
  }, [
    onQueryTrustedEndorsers,
    t,
    trustedEndorsersForm,
    trustedEndorsersOffset,
    trustedEndorsersPageSize,
  ]);

  const onQueryStoryChunks = useCallback(
    async (data: StoryChunksForm, startOffset?: number) => {
      setStoryChunksQueried(true);
      if ((startOffset ?? 0) === 0) {
        setStoryChunksData([]);
        setStoryChunksTotal(0);
        setStoryChunksHasMore(false);
        setStoryChunksOffset(0);
      }
      setStoryChunksLoading(true);
      setStoryChunksError(null);
      try {
        if (!personGateway) throw new Error(t("search.queryFailed"));
        const offset = startOffset !== undefined ? startOffset : storyChunksOffset;
        if (data.tokenId === undefined || !Number.isFinite(data.tokenId)) {
          throw new Error(t("search.validation.tokenIdRequired"));
        }
        const out = await personGateway.listStoryChunksPage(data.tokenId, offset, data.pageSize);
        const { chunks, totalChunks, hasMore, nextOffset } = out;
        setStoryChunksData(chunks);
        setStoryChunksTotal(totalChunks);
        setStoryChunksHasMore(hasMore);
        setStoryChunksOffset(nextOffset);
      } catch (error: any) {
        setStoryChunksError(getQueryErrorMessage(error));
      } finally {
        setStoryChunksLoading(false);
      }
    },
    [getQueryErrorMessage, personGateway, storyChunksOffset, t],
  );

  const onResetStoryChunksQuery = useCallback(() => {
    setStoryChunksData([]);
    setStoryChunksTotal(0);
    setStoryChunksHasMore(false);
    setStoryChunksOffset(0);
    setStoryChunksError(null);
    setStoryChunksQueried(false);
  }, []);

  const onStoryChunksNext = useCallback(async () => {
    const tokenId = getWatchedNumber(storyChunksForm.watch("tokenId"));
    if (tokenId === undefined) {
      setStoryChunksError(t("search.validation.tokenIdRequired"));
      return;
    }
    await onQueryStoryChunks({ tokenId, pageSize: storyChunksPageSize });
  }, [onQueryStoryChunks, storyChunksForm, storyChunksPageSize, t]);

  const onStoryChunksPrev = useCallback(async () => {
    const prev = getPreviousPageOffset(storyChunksOffset, storyChunksPageSize);
    const tokenId = getWatchedNumber(storyChunksForm.watch("tokenId"));
    if (tokenId === undefined) {
      setStoryChunksError(t("search.validation.tokenIdRequired"));
      return;
    }
    await onQueryStoryChunks({ tokenId, pageSize: storyChunksPageSize }, prev);
  }, [onQueryStoryChunks, storyChunksForm, storyChunksOffset, storyChunksPageSize, t]);

  const onQueryChildren = useCallback(
    async (data: ChildrenForm, startOffset?: number) => {
      setChildrenQueried(true);
      if ((startOffset ?? 0) === 0) {
        setChildrenData(emptyChildrenPageData);
        setChildrenTotal(0);
        setChildrenHasMore(false);
        setChildrenOffset(0);
      }
      setChildrenLoading(true);
      setChildrenError(null);
      try {
        if (!treeGateway) throw new Error(t("search.queryFailed"));
        const offset = startOffset !== undefined ? startOffset : childrenOffset;
        const parentVersionIndex = Number(data.parentVersionIndex);
        if (!Number.isFinite(parentVersionIndex)) {
          throw new Error("Invalid parent version index");
        }
        const out = await treeGateway.listChildrenPage(
          data.parentHash,
          parentVersionIndex,
          offset,
          data.pageSize,
        );
        const { childHashes, childVersions, totalChildren, hasMore, nextOffset } = out;
        setChildrenData({ childHashes, childVersions });
        setChildrenTotal(totalChildren);
        setChildrenHasMore(hasMore);
        setChildrenOffset(nextOffset);
      } catch (error: any) {
        setChildrenError(getQueryErrorMessage(error));
      } finally {
        setChildrenLoading(false);
      }
    },
    [childrenOffset, getQueryErrorMessage, t, treeGateway],
  );

  const onResetChildrenQuery = useCallback(() => {
    setChildrenData(emptyChildrenPageData);
    setChildrenTotal(0);
    setChildrenHasMore(false);
    setChildrenOffset(0);
    setChildrenError(null);
    setChildrenQueried(false);
  }, []);

  const onChildrenNext = useCallback(async () => {
    const parentVersionIndex = getWatchedNumber(childrenForm.watch("parentVersionIndex"));
    if (parentVersionIndex === undefined) {
      setChildrenError(t("search.validation.versionIndexRequired"));
      return;
    }
    await onQueryChildren({
      parentHash: childrenForm.watch("parentHash") || "",
      parentVersionIndex,
      pageSize: childrenPageSize,
    });
  }, [childrenForm, childrenPageSize, onQueryChildren, t]);

  const onChildrenPrev = useCallback(async () => {
    const prev = getPreviousPageOffset(childrenOffset, childrenPageSize);
    const parentVersionIndex = getWatchedNumber(childrenForm.watch("parentVersionIndex"));
    if (parentVersionIndex === undefined) {
      setChildrenError(t("search.validation.versionIndexRequired"));
      return;
    }
    await onQueryChildren(
      {
        parentHash: childrenForm.watch("parentHash") || "",
        parentVersionIndex,
        pageSize: childrenPageSize,
      },
      prev,
    );
  }, [childrenForm, childrenOffset, childrenPageSize, onQueryChildren, t]);

  return {
    t,
    sanitizeNumberInput,
    formatNumericError,
    validationMessages: {
      tokenId: tokenIdValidationMessage,
      pageSize: pageSizeValidationMessage,
      versionIndex: versionIndexValidationMessage,
      versionIndexOne: versionIndexOneValidationMessage,
    },
    onCopy,
    hash: {
      hashCalcRef,
      hasPassphrase: hashHasPassphrase,
      onPublicFormChange: onHashPublicFormChange,
    },
    chunkTypes: {
      getChunkTypeLabel,
    },
    versions: {
      form: versionsForm,
      state: {
        data: versionsData,
        total: versionsTotal,
        offset: versionsOffset,
        loading: versionsLoading,
        error: versionsError,
        queried: versionsQueried,
        hasMore: versionsHasMore,
      },
      actions: {
        query: onQueryPersonVersions,
        reset: onResetVersionsQuery,
        next: onVersionsNext,
        prev: onVersionsPrev,
      },
    },
    endorsement: {
      form: endorsementForm,
      state: {
        data: endorsementData,
        total: endorsementTotal,
        offset: endorsementOffset,
        loading: endorsementLoading,
        error: endorsementError,
        queried: endorsementQueried,
        hasMore: endorsementHasMore,
      },
      actions: {
        query: onQueryEndorsementStats,
        reset: onResetEndorsementQuery,
        next: onEndorsementNext,
        prev: onEndorsementPrev,
      },
    },
    trustedEndorsers: {
      form: trustedEndorsersForm,
      state: {
        data: trustedEndorsersData,
        total: trustedEndorsersTotal,
        offset: trustedEndorsersOffset,
        loading: trustedEndorsersLoading,
        error: trustedEndorsersError,
        queried: trustedEndorsersQueried,
        hasMore: trustedEndorsersHasMore,
      },
      actions: {
        query: onQueryTrustedEndorsers,
        reset: onResetTrustedEndorsersQuery,
        next: onTrustedEndorsersNext,
        prev: onTrustedEndorsersPrev,
      },
    },
    children: {
      form: childrenForm,
      state: {
        data: childrenData,
        total: childrenTotal,
        offset: childrenOffset,
        loading: childrenLoading,
        error: childrenError,
        queried: childrenQueried,
        hasMore: childrenHasMore,
      },
      actions: {
        query: onQueryChildren,
        reset: onResetChildrenQuery,
        next: onChildrenNext,
        prev: onChildrenPrev,
      },
    },
    storyChunks: {
      form: storyChunksForm,
      state: {
        data: storyChunksData,
        total: storyChunksTotal,
        offset: storyChunksOffset,
        loading: storyChunksLoading,
        error: storyChunksError,
        queried: storyChunksQueried,
        hasMore: storyChunksHasMore,
      },
      actions: {
        query: onQueryStoryChunks,
        reset: onResetStoryChunksQuery,
        next: onStoryChunksNext,
        prev: onStoryChunksPrev,
      },
    },
    uri: {
      form: uriForm,
      state: {
        data: uriData,
        total: uriTotal,
        offset: uriOffset,
        loading: uriLoading,
        error: uriError,
        queried: uriQueried,
        hasMore: uriHasMore,
      },
      actions: {
        query: onQueryTokenURIHistory,
        reset: onResetUriQuery,
        next: onUriNext,
        prev: onUriPrev,
      },
    },
  };
}

export type SearchPageController = ReturnType<typeof useSearchPageController>;
