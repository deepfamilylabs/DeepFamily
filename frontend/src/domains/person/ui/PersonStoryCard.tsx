import { memo, useMemo, useCallback, MouseEvent, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  User,
  BookOpen,
  Star,
  FileText,
  ChevronRight,
  MapPin,
} from "lucide-react";
import {
  NodeData,
  hasDetailedStory as hasDetailedStoryFn,
  lifeSpanYears,
  genderText as genderTextFn,
  isMinted,
} from "../../../shared/model";
import { shortHash } from "../../../shared/model";
import EndorseCompactModal from "./EndorseCompactModal";
import type { EndorseSuccessHandler } from "./EndorseModalProvider";

interface PersonStoryCardProps {
  person: NodeData;
  onOpen: (person: NodeData) => void;
  preloadStoryData?: (tokenId: string) => void;
  onEndorseSuccess?: EndorseSuccessHandler;
}

/**
 * Compact person card — roughly 220px tall against the previous 520px, so four
 * fit per row instead of three. Life dates collapse into the line under the
 * name and the two places into a single row, replacing the old pair of 44px
 * icon rows.
 */
function PersonStoryCard({
  person,
  onOpen,
  preloadStoryData,
  onEndorseSuccess,
}: PersonStoryCardProps) {
  const { t } = useTranslation();
  const [showEndorseModal, setShowEndorseModal] = useState(false);
  const [endorsementCount, setEndorsementCount] = useState<number>(person.endorsementCount ?? 0);

  const hasDetailedStory = useMemo(() => hasDetailedStoryFn(person), [person]);
  const storyLabel = t("people.viewEncyclopedia", "View Encyclopedia");
  useEffect(() => {
    setEndorsementCount(person.endorsementCount ?? 0);
  }, [person.endorsementCount, person.personHash, person.versionIndex]);

  // Preload story data on hover
  const handleMouseEnter = useCallback(() => {
    if (person.tokenId && hasDetailedStory) {
      preloadStoryData?.(person.tokenId);
    }
  }, [person.tokenId, hasDetailedStory, preloadStoryData]);

  // Gender display
  const genderText = useMemo(() => genderTextFn(person.gender, t as any), [person.gender, t]);

  const identityLine = useMemo(
    () => [genderText, lifeSpanYears(person)].filter(Boolean).join(" · "),
    [genderText, person],
  );

  // "Boston → New York", or whichever half is known
  const places = useMemo(() => {
    const { birthPlace, deathPlace } = person;
    if (birthPlace && deathPlace && birthPlace !== deathPlace) {
      return `${birthPlace} → ${deathPlace}`;
    }
    return birthPlace || deathPlace || "";
  }, [person]);

  // The 2-line clamp does the trimming; cap the string only to bound the DOM.
  const storyPreview = useMemo(
    () => (person.nftPublicStory ? person.nftPublicStory.slice(0, 200) : ""),
    [person.nftPublicStory],
  );

  const handleStoryBadgeClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (!person.tokenId) return;
      preloadStoryData?.(person.tokenId);

      // Open person encyclopedia page in new tab
      window.open(`/person/${person.tokenId}`, "_blank", "noopener,noreferrer");
    },
    [person.tokenId, preloadStoryData],
  );

  return (
    <div
      onMouseEnter={handleMouseEnter}
      className="group relative flex flex-col h-full p-[18px] bg-surface rounded-3xl border border-hairline shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_20px_-14px_rgba(15,23,42,0.16)] hover:shadow-[0_18px_34px_-18px_rgba(15,23,42,0.28)] dark:shadow-none hover:border-primary/45 hover:-translate-y-[3px] transition-all duration-300 overflow-hidden"
    >
      {/* Top accent light - subtle gradient line */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-linear-to-r from-transparent via-orange-400/75 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="flex items-start gap-3">
        <div className="relative w-11 h-11 shrink-0 rounded-full bg-linear-to-br from-orange-400 to-red-600 flex items-center justify-center shadow-lg shadow-primary/25 ring-[3px] ring-surface">
          <User className="w-5 h-5 text-white" strokeWidth={2} />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold leading-[1.35] text-ink line-clamp-2 group-hover:text-primary transition-colors duration-300">
            {person.fullName || `Person #${shortHash(person.personHash)}`}
          </h3>
          {identityLine && (
            <div className="mt-0.5 text-xs text-ink-muted tabular-nums truncate">
              {identityLine}
            </div>
          )}
        </div>

        {hasDetailedStory && (
          <button
            type="button"
            onClick={handleStoryBadgeClick}
            className="w-[26px] h-[26px] shrink-0 rounded-full bg-surface text-primary border border-hairline flex items-center justify-center shadow-md hover:scale-110 hover:bg-primary-hover hover:text-white hover:border-primary-hover transition-all duration-300"
            title={storyLabel}
            aria-label={storyLabel}
          >
            <BookOpen className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>

      {places && (
        <div className="mt-[11px] flex items-center gap-1.5 min-w-0">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-primary" />
          <span className="text-xs text-ink-muted truncate">{places}</span>
        </div>
      )}

      {storyPreview && (
        <p className="mt-2.5 pl-2.5 border-l-2 border-primary/35 text-xs leading-[1.55] text-ink-muted italic line-clamp-2">
          {storyPreview}
        </p>
      )}

      <div className="flex-1 min-h-2" />

      <div className="mt-3 pt-[11px] border-t border-hairline flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-3 text-[11.5px] font-medium text-ink-subtle whitespace-nowrap min-w-0">
          {isMinted(person) && <span className="font-mono">#{person.tokenId}</span>}
          {endorsementCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowEndorseModal(true);
              }}
              className="inline-flex items-center gap-1 text-primary hover:text-primary-hover transition-colors"
              title={t("people.clickToEndorse", "Click to endorse this version")}
            >
              <Star className="w-3 h-3 fill-current" />
              {endorsementCount}
            </button>
          )}
          {person.storyMetadata && person.storyMetadata.totalChunks > 0 && (
            <span className="inline-flex items-center gap-1 truncate">
              <FileText className="w-3 h-3 shrink-0" />
              {t("people.chunks", "{{count}} chunks", {
                count: person.storyMetadata.totalChunks,
              })}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onOpen(person)}
          className="w-[30px] h-[30px] shrink-0 rounded-full bg-ink text-surface flex items-center justify-center group-hover:bg-primary group-hover:text-white hover:bg-primary-hover! hover:scale-110 transition-all duration-300"
          aria-label={t("common.open", "Open details")}
        >
          <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>

      {showEndorseModal ? (
        <EndorseCompactModal
          isOpen={true}
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
      ) : null}
    </div>
  );
}

export default memo(PersonStoryCard);
