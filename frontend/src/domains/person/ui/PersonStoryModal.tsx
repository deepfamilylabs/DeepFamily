import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { User, BookOpen, Star } from "lucide-react";
import EndorseCompactModal from "./EndorseCompactModal";
import { useStoryRecordOrder } from "./useStoryRecordOrder";
import { sortRecordsForReading } from "../config/recordTypeGroups";
import {
  NodeData,
  hasDetailedStory as hasDetailedStoryFn,
  birthDateString,
  deathDateString,
  genderText as genderTextFn,
  isMinted,
  getStoryPresentation,
} from "../../../shared/model";
import { ResponsiveModalFrame, useResponsiveModalMode, useToast } from "../../../shared/ui";
import { getRecordTypeOptions } from "../config/recordTypes";
import { useNftStoryAccess } from "../queries/useNftStoryAccess";
import type { EndorseSuccessHandler } from "./EndorseModalProvider";
import {
  BasicStorySection,
  DetailedStorySection,
  StoryEmptyState,
  StoryIdentitySection,
  StoryLifeEventsSection,
  type StoryData,
} from "./PersonStoryModalSections";
import { DetailToolbarButton } from "./NodeDetailModalSections";
// owner/address resolution is delegated to the tree node access layer.

interface PersonStoryModalProps {
  person: NodeData;
  isOpen: boolean;
  onClose: () => void;
  getStoryData?: (
    tokenId: string,
  ) => Promise<Pick<StoryData, "records" | "fullStory" | "integrity"> | null>;
  getOwnerOf?: (tokenId: string) => Promise<string | null | undefined>;
  onEndorseSuccess?: EndorseSuccessHandler;
}

// Story integrity is derived by the shared tree node access helpers.

