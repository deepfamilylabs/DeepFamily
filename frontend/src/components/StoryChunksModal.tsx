import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  X,
  User,
  Calendar,
  Book,
  BookOpen,
  FileText,
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Layers,
  Hash,
  AlertCircle,
  Wallet,
  Link,
  Edit2,
  Star,
  Check,
} from "lucide-react";
import EndorseCompactModal from "./modals/EndorseCompactModal";
import {
  NodeData,
  StoryChunk,
  hasDetailedStory as hasDetailedStoryFn,
  birthDateString,
  deathDateString,
  genderText as genderTextFn,
  isMinted,
  formatUnixSeconds,
  shortAddress,
  formatHashMiddle,
} from "../types/graph";
import { useTreeData } from "../context/TreeDataContext";
import {
  getChunkTypeOptions,
  getChunkTypeI18nKey,
  getChunkTypeIcon,
  getChunkTypeColorClass,
  getChunkTypeBorderColorClass,
} from "../constants/chunkTypes";
// owner/address will be resolved via TreeDataContext caching

interface StoryChunksModalProps {
  person: NodeData;
  isOpen: boolean;
  onClose: () => void;
}

interface StoryData {
  chunks: StoryChunk[];
  fullStory: string;
  integrity: {
    missing: number[];
    lengthMatch: boolean;
    hashMatch: boolean | null;
    computedLength: number;
    computedHash?: string;
  };
  loading: boolean;
  integrityChecking: boolean;
  error?: string;
}

// Removed computeStoryIntegrity function as it's now handled in TreeDataContext

