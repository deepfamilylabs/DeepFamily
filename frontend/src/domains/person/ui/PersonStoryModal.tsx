import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { User, BookOpen, Star } from "lucide-react";
import EndorseCompactModal from "./EndorseCompactModal";
import {
  NodeData,
  hasDetailedStory as hasDetailedStoryFn,
  birthDateString,
  deathDateString,
  genderText as genderTextFn,
  isMinted,
} from "../../../shared/model";
import { useTreeMutations, useTreeNodeAccess } from "../../tree";
import { ResponsiveModalFrame, useResponsiveModalMode, useToast } from "../../../shared/ui";
import { getChunkTypeOptions } from "../config/chunkTypes";
import {
  BasicStorySection,
  DetailedStorySection,
  StoryEmptyState,
  StoryIdentitySection,
  StoryLifeEventsSection,
  type StoryData,
} from "./PersonStoryModalSections";
// owner/address resolution is delegated to the tree node access layer.

interface PersonStoryModalProps {
  person: NodeData;
  isOpen: boolean;
  onClose: () => void;
}

// Story integrity is derived by the shared tree node access helpers.

export default function PersonStoryModal({ person, isOpen, onClose }: PersonStoryModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { getStoryData, getOwnerOf } = useTreeNodeAccess();
  const { bumpEndorsementCount } = useTreeMutations();
  const nameContainerRef = useRef<HTMLDivElement | null>(null);
  const nameTextRef = useRef<HTMLSpanElement | null>(null);
  const [marquee, setMarquee] = useState(false);

  const [storyData, setStoryData] = useState<StoryData>({
    chunks: [],
    fullStory: "",
    integrity: { missing: [], lengthMatch: true, hashMatch: null, computedLength: 0 },
    loading: false,
    integrityChecking: false,
  });

  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"chunks" | "full">("chunks");
  const [entered, setEntered] = useState(false);
  const [owner, setOwner] = useState<string | undefined>(person.owner);
  const [showEndorseModal, setShowEndorseModal] = useState(false);
  const [endorsementCount, setEndorsementCount] = useState<number>(person.endorsementCount ?? 0);
  const isDesktop = useResponsiveModalMode();

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
          toast.success(t("common.copied", "Copied"));
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
        if (ok) {
          toast.success(t("common.copied", "Copied"));
        } else {
          toast.error(t("common.copyFailed", "Failed to copy"));
        }
        return ok;
      } catch {
        toast.error(t("common.copyFailed", "Failed to copy"));
        return false;
      }
    },
    [t, toast],
  );

  // Fetch story data through the tree node access layer.
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

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setEntered(true));
    } else {
      setEntered(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const modalTitle = (
    <span ref={nameContainerRef} className="relative block overflow-hidden">
      <span
        ref={nameTextRef}
        className={`inline-block pr-8 ${marquee ? "will-change-transform animate-[marquee_15s_linear_infinite]" : ""}`}
      >
        {person.fullName || `Person ${person.personHash.slice(0, 8)}...`}
      </span>
      {marquee && (
        <span className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white dark:from-gray-950 to-transparent" />
      )}
    </span>
  );

  const modalDescription = (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2">
      {genderText && (
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{genderText}</span>
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
              type="button"
              aria-label={t("people.clickToEndorse", "Click to endorse this version")}
              onClick={(e) => {
                e.stopPropagation();
                setShowEndorseModal(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="group relative inline-flex h-8 items-center gap-1.5 px-3 bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-full cursor-pointer justify-center sm:justify-start hover:bg-orange-500 hover:border-orange-500 hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95 focus:outline-none flex-shrink-0 whitespace-nowrap"
            >
              <Star className="w-4 h-4 text-gray-400 group-hover:text-white" strokeWidth={2} />
              <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
                {endorsementCount}
              </span>
            </button>
          )}

          {isMinted(person) && (
            <button
              type="button"
              aria-label={t("storyChunksModal.peopleEncyclopedia", "People Encyclopedia")}
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
              <BookOpen className="w-4 h-4 text-gray-400 group-hover:text-white" strokeWidth={2} />
              <span className="hidden sm:inline text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 group-hover:text-white">
                {t("familyTree.nodeDetail.encyclopedia", "Encyclopedia")}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <ResponsiveModalFrame
      isOpen={isOpen}
      onClose={onClose}
      isDesktop={isDesktop}
      ariaLabel={person.fullName || `Person ${person.personHash.slice(0, 8)}...`}
      icon={<User className="w-6 h-6 text-white" strokeWidth={2} />}
      title={modalTitle}
      description={modalDescription}
      entered={entered}
      closeLabel={t("common.close", "Close")}
    >
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
      <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden min-h-0 touch-pan-y">
        <div className="p-6 space-y-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          <StoryLifeEventsSection
            t={t}
            birth={formatDate.birth}
            birthPlace={person.birthPlace}
            death={formatDate.death}
            deathPlace={person.deathPlace}
          />

          <StoryIdentitySection
            t={t}
            person={person}
            owner={owner}
            isDesktop={isDesktop}
            copyText={copyText}
          />

          {/* Story Content */}
          <div className="space-y-6">
            <BasicStorySection t={t} story={person.story} />
            <DetailedStorySection
              t={t}
              person={person}
              storyData={storyData}
              chunksCount={chunksCount}
              lengthBytes={lengthBytes}
              integrityOk={integrityOk}
              viewMode={viewMode}
              expandedChunks={expandedChunks}
              personHasDetailedStory={personHasDetailedStory}
              onViewModeChange={setViewMode}
              onToggleChunk={toggleChunk}
              getChunkTypeLabel={getChunkTypeLabel}
              copyText={copyText}
            />
            {!person.story &&
              !(
                personHasDetailedStory ||
                person.storyMetadata ||
                storyData.chunks.length > 0 ||
                !!storyData.fullStory ||
                storyData.integrity.computedLength > 0 ||
                storyData.loading
              ) && <StoryEmptyState t={t} icon="book" />}
          </div>
        </div>
      </div>
    </ResponsiveModalFrame>
  );
}