export default function PersonStoryModal({
  person,
  isOpen,
  onClose,
  getStoryData,
  getOwnerOf,
  onEndorseSuccess,
}: PersonStoryModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const storyAccess = useNftStoryAccess(isOpen ? person.tokenId : null);
  const nameContainerRef = useRef<HTMLDivElement | null>(null);
  const nameTextRef = useRef<HTMLSpanElement | null>(null);
  const [marquee, setMarquee] = useState(false);

  const [storyData, setStoryData] = useState<StoryData>({
    records: [],
    fullStory: "",
    integrity: { missing: [], lengthMatch: true, hashMatch: null, computedLength: 0 },
    loading: false,
    integrityChecking: false,
  });

  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"records" | "full">("records");
  const [recordOrder, setRecordOrder] = useStoryRecordOrder();
  const [entered, setEntered] = useState(false);
  const [owner, setOwner] = useState<string | undefined>(person.owner);
  const [showEndorseModal, setShowEndorseModal] = useState(false);
  const [endorsementCount, setEndorsementCount] = useState<number>(person.endorsementCount ?? 0);
  const isDesktop = useResponsiveModalMode();

  const personHasDetailedStory = useMemo(() => hasDetailedStoryFn(person), [person]);

  const recordTypeOptions = useMemo(() => getRecordTypeOptions(t), [t]);

  const getRecordTypeLabel = useCallback(
    (type: number | string | null | undefined) => {
      if (type === null || type === undefined || type === "") {
        return recordTypeOptions[0]?.label || t("recordTypes.unknown", "Unknown");
      }
      const numericType = Number(type);
      if (Number.isFinite(numericType)) {
        const match = recordTypeOptions.find((opt) => opt.value === numericType);
        if (match) return match.label;
      }
      return t("recordTypes.unknown", "Unknown");
    },
    [recordTypeOptions, t],
  );

  // Keep local owner state in sync with NodeData updates
  useEffect(() => {
    if (isOpen) setOwner(person.owner);
  }, [person.owner, isOpen]);
  useEffect(() => {
    setEndorsementCount(person.endorsementCount ?? 0);
  }, [person.endorsementCount, person.personHash, person.versionIndex]);

  const presentation = useMemo(
    () => getStoryPresentation(storyData.records, person.storyMetadata),
    [storyData.records, person.storyMetadata],
  );
  // Records and full text follow the viewer's order — the same choice, and the
  // same remembered preference, as the story editor.
  const orderedRecords = useMemo(
    () =>
      recordOrder === "reading"
        ? sortRecordsForReading(presentation.records)
        : presentation.records,
    [presentation.records, recordOrder],
  );
  const presentedStoryData = {
    ...storyData,
    records: orderedRecords,
    fullStory: orderedRecords.map((record) => record.content).join(""),
  };
  const biography = presentation.biography;
  const basicStory =
    biography && !biography.unsupportedSchema ? biography.content : person.nftPublicStory;
  const recordsCount = presentation.totalRecords;
  const lengthBytes = presentation.totalPayloadLength;

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
    if (!getStoryData) {
      setStoryData({
        records: [],
        fullStory: "",
        integrity: { missing: [], lengthMatch: true, hashMatch: null, computedLength: 0 },
        loading: false,
        integrityChecking: false,
        error: t("storyRecordsModal.noStoryData", "No story data available"),
      });
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
          records: [],
          fullStory: "",
          integrity: { missing: [], lengthMatch: true, hashMatch: null, computedLength: 0 },
          loading: false,
          integrityChecking: false,
          error: t("storyRecordsModal.noStoryData", "No story data available"),
        });
        return;
      }

      // If there are records, show integrity checking status first
      if (data.records.length > 0) {
        setStoryData((prev) => ({
          ...prev,
          records: data.records,
          fullStory: data.fullStory,
          loading: false,
          integrityChecking: true,
        }));

        // Small delay to show "checking..." status
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      setStoryData({
        records: data.records,
        fullStory: data.fullStory,
        integrity: data.integrity,
        loading: false,
        integrityChecking: false,
      });
    } catch (err: any) {
      console.error("Failed to fetch story records:", err);
      setStoryData((prev) => ({
        ...prev,
        loading: false,
        integrityChecking: false,
        error: err.message || t("storyRecordsModal.fetchError", "Failed to load story data"),
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
        const addr = await getOwnerOf?.(person.tokenId);
        if (!cancelled) setOwner(addr || undefined);
      } catch {
        if (!cancelled) setOwner(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, person.tokenId, getOwnerOf]);

  // Toggle record expansion
  const toggleRecord = (index: number) => {
    setExpandedRecords((prev) => {
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
        <span className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l from-white dark:from-gray-950 to-transparent" />
      )}
    </span>
  );

  const modalDescription = (
    <div className="flex flex-wrap items-center gap-2">
      {genderText && <span className="text-xs text-ink-muted">{genderText}</span>}
      {isMinted(person) && (
        <>
          <span className="w-1 h-1 rounded-full bg-hairline-strong" aria-hidden />
          <span className="font-mono text-xs text-ink-muted">#{person.tokenId}</span>
        </>
      )}
    </div>
  );

  const personMinted = isMinted(person);
  const showEndorse = endorsementCount > 0;

  // Same entries and priority as the node detail toolbar: once minted, reading the
  // encyclopedia leads and the paid endorsement becomes secondary.
  const modalToolbar =
    showEndorse || personMinted ? (
      <>
        {personMinted && (
          <DetailToolbarButton
            variant="primary"
            icon={BookOpen}
            label={t("familyTree.nodeDetail.encyclopedia", "Encyclopedia")}
            accessibleLabel={t("people.viewEncyclopedia", "View Encyclopedia")}
            onClick={() =>
              window.open(
                `/person/${person.tokenId || person.id}`,
                "_blank",
                "noopener,noreferrer",
              )
            }
          />
        )}
        {showEndorse && (
          <DetailToolbarButton
            variant={personMinted ? "secondary" : "primary"}
            icon={Star}
            label={t("endorse.endorse", "Endorse")}
            accessibleLabel={t("people.clickToEndorse", "Click to endorse this version")}
            onClick={() => setShowEndorseModal(true)}
          >
            <span className="font-mono opacity-80">{endorsementCount}</span>
          </DetailToolbarButton>
        )}
      </>
    ) : null;

  return (
    <ResponsiveModalFrame
      isOpen={isOpen}
      onClose={onClose}
      isDesktop={isDesktop}
      ariaLabel={person.fullName || `Person ${person.personHash.slice(0, 8)}...`}
      icon={<User className="w-[18px] h-[18px]" strokeWidth={1.75} />}
      title={modalTitle}
      description={modalDescription}
      toolbar={modalToolbar}
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
        onSuccess={(receipt) => {
          setEndorsementCount((c) => c + 1);
          onEndorseSuccess?.(
            {
              personHash: person.personHash,
              versionIndex: Number(person.versionIndex || 1),
              fullName: person.fullName,
              endorsementCount,
            },
            1,
            receipt,
          );
        }}
      />
      <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden min-h-0 touch-pan-y">
        <div className="p-5 space-y-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <StoryLifeEventsSection
            t={t}
            birth={formatDate.birth}
            birthPlace={person.birthPlace}
            death={formatDate.death}
            deathPlace={person.deathPlace}
          />

          <StoryIdentitySection t={t} person={person} owner={owner} copyText={copyText} />

          {/* Story Content */}
          <div className="space-y-6">
            <BasicStorySection
              t={t}
              story={basicStory}
              title={person.nftPublicStoryTitle}
              biography={biography}
            />
            <DetailedStorySection
              t={t}
              person={person}
              canEditStory={storyAccess.canEdit}
              storyData={presentedStoryData}
              recordsCount={recordsCount}
              lengthBytes={lengthBytes}
              viewMode={viewMode}
              recordOrder={recordOrder}
              onRecordOrderChange={setRecordOrder}
              expandedRecords={expandedRecords}
              personHasDetailedStory={personHasDetailedStory}
              onViewModeChange={setViewMode}
              onToggleRecord={toggleRecord}
              getRecordTypeLabel={getRecordTypeLabel}
              copyText={copyText}
            />
            {!person.nftPublicStory &&
              !(
                personHasDetailedStory ||
                person.storyMetadata ||
                storyData.records.length > 0 ||
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