export default function StoryChunksModal({ person, isOpen, onClose }: StoryChunksModalProps) {
  const { t } = useTranslation();
  const { getStoryData, getOwnerOf, bumpEndorsementCount } = useTreeData();
  const nameContainerRef = useRef<HTMLDivElement | null>(null);
  const nameTextRef = useRef<HTMLSpanElement | null>(null);
  const [marquee, setMarquee] = useState(false);
  const navigate = useNavigate();

  const [storyData, setStoryData] = useState<StoryData>({
    chunks: [],
    fullStory: "",
    integrity: { missing: [], lengthMatch: true, hashMatch: null, computedLength: 0 },
    loading: false,
    integrityChecking: false,
  });

  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"chunks" | "full">("chunks");
  const [centerHint, setCenterHint] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const startYRef = useRef<number | null>(null);
  const [owner, setOwner] = useState<string | undefined>(person.owner);
  const [showEndorseModal, setShowEndorseModal] = useState(false);
  const [endorsementCount, setEndorsementCount] = useState<number>(person.endorsementCount ?? 0);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(min-width: 640px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(min-width: 640px)");
    const onChange = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsDesktop((e as MediaQueryListEvent).matches ?? (e as MediaQueryList).matches);
    try {
      mql.addEventListener("change", onChange as any);
    } catch {
      (mql as any).addListener(onChange);
    }
    onChange(mql as any);
    return () => {
      try {
        mql.removeEventListener("change", onChange as any);
      } catch {
        (mql as any).removeListener(onChange);
      }
    };
  }, []);

  const personHasDetailedStory = useMemo(() => hasDetailedStoryFn(person), [person]);

  const chunkTypeOptions = useMemo(() => getChunkTypeOptions(t), [t]);

  const getChunkTypeLabel = useCallback(
    (type: number | string | null | undefined) => {
      if (type === null || type === undefined || type === "") {
        return chunkTypeOptions[0]?.label || t("chunkTypes.unknown", "Unknown");
      }
      const numericType = Number(type);
      if (Number.isFinite(numericType)) {
        const match = chunkTypeOptions.find((opt) => opt.value === numericType);
        if (match) return match.label;
      }
      return t("chunkTypes.unknown", "Unknown");
    },
    [chunkTypeOptions, t],
  );

  const resolveAttachmentUrl = useCallback((cid: string) => {
    if (!cid) return "";
    if (cid.startsWith("ipfs://")) {
      return `https://ipfs.io/ipfs/${cid.slice(7)}`;
    }
    return cid;
  }, []);

  // Keep local owner state in sync with NodeData updates
  useEffect(() => {
    if (isOpen) setOwner(person.owner);
  }, [person.owner, isOpen]);
  useEffect(() => {
    setEndorsementCount(person.endorsementCount ?? 0);
  }, [person.endorsementCount, person.personHash, person.versionIndex]);

  // Computed meta for compact row under Detailed Story
  const chunksCount = useMemo(
    () => person.storyMetadata?.totalChunks ?? storyData.chunks.length,
    [person.storyMetadata, storyData.chunks],
  );
  const lengthBytes = useMemo(
    () =>
      person.storyMetadata?.totalLength ??
      (storyData.integrity.computedLength || storyData.fullStory.length),
    [person.storyMetadata, storyData.integrity.computedLength, storyData.fullStory.length],
  );
  const integrityOk = useMemo(
    () =>
      !!storyData.integrity &&
      storyData.integrity.missing.length === 0 &&
      storyData.integrity.lengthMatch &&
      storyData.integrity.hashMatch === true,
    [storyData.integrity],
  );

  // Format dates
  const formatDate = useMemo(
    () => ({
      birth: birthDateString(person),
      death: deathDateString(person),
    }),
    [person],
  );

  // Gender text
  const genderText = useMemo(() => genderTextFn(person.gender, t as any), [person.gender, t]);

  // Copy function
  const copyText = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(text);
          setCenterHint(t("common.copied", "Copied"));
          setTimeout(() => setCenterHint(null), 1200);
          return true;
        }
      } catch {}
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        // Using deprecated execCommand as fallback for older browsers
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        setCenterHint(ok ? t("common.copied", "Copied") : t("common.copyFailed", "Failed to copy"));
        setTimeout(() => setCenterHint(null), 1200);
        return ok;
      } catch {
        setCenterHint(t("common.copyFailed", "Failed to copy"));
        setTimeout(() => setCenterHint(null), 1200);
        return false;
      }
    },
    [t],
  );

  const SmartHash: React.FC<{ text?: string | null }> = ({ text }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const measureRef = useRef<HTMLSpanElement | null>(null);
    const [useAbbrev, setUseAbbrev] = useState<boolean>(() => !isDesktop);
    const fullText = text ?? "";
    useEffect(() => {
      if (!text) {
        setUseAbbrev(false);
        return;
      }
      if (!isDesktop) {
        setUseAbbrev(true);
        return;
      }
      const container = containerRef.current;
      const measure = measureRef.current;
      if (!container || !measure) return;
      const available = container.clientWidth;
      const needed = measure.scrollWidth;
      setUseAbbrev(needed > available + 1);
    }, [fullText, isDesktop]);
    useEffect(() => {
      if (!isDesktop) return;
      const onResize = () => {
        const container = containerRef.current;
        const measure = measureRef.current;
        if (!container || !measure) return;
        setUseAbbrev(measure.scrollWidth > container.clientWidth + 1);
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, [isDesktop]);
    if (!text) return <span>-</span>;
    return (
      <div ref={containerRef} className="relative min-w-0" title={text}>
        <span className="block whitespace-nowrap overflow-hidden text-ellipsis">
          {useAbbrev ? formatHashMiddle(text) : text}
        </span>
        <span
          ref={measureRef}
          className="absolute left-0 top-0 opacity-0 pointer-events-none whitespace-nowrap"
        >
          {text}
        </span>
      </div>
    );
  };

  const SmartAddress: React.FC<{ text?: string | null }> = ({ text }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const measureRef = useRef<HTMLSpanElement | null>(null);
    const [useAbbrev, setUseAbbrev] = useState<boolean>(() => !isDesktop);
    const fullText = text ?? "";
    useEffect(() => {
      if (!text) {
        setUseAbbrev(false);
        return;
      }
      if (!isDesktop) {
        setUseAbbrev(true);
        return;
      }
      const container = containerRef.current;
      const measure = measureRef.current;
      if (!container || !measure) return;
      const available = container.clientWidth;
      const needed = measure.scrollWidth;
      setUseAbbrev(needed > available + 1);
    }, [fullText, isDesktop]);
    useEffect(() => {
      if (!isDesktop) return;
      const onResize = () => {
        const container = containerRef.current;
        const measure = measureRef.current;
        if (!container || !measure) return;
        setUseAbbrev(measure.scrollWidth > container.clientWidth + 1);
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, [isDesktop]);
    if (!text) return <span>-</span>;
    return (
      <div ref={containerRef} className="relative min-w-0" title={text}>
        <span className="block whitespace-nowrap overflow-hidden text-ellipsis">
          {useAbbrev ? shortAddress(text) : text}
        </span>
        <span
          ref={measureRef}
          className="absolute left-0 top-0 opacity-0 pointer-events-none whitespace-nowrap"
        >
          {text}
        </span>
      </div>
    );
  };

  // Fetch story data using TreeDataContext
  const fetchStoryData = useCallback(async () => {
    if (!person.tokenId) {
      return;
    }

    setStoryData((prev) => ({
      ...prev,
      loading: true,
      integrityChecking: false,
      error: undefined,
    }));

    try {
      const data = await getStoryData(person.tokenId);
      // Handle offline mode with no cached data
      if (!data) {
        setStoryData({
          chunks: [],
          fullStory: "",
          integrity: { missing: [], lengthMatch: true, hashMatch: null, computedLength: 0 },
          loading: false,
          integrityChecking: false,
          error: t("storyChunksModal.noStoryData", "No story data available"),
        });
        return;
      }

      // If there are chunks, show integrity checking status first
      if (data.chunks.length > 0) {
        setStoryData((prev) => ({
          ...prev,
          chunks: data.chunks,
          fullStory: data.fullStory,
          loading: false,
          integrityChecking: true,
        }));

        // Small delay to show "checking..." status
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      setStoryData({
        chunks: data.chunks,
        fullStory: data.fullStory,
        integrity: data.integrity,
        loading: false,
        integrityChecking: false,
      });
    } catch (err: any) {
      console.error("Failed to fetch story chunks:", err);
      setStoryData((prev) => ({
        ...prev,
        loading: false,
        integrityChecking: false,
        error: err.message || t("storyChunksModal.fetchError", "Failed to load story data"),
      }));
    }
  }, [person.tokenId, getStoryData, t]);

  // Load data when opened
  useEffect(() => {
    if (isOpen) {
      fetchStoryData();
    }
  }, [isOpen, fetchStoryData]);

  // Fetch owner address for token when modal opens (uses cached getter and backfills NodeData)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isOpen) return;
        if (!person.tokenId || person.tokenId === "0") return;
        const addr = await getOwnerOf(person.tokenId);
        if (!cancelled) setOwner(addr || undefined);
      } catch {
        if (!cancelled) setOwner(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, person.tokenId, getOwnerOf]);

  // Toggle chunk expansion
  const toggleChunk = (index: number) => {
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Remove unused handlePreload function - preloading is handled in PersonStoryCard

  // Determine if name overflows to enable marquee
  useEffect(() => {
    if (!isOpen) return;
    const check = () => {
      if (nameContainerRef.current && nameTextRef.current) {
        const need = nameTextRef.current.scrollWidth > nameContainerRef.current.clientWidth + 4;
        setMarquee(need);
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [isOpen, person.fullName]);

  // Prevent background scroll when open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[1200] overflow-x-hidden touch-pan-y" onClick={onClose}>
      {/* Modal Container */}
      <div className="flex items-end sm:items-center justify-center h-full w-full p-0 sm:p-4 pb-[env(safe-area-inset-bottom)]">
        <div
          className="relative flex flex-col w-full max-w-4xl h-[95vh] sm:h-[85vh] bg-white dark:bg-[#0a0a0a] rounded-t-[32px] sm:rounded-[32px] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.2)] dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)] border border-gray-100 dark:border-gray-800 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          style={{
            transform: dragging ? `translateY(${dragOffset}px)` : undefined,
            transitionDuration: dragging ? "0ms" : undefined,
          }}
        >
          {/* Center Hint */}
          {centerHint && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-30">
              <div className="rounded-lg bg-black/80 dark:bg-black/70 text-white px-4 py-2 text-sm font-medium animate-fade-in shadow-lg">
                {centerHint}
              </div>
            </div>
          )}
          {/* Header (sticky for mobile) */}
          <div
            className="sticky top-0 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl px-6 py-5 pt-8 sm:pt-6 border-b border-gray-100 dark:border-gray-800 z-40 touch-none flex-shrink-0"
            onPointerDown={(e) => {
              (e.currentTarget as any).setPointerCapture?.(e.pointerId);
              startYRef.current = e.clientY;
              setDragging(true);
            }}
            onPointerMove={(e) => {
              if (!dragging || startYRef.current == null) return;
              const dy = Math.max(0, e.clientY - startYRef.current);
              setDragOffset(dy);
            }}
            onPointerUp={() => {
              if (!dragging) return;
              const shouldClose = dragOffset > 150;
              setDragging(false);
              setDragOffset(0);
              if (shouldClose) onClose();
            }}
            onPointerCancel={() => {
              setDragging(false);
              setDragOffset(0);
            }}
            onTouchStart={(e) => {
              startYRef.current = e.touches[0].clientY;
              setDragging(true);
            }}
            onTouchMove={(e) => {
              if (!dragging || startYRef.current == null) return;
              const dy = Math.max(0, e.touches[0].clientY - startYRef.current);
              setDragOffset(dy);
            }}
            onTouchEnd={() => {
              if (!dragging) return;
              const shouldClose = dragOffset > 150;
              setDragging(false);
              setDragOffset(0);
              if (shouldClose) onClose();
            }}
          >
            {/* Mobile Drag Handle */}
            <div className="sm:hidden absolute top-3 left-1/2 -translate-x-1/2 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-800" />

            <div className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-5 min-w-0">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-orange-400 to-red-500 p-0.5 shadow-lg shadow-orange-500/20 flex-shrink-0">
                  <div className="w-full h-full rounded-full bg-white dark:bg-black flex items-center justify-center">
                    <User
                      className="w-6 h-6 sm:w-7 sm:h-7 text-gray-900 dark:text-white"
                      strokeWidth={2}
                    />
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-0.5">
                  <div ref={nameContainerRef} className="relative overflow-hidden">
                    <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white whitespace-nowrap">
                      <span
                        ref={nameTextRef}
                        className={`inline-block pr-8 ${marquee ? "will-change-transform animate-[marquee_15s_linear_infinite]" : ""}`}
                      >
                        {person.fullName || `Person ${person.personHash.slice(0, 8)}...`}
                      </span>
                    </h2>
                    {marquee && (
                      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white dark:from-[#0a0a0a] to-transparent" />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-3">
                    {/* Tags */}
                    {genderText && (
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        {genderText}
                      </span>
                    )}
                    {isMinted(person) && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-700" />
                        <span className="font-mono text-sm font-medium text-gray-500 dark:text-gray-400">
                          #{person.tokenId}
                        </span>
                      </>
                    )}
                    {(endorsementCount > 0 || isMinted(person)) && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {endorsementCount > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowEndorseModal(true);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none flex-shrink-0 whitespace-nowrap"
                          >
                            <Star
                              className="w-4 h-4 text-gray-400 group-hover:text-white"
                              strokeWidth={2}
                            />
                            <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
                              {endorsementCount}
                            </span>
                          </button>
                        )}

                        {isMinted(person) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(
                                `/person/${person.tokenId || person.id}`,
                                "_blank",
                                "noopener,noreferrer",
                              );
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none flex-shrink-0 whitespace-nowrap"
                            title={t("storyChunksModal.peopleEncyclopedia", "People Encyclopedia")}
                          >
                            <BookOpen
                              className="w-4 h-4 text-gray-400 group-hover:text-white"
                              strokeWidth={2}
                            />
                            <span className="hidden sm:inline text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
                              {t("familyTree.nodeDetail.encyclopedia", "Encyclopedia")}
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                aria-label="close"
                className="p-2 rounded-full bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all duration-200 flex-shrink-0 hover:scale-105 active:scale-95"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <X size={20} className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.5} />
              </button>
            </div>
          </div>
          <EndorseCompactModal
            isOpen={showEndorseModal}
            onClose={() => setShowEndorseModal(false)}
            personHash={person.personHash}
            versionIndex={Number(person.versionIndex || 1)}
            versionData={{
              fullName: person.fullName,
              endorsementCount,
            }}
            onSuccess={() => {
              setEndorsementCount((c) => c + 1);
              bumpEndorsementCount(person.personHash, Number(person.versionIndex || 1), 1);
            }}
          />
          {/* Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden touch-pan-y">
            <div className="p-4 sm:p-6 pb-24 sm:pb-6 space-y-6">
              {/* extra bottom space for safe touch area */}
              {/* Life Events Section */}
              {(formatDate.birth || person.birthPlace || formatDate.death || person.deathPlace) && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider px-1">
                    {t("storyChunksModal.lifeEvents", "Life Events")}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {(formatDate.birth || person.birthPlace) && (
                      <div className="group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] border-l-emerald-500/80 hover:shadow-[0_8px_30px_-4px_rgba(16,185,129,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(16,185,129,0.25)] transition-all duration-300">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                            {t("storyChunksModal.born", "Born")}
                          </div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white leading-relaxed">
                            {[formatDate.birth, person.birthPlace].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      </div>
                    )}

                    {(formatDate.death || person.deathPlace) && (
                      <div className="group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] border-l-gray-400 hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.25)] transition-all duration-300">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                            {t("storyChunksModal.died", "Died")}
                          </div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white leading-relaxed">
                            {[formatDate.death, person.deathPlace].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Blockchain Identity Section */}
              {(person.personHash || isMinted(person) || person.tag || person.nftTokenURI) && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider px-1">
                    {t("storyChunksModal.blockchainIdentity", "Identity")}
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    {person.personHash && (
                      <div className="group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] border-l-purple-500/80 hover:shadow-[0_8px_30px_-4px_rgba(168,85,247,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(168,85,247,0.25)] transition-all duration-300">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                              {t("storyChunksModal.personHash", "Person Hash")}
                            </div>
                            {person.versionIndex && (
                              <span className="px-1.5 py-0.5 text-[9px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-md">
                                v{person.versionIndex}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-medium text-gray-900 dark:text-white min-w-0 flex-1 font-mono break-all leading-relaxed">
                              <SmartHash text={person.personHash} />
                            </div>
                            <button
                              onClick={() => copyText(person.personHash)}
                              className="p-2 opacity-0 group-hover:opacity-100 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all"
                              title={t("common.copy", "Copy")}
                            >
                              <Copy size={14} strokeWidth={2.5} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {isMinted(person) && (
                      <div className="group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] border-l-amber-500/80 hover:shadow-[0_8px_30px_-4px_rgba(245,158,11,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(245,158,11,0.25)] transition-all duration-300">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                            {t("person.owner", "Owner Address")}
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-medium text-gray-900 dark:text-white min-w-0 flex-1 font-mono break-all leading-relaxed">
                              <SmartAddress text={owner} />
                            </div>
                            {owner && (
                              <button
                                onClick={() => copyText(owner)}
                                className="p-2 opacity-0 group-hover:opacity-100 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all"
                                title={t("common.copy", "Copy")}
                              >
                                <Copy size={14} strokeWidth={2.5} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {person.tag && (
                      <div className="group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] border-l-gray-400 hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.25)] transition-all duration-300">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                            {t("storyChunksModal.tag", "Tag")}
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-medium text-gray-900 dark:text-white leading-relaxed">
                              {person.tag}
                            </div>
                            <button
                              onClick={() => copyText(person.tag!)}
                              className="p-2 opacity-0 group-hover:opacity-100 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all"
                              title={t("common.copy", "Copy")}
                            >
                              <Copy size={14} strokeWidth={2.5} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {person.nftTokenURI && (
                      <div className="group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] border-l-gray-400 hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.25)] transition-all duration-300">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                            {t("familyTree.nodeDetail.uri", "Token URI")}
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 break-all line-clamp-1 flex-1 font-mono leading-relaxed">
                              {person.nftTokenURI}
                            </div>
                            <button
                              onClick={() => copyText(person.nftTokenURI!)}
                              className="p-2 opacity-0 group-hover:opacity-100 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all"
                              title={t("common.copy", "Copy")}
                            >
                              <Copy size={14} strokeWidth={2.5} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Story Content */}
              <div className="space-y-6">
                {/* Basic Story must reflect person.story exactly */}
                {person.story && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider px-1">
                      {t("storyChunksModal.basicStory", "Basic Story")}
                    </h3>
                    <div className="group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] border-l-blue-500/80 hover:shadow-[0_8px_30px_-4px_rgba(59,130,246,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(59,130,246,0.25)] transition-all duration-300">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap font-medium">
                          {person.story}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {(personHasDetailedStory ||
                  person.storyMetadata ||
                  storyData.loading ||
                  storyData.chunks.length > 0 ||
                  !!storyData.fullStory ||
                  storyData.integrity.computedLength > 0 ||
                  isMinted(person)) && (
                  <div className="space-y-4">
                    {/* Header with View Mode Toggle */}
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider px-1">
                          {t("storyChunksModal.detailedStory", "Detailed Story")}
                        </h3>
                        {chunksCount > 0 && (
                          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 px-2.5 py-1 bg-gray-100 dark:bg-gray-800 rounded-full">
                            {t(
                              "storyChunksModal.chunksAndSize",
                              "{{count}} chunks · {{size}} bytes",
                              {
                                count: chunksCount,
                                size: lengthBytes,
                              },
                            )}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setViewMode("chunks")}
                          className={`group relative inline-flex h-9 items-center gap-2 px-4 rounded-full border transition-all duration-200 ${
                            viewMode === "chunks"
                              ? "bg-orange-500 border-orange-500 text-white shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)]"
                              : "bg-white dark:bg-black/40 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-orange-500 hover:border-orange-500 hover:text-white hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95"
                          }`}
                        >
                          <Layers
                            size={14}
                            className={
                              viewMode === "chunks"
                                ? "text-white"
                                : "text-gray-400 group-hover:text-white transition-colors"
                            }
                          />
                          <span className="text-xs font-bold tracking-wide">
                            {t("storyChunksModal.chunks", "Chunks")}
                          </span>
                        </button>
                        <button
                          onClick={() => setViewMode("full")}
                          className={`group relative inline-flex h-9 items-center gap-2 px-4 rounded-full border transition-all duration-200 ${
                            viewMode === "full"
                              ? "bg-orange-500 border-orange-500 text-white shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)]"
                              : "bg-white dark:bg-black/40 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-orange-500 hover:border-orange-500 hover:text-white hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95"
                          }`}
                        >
                          <FileText
                            size={14}
                            className={
                              viewMode === "full"
                                ? "text-white"
                                : "text-gray-400 group-hover:text-white transition-colors"
                            }
                          />
                          <span className="text-xs font-bold tracking-wide">
                            {t("storyChunksModal.fullText", "Full Text")}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Status Badges Row */}
                    <div className="flex items-center justify-between gap-2 flex-wrap min-h-[32px]">
                      <div>
                        {person.storyMetadata?.isSealed ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-100 dark:border-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold bg-blue-50 dark:bg-blue-900/10">
                            <Check size={12} strokeWidth={3} />
                            {t("person.sealed", "Sealed")}
                          </span>
                        ) : (
                          person.tokenId && (
                            <button
                              onClick={() => {
                                if (!person.tokenId) return;
                                window.open(
                                  `/editor/${person.tokenId}`,
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                              }}
                              className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 border border-transparent hover:border-green-200 dark:hover:border-green-500/30 text-green-700 dark:text-green-400 text-xs font-bold transition-all duration-300"
                            >
                              <Edit2
                                size={12}
                                className="group-hover:scale-110 transition-transform"
                              />
                              {t("person.editable", "Editable")}
                            </button>
                          )
                        )}
                      </div>
                      {chunksCount > 0 &&
                        !storyData.loading &&
                        (storyData.integrityChecking ? (
                          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-gray-500 dark:text-gray-400 text-xs font-medium bg-gray-50 dark:bg-gray-800">
                            <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
                            {t("storyChunksModal.integrityChecking", "Checking...")}
                          </span>
                        ) : (
                          storyData.integrity &&
                          (integrityOk ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-green-600 dark:text-green-400 text-xs font-bold bg-green-50 dark:bg-green-900/10">
                              <Check size={12} strokeWidth={3} />
                              {t("storyChunksModal.integrityVerified", "Integrity verified")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-amber-600 dark:text-amber-400 text-xs font-bold bg-amber-50 dark:bg-amber-900/10">
                              <AlertCircle size={12} />
                              {t("storyChunksModal.integrityWarning", "Integrity failed")}
                            </span>
                          ))
                        ))}
                    </div>

                    {/* Story Data Display */}
                    {storyData.loading ? (
                      <div className="flex items-center justify-center py-16 bg-gray-50/50 dark:bg-white/5 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
                        <div className="text-center">
                          <div className="animate-spin w-6 h-6 border-2 border-gray-900 dark:border-white border-t-transparent rounded-full mx-auto mb-4 opacity-50"></div>
                          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            {t("storyChunksModal.loading", "Loading story chunks...")}
                          </span>
                        </div>
                      </div>
                    ) : storyData.error ? (
                      <div className="text-center py-16 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-200 dark:border-red-800/20">
                        <AlertCircle className="w-10 h-10 text-red-500/50 dark:text-red-400/50 mx-auto mb-4" />
                        <p className="text-sm font-medium text-red-600 dark:text-red-400">
                          {storyData.error}
                        </p>
                      </div>
                    ) : viewMode === "chunks" && storyData.chunks.length > 0 ? (
                      <div className="space-y-3">
                        {storyData.chunks.map((chunk) => {
                          const isExpanded = expandedChunks.has(chunk.chunkIndex);
                          const preview =
                            chunk.content.length > 120
                              ? `${chunk.content.slice(0, 120)}...`
                              : chunk.content;

                          return (
                            <div
                              key={chunk.chunkIndex}
                              className={`group relative rounded-r-2xl rounded-l-md border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] transition-all duration-300 ${
                                isExpanded
                                  ? "bg-white dark:bg-gray-900 border-l-orange-500 shadow-[0_8px_30px_-4px_rgba(249,115,22,0.15)] dark:shadow-[0_8px_30px_-4px_rgba(249,115,22,0.25)]"
                                  : "bg-white dark:bg-gray-900 border-l-gray-200 dark:border-l-gray-700 hover:border-l-orange-400 hover:shadow-lg dark:hover:shadow-none hover:shadow-gray-200/50"
                              }`}
                            >
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => toggleChunk(chunk.chunkIndex)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    toggleChunk(chunk.chunkIndex);
                                  }
                                }}
                                className="w-full text-left p-4 pl-5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-500/50 rounded-r-2xl rounded-l-md"
                              >
                                <div className="flex items-start gap-4">
                                  <div
                                    className={`mt-0.5 p-1.5 rounded-full transition-colors ${
                                      isExpanded
                                        ? "bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400"
                                        : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                                    }`}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown size={16} strokeWidth={2.5} />
                                    ) : (
                                      <ChevronRight size={16} strokeWidth={2.5} />
                                    )}
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-3">
                                        <span
                                          className={`text-sm font-bold tracking-tight ${isExpanded ? "text-orange-700 dark:text-orange-400" : "text-gray-900 dark:text-gray-100"}`}
                                        >
                                          #{chunk.chunkIndex}
                                        </span>
                                        {(() => {
                                          const ChunkIcon = getChunkTypeIcon(chunk.chunkType);
                                          // Override colors for unified styling if needed, or stick to type colors
                                          const iconColor = getChunkTypeColorClass(chunk.chunkType);
                                          return (
                                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white dark:bg-black border border-gray-100 dark:border-gray-800 shadow-sm">
                                              <ChunkIcon size={12} className={iconColor} />
                                              <span
                                                className={`text-[10px] uppercase font-bold tracking-wider ${iconColor.replace("text-", "text-opacity-80 text-")}`}
                                              >
                                                {getChunkTypeLabel(chunk.chunkType)}
                                              </span>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                      <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                        {chunk.content.length}{" "}
                                        {t("storyChunksModal.characters", "chars")}
                                      </span>
                                    </div>

                                    <div
                                      className={`text-sm leading-relaxed ${isExpanded ? "text-gray-900 dark:text-gray-100 whitespace-pre-wrap" : "text-gray-600 dark:text-gray-400 line-clamp-2"}`}
                                    >
                                      {isExpanded ? chunk.content : preview}
                                    </div>

                                    {isExpanded && (
                                      <div
                                        className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800/50"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                          <User size={14} className="text-gray-400" />
                                          {chunk.editor ? (
                                            <>
                                              <span className="truncate" title={chunk.editor}>
                                                {shortAddress(chunk.editor)}
                                              </span>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  copyText(chunk.editor);
                                                }}
                                                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                                                type="button"
                                                title={t("common.copy", "Copy")}
                                              >
                                                <Copy size={12} />
                                              </button>
                                            </>
                                          ) : (
                                            <span>-</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                          <Clock size={14} className="text-gray-400" />
                                          <span>{formatUnixSeconds(chunk.timestamp)}</span>
                                        </div>
                                        {chunk.attachmentCID &&
                                          chunk.attachmentCID.trim().length > 0 && (
                                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 sm:col-span-2">
                                              <Link size={14} className="text-gray-400" />
                                              <span
                                                className="truncate font-mono bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 rounded"
                                                title={chunk.attachmentCID}
                                              >
                                                {chunk.attachmentCID}
                                              </span>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  copyText(chunk.attachmentCID);
                                                }}
                                                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                                                type="button"
                                                title={t("common.copy", "Copy")}
                                              >
                                                <Copy size={12} />
                                              </button>
                                            </div>
                                          )}
                                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 sm:col-span-2">
                                          <Hash size={14} className="text-gray-400" />
                                          <span
                                            className="font-mono truncate"
                                            title={chunk.chunkHash}
                                          >
                                            {formatHashMiddle(chunk.chunkHash)}
                                          </span>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              copyText(chunk.chunkHash);
                                            }}
                                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                                            type="button"
                                            title={t("common.copy", "Copy")}
                                          >
                                            <Copy size={12} />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : viewMode === "full" && storyData.fullStory ? (
                      <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 sm:p-8 border border-gray-100 dark:border-gray-800 shadow-sm leading-relaxed">
                        <div className="prose prose-base dark:prose-invert max-w-none">
                          <div className="whitespace-pre-wrap text-gray-800 dark:text-gray-200 font-serif leading-relaxed">
                            {storyData.fullStory}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-16 bg-gray-50/50 dark:bg-white/5 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
                        <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          {t("storyChunksModal.noStoryData", "No story data available")}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {/* Empty state only if no basic or detailed content */}
                {!person.story &&
                  !(
                    personHasDetailedStory ||
                    person.storyMetadata ||
                    storyData.chunks.length > 0 ||
                    !!storyData.fullStory ||
                    storyData.integrity.computedLength > 0 ||
                    storyData.loading
                  ) && (
                    <div className="text-center py-16 bg-gray-50/50 dark:bg-white/5 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
                      <Book className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        {t("storyChunksModal.noStory", "No story content available")}
                      </p>
                    </div>
                  )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
