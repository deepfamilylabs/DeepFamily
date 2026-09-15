import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConfig } from "../../../domains/config";
import { useNftStoryAccess } from "../../../domains/person";
import { useTreeGraphData, useTreeNodeAccess } from "../../../domains/tree";
import { findNodeByTokenId, type NodeData } from "../../../shared/model";
import { useToast } from "../../../shared/ui";
import {
  buildPrefetchedStoryDetailData,
  buildStoryDetailData,
  getRecordParagraphs,
  getFreshCachedStoryDetail,
  getFullStoryParagraphs,
  groupStoryRecords,
  isValidPersonTokenId,
  mapPersonStoryFetchError,
  type CachedStoryDetail,
  type PersonSectionKey,
  type PersonStoryViewMode,
  type PrefetchedStoryDetailState,
  type StoryDetailData,
} from "../model/personPageModel";
import { isRecordFolded, sortSectionsForReading } from "../model/personStoryLayout";

/** The biography's key among the page's scroll anchors; type sections use their type number. */
export const BIOGRAPHY_SECTION: PersonSectionKey = "biography";

/**
 * How far below the viewport top a section counts as the one being read. The
 * header is sticky everywhere; below xl the section chips stick under it too.
 */
function readingLine(): number {
  const wide =
    typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1280px)").matches;
  return wide ? 96 : 152;
}

