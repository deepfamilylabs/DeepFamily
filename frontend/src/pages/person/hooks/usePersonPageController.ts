import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../../domains/config";
import { findNodeByTokenId } from "../../../domains/person";
import { useTreeGraphData, useTreeNodeAccess } from "../../../domains/tree";
import type { NodeData } from "../../../shared/model";
import { useToast } from "../../../shared/ui";
import {
  buildPrefetchedStoryDetailData,
  buildStoryDetailData,
  getChunkParagraphs,
  getFreshCachedStoryDetail,
  getFullStoryParagraphs,
  groupStoryChunks,
  isValidPersonTokenId,
  mapPersonStoryFetchError,
  type CachedStoryDetail,
  type PersonSectionKey,
  type PersonStoryViewMode,
  type PrefetchedStoryDetailState,
  type StoryDetailData,
} from "../model/personPageModel";

export function usePersonPageController() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { nodesData } = useTreeGraphData();
  const { getStoryData, getNodeByTokenId, getOwnerOf } = useTreeNodeAccess();
  const config = useConfig();
  const toast = useToast();

  const prefetched = (location.state as PrefetchedStoryDetailState | undefined)?.prefetchedStory;
  const dataRef = useRef<StoryDetailData | null>(null);
  const sectionRefs = useRef<Map<PersonSectionKey, HTMLElement>>(new Map());

  const [data, setData] = useState<StoryDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<PersonStoryViewMode>("sections");
  const [activeSection, setActiveSection] = useState<PersonSectionKey | null>(null);

  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
  }, [tokenId]);

  useEffect(() => {
    if (data?.fullName) {
      document.title = t("person.pageTitle", { name: data.fullName });
    }
  }, [data?.fullName, t]);

  const fullStoryParagraphs = useMemo(
    () => getFullStoryParagraphs(data?.fullStory, viewMode),
    [data?.fullStory, viewMode],
  );
  const chunkParagraphs = useMemo(() => getChunkParagraphs(data?.storyChunks), [data?.storyChunks]);
  const groupedChunks = useMemo(() => groupStoryChunks(data?.storyChunks), [data?.storyChunks]);

  const toggleChunk = useCallback((idx: number) => {
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wantEdit = params.get("edit") === "1";
    if (!wantEdit || !tokenId) return;

    params.delete("edit");
    const nextSearch = params.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });

    const state: PrefetchedStoryDetailState = {};
    if (data?.storyMetadata || data?.storyChunks) {
      state.prefetchedStory = {
        tokenId,
        storyMetadata: data.storyMetadata,
        storyChunks: data.storyChunks,
      };
    }
    navigate(`/editor/${tokenId}`, { state });
  }, [data?.storyChunks, data?.storyMetadata, location.pathname, location.search, navigate, tokenId]);

  useEffect(() => {
    if (!tokenId) return;
    const prefetchedData = buildPrefetchedStoryDetailData(tokenId, prefetched);
    if (!prefetchedData) return;
    setData((prev) => prev || prefetchedData);
    setLoading(false);
  }, [prefetched, tokenId]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const fetchStoryData = useCallback(async () => {
    if (!tokenId || !isValidPersonTokenId(tokenId)) {
      setError(t("person.invalidTokenId", "Invalid token ID"));
      setLoading(false);
      return;
    }

    try {
      const hasExistingData = !!dataRef.current;
      if (!hasExistingData) {
        setLoading(true);
      }
      setError(null);

      let node: NodeData | null = findNodeByTokenId(nodesData || {}, tokenId) ?? null;
      if (!node) {
        node = (await getNodeByTokenId(tokenId)) ?? null;
      }

      let story: CachedStoryDetail | null = getFreshCachedStoryDetail(node);
      if (!story) {
        story = (await getStoryData(tokenId)) as CachedStoryDetail | null;
      }

      let ownerAddr: string | undefined = node?.owner;
      if (!ownerAddr) ownerAddr = (await getOwnerOf(tokenId)) || undefined;

      setData(buildStoryDetailData({ tokenId, node, story, owner: ownerAddr }));
    } catch (err) {
      setError(
        mapPersonStoryFetchError(err, (key, fallback) =>
          fallback === undefined ? t(key) : t(key, fallback),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [getNodeByTokenId, getOwnerOf, getStoryData, nodesData, t, tokenId]);

  useEffect(() => {
    fetchStoryData();
  }, [fetchStoryData]);

  useEffect(() => {
    if (viewMode !== "sections" || groupedChunks.length === 0) return;

    const handleScroll = () => {
      const scrollPosition = window.scrollY + 80;
      const entries: Array<{ key: PersonSectionKey; top: number }> = [];
      sectionRefs.current.forEach((el, key) => {
        entries.push({ key, top: el.offsetTop });
      });

      let nextActive: PersonSectionKey | null = null;
      const numericEntries = entries
        .filter((entry): entry is { key: number; top: number } => typeof entry.key === "number")
        .sort((a, b) => a.top - b.top);

      for (let i = 0; i < numericEntries.length; i++) {
        const curr = numericEntries[i];
        const nextTop =
          i < numericEntries.length - 1 ? numericEntries[i + 1].top : Number.POSITIVE_INFINITY;
        if (scrollPosition >= curr.top && scrollPosition < nextTop) {
          nextActive = curr.key;
          break;
        }
      }

      if (nextActive === null && numericEntries.length) {
        const nearBottom =
          window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        if (nearBottom) {
          nextActive = numericEntries[numericEntries.length - 1].key;
        }
      }

      if (nextActive === null) {
        const basic = entries.find((entry) => entry.key === "basicInfo");
        if (basic && scrollPosition >= basic.top) {
          const anchorTops = entries
            .filter((entry) => typeof entry.key === "number" || entry.key === "profileTop")
            .map((entry) => entry.top);
          const firstAnchorTop = anchorTops.length
            ? Math.min(...anchorTops)
            : Number.POSITIVE_INFINITY;
          if (scrollPosition < firstAnchorTop) nextActive = "basicInfo";
        }
      }

      if (nextActive === null) {
        const profileTop = entries.find((entry) => entry.key === "profileTop");
        if (profileTop && scrollPosition >= profileTop.top) {
          const firstGroupTop = numericEntries.length
            ? numericEntries[0].top
            : Number.POSITIVE_INFINITY;
          if (scrollPosition < firstGroupTop) nextActive = "profileTop";
        }
      }

      if (nextActive !== null) {
        setActiveSection((current) => (current === nextActive ? current : nextActive));
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [groupedChunks, viewMode]);

  const registerSection = useCallback(
    (key: PersonSectionKey) => (element: HTMLElement | null) => {
      if (element) {
        sectionRefs.current.set(key, element);
      } else {
        sectionRefs.current.delete(key);
      }
    },
    [],
  );

  const scrollToSection = useCallback((key: PersonSectionKey) => {
    const element = sectionRefs.current.get(key);
    if (!element) return;
    setActiveSection(key);
    const top = element.offsetTop - 80;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  const copyText = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(text);
          toast.show(t("search.copied"));
          return;
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
        toast.show(ok ? t("search.copied") : t("search.copyFailed"));
      } catch {
        toast.show(t("search.copyFailed"));
      }
    },
    [t, toast],
  );

  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  }, [navigate]);

  const viewFamilyTree = useCallback(() => {
    if (!data?.personHash || data.versionIndex === undefined) return;
    config.update({
      rootHash: data.personHash,
      rootVersionIndex: data.versionIndex,
    });
    navigate(`/familyTree?root=${data.personHash}&v=${data.versionIndex}`);
  }, [config, data?.personHash, data?.versionIndex, navigate]);

  const openEditorInNewTab = useCallback(() => {
    if (!tokenId) return;
    window.open(`/editor/${tokenId}`, "_blank", "noopener,noreferrer");
  }, [tokenId]);

  return {
    tokenId,
    data,
    loading,
    error,
    expandedChunks,
    viewMode,
    activeSection,
    fullStoryParagraphs,
    chunkParagraphs,
    groupedChunks,
    setViewMode,
    toggleChunk,
    retry: fetchStoryData,
    goBack,
    viewFamilyTree,
    openEditorInNewTab,
    copyText,
    scrollToSection,
    registerSection,
  };
}

export type PersonPageController = ReturnType<typeof usePersonPageController>;