export function usePersonPageController() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { nodesData } = useTreeGraphData();
  const { getStoryData, getNodeByTokenId, getOwnerOf } = useTreeNodeAccess();
  const config = useConfig();
  const toast = useToast();
  const storyAccess = useNftStoryAccess(tokenId);

  const prefetched = (location.state as PrefetchedStoryDetailState | undefined)?.prefetchedStory;
  const dataRef = useRef<StoryDetailData | null>(null);
  const sectionRefs = useRef<Map<PersonSectionKey, HTMLElement>>(new Map());
  const recordRefs = useRef<Map<number, HTMLElement>>(new Map());
  /** Set while a Contents jump is scrolling the page; calling it hands the reading position back. */
  const navLockRef = useRef<(() => void) | null>(null);

  const [data, setData] = useState<StoryDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<PersonStoryViewMode>("sections");
  const [activeSection, setActiveSection] = useState<PersonSectionKey | null>(null);
  const [activeRecord, setActiveRecord] = useState<number | null>(null);

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
  const recordParagraphs = useMemo(
    () => getRecordParagraphs(data?.storyRecords),
    [data?.storyRecords],
  );
  /** Type sections in reading order — the order Contents lists them and the page shows them. */
  const groupedRecords = useMemo(
    () => sortSectionsForReading(groupStoryRecords(data?.storyRecords)),
    [data?.storyRecords],
  );

  const toggleRecord = useCallback((idx: number) => {
    setExpandedRecords((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }, []);

  const toggleSection = useCallback((type: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wantEdit = params.get("edit") === "1";
    if (!wantEdit || !tokenId || storyAccess.checking) return;

    params.delete("edit");
    const nextSearch = params.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });

    if (!storyAccess.canEdit) return;

    const state: PrefetchedStoryDetailState = {};
    if (data?.storyMetadata || data?.storyRecords) {
      state.prefetchedStory = {
        tokenId,
        storyMetadata: data.storyMetadata,
        storyRecords: data.storyRecords,
      };
    }
    navigate(`/editor/${tokenId}`, { state });
  }, [
    data?.storyRecords,
    data?.storyMetadata,
    location.pathname,
    location.search,
    navigate,
    tokenId,
    storyAccess.canEdit,
    storyAccess.checking,
  ]);

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

  /**
   * Which section and which record are being read: the last of each whose top
   * has passed the reading line. At the very bottom of the page the last
   * section wins, since a short final section may never reach the line.
   */
  useEffect(() => {
    if (viewMode !== "sections" || !data) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      // A Contents jump owns the reading position until the reader scrolls on their own.
      if (navLockRef.current) return;
      const line = readingLine();
      const sectionOrder: PersonSectionKey[] = [
        BIOGRAPHY_SECTION,
        ...groupedRecords.map((group) => group.type),
      ].filter((key) => sectionRefs.current.has(key));
      if (sectionOrder.length === 0) return;

      let nextSection = sectionOrder[0];
      for (const key of sectionOrder) {
        const element = sectionRefs.current.get(key);
        if (element && element.getBoundingClientRect().top <= line) nextSection = key;
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && window.scrollY > 0) nextSection = sectionOrder[sectionOrder.length - 1];

      let nextRecord: number | null = null;
      const section = groupedRecords.find((group) => group.type === nextSection);
      for (const record of section?.records ?? []) {
        const element = recordRefs.current.get(record.recordIndex);
        if (element && element.getBoundingClientRect().top <= line) nextRecord = record.recordIndex;
      }

      setActiveSection((current) => (current === nextSection ? current : nextSection));
      setActiveRecord((current) => (current === nextRecord ? current : nextRecord));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [data, expandedSections, groupedRecords, viewMode]);

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

  const registerRecord = useCallback(
    (recordIndex: number) => (element: HTMLElement | null) => {
      if (element) {
        recordRefs.current.set(recordIndex, element);
      } else {
        recordRefs.current.delete(recordIndex);
      }
    },
    [],
  );

  /**
   * Holds the reading position on a Contents target while the page scrolls to
   * it. Left to the scroll position it walks through every section the smooth
   * scroll passes, and Contents opens and closes each one on the way. The
   * reader's own next gesture — wheel, touch, key or pointer — hands it back,
   * which also keeps a target too close to the end to reach the line current.
   */
  const lockReadingPosition = useCallback(() => {
    navLockRef.current?.();
    const gestures = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    const release = () => {
      gestures.forEach((name) => window.removeEventListener(name, release, true));
      if (navLockRef.current === release) navLockRef.current = null;
    };
    gestures.forEach((name) =>
      window.addEventListener(name, release, { capture: true, passive: true }),
    );
    navLockRef.current = release;
  }, []);

  useEffect(() => () => navLockRef.current?.(), []);

  const scrollToElement = useCallback((element: HTMLElement) => {
    const top = element.getBoundingClientRect().top + window.scrollY - (readingLine() - 8);
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, []);

  const scrollToSection = useCallback(
    (key: PersonSectionKey) => {
      const element = sectionRefs.current.get(key);
      if (!element) return;
      lockReadingPosition();
      setActiveSection(key);
      setActiveRecord(null);
      scrollToElement(element);
    },
    [lockReadingPosition, scrollToElement],
  );

  /** Jumps to one record, opening its section's fold first when the record is behind it. */
  const scrollToRecord = useCallback(
    (type: number, recordIndex: number) => {
      const section = groupedRecords.find((group) => group.type === type);
      const mustUnfold =
        !!section && !expandedSections.has(type) && isRecordFolded(section.records, recordIndex);
      lockReadingPosition();
      setActiveSection(type);
      setActiveRecord(recordIndex);
      const jump = () => {
        const element = recordRefs.current.get(recordIndex);
        if (element) scrollToElement(element);
      };
      if (!mustUnfold) {
        jump();
        return;
      }
      setExpandedSections((prev) => new Set(prev).add(type));
      window.requestAnimationFrame(() => window.requestAnimationFrame(jump));
    },
    [expandedSections, groupedRecords, lockReadingPosition, scrollToElement],
  );

  const copyText = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(text);
          toast.success(t("search.copied"));
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
        if (ok) {
          toast.success(t("search.copied"));
        } else {
          toast.error(t("search.copyFailed"));
        }
      } catch {
        toast.error(t("search.copyFailed"));
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
    if (!tokenId || !storyAccess.canEdit) return;
    window.open(`/editor/${tokenId}`, "_blank", "noopener,noreferrer");
  }, [tokenId, storyAccess.canEdit]);

  return {
    tokenId,
    canEditStory: storyAccess.canEdit,
    data,
    loading,
    error,
    expandedRecords,
    expandedSections,
    viewMode,
    activeSection,
    activeRecord,
    fullStoryParagraphs,
    recordParagraphs,
    groupedRecords,
    setViewMode,
    toggleRecord,
    toggleSection,
    retry: fetchStoryData,
    goBack,
    viewFamilyTree,
    openEditorInNewTab,
    copyText,
    scrollToSection,
    scrollToRecord,
    registerSection,
    registerRecord,
  };
}

export type PersonPageController = ReturnType<typeof usePersonPageController>;
