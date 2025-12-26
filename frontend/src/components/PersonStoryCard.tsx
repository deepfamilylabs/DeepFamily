import { memo, useMemo, useCallback, MouseEvent, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useTreeData } from "../context/TreeDataContext";
import {
  User,
  Calendar,
  BookOpen,
  Star,
  Clock,
  FileText,
  Hash,
  ChevronRight,
  Eye,
  Baby,
  Flower2,
} from "lucide-react";
import {
  NodeData,
  hasDetailedStory as hasDetailedStoryFn,
  birthDateString,
  deathDateString,
  genderText as genderTextFn,
  formatUnixDate,
  isMinted,
} from "../types/graph";
import { shortHash } from "../types/graph";
import EndorseCompactModal from "./modals/EndorseCompactModal";

interface PersonStoryCardProps {
  person: NodeData;
  onOpen: (person: NodeData) => void;
}

function PersonStoryCard({ person, onOpen }: PersonStoryCardProps) {
  const { t } = useTranslation();
  const { preloadStoryData, bumpEndorsementCount } = useTreeData();
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
      preloadStoryData(person.tokenId);
    }
  }, [person.tokenId, hasDetailedStory, preloadStoryData]);

  // Format date
  const formatDate = useMemo(
    () => ({
      birth: birthDateString(person),
      death: deathDateString(person),
    }),
    [person],
  );

  // Gender display
  const genderText = useMemo(() => genderTextFn(person.gender, t as any), [person.gender, t]);

  // Story preview
  const storyPreview = useMemo(() => {
    if (!person.story) return "";
    return person.story.length > 150 ? person.story.substring(0, 150) + "..." : person.story;
  }, [person.story]);

  const handleStoryBadgeClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (!person.tokenId) return;
      preloadStoryData(person.tokenId);

      // Open person encyclopedia page in new tab
      window.open(`/person/${person.tokenId}`, "_blank", "noopener,noreferrer");
    },
    [person.tokenId, preloadStoryData],
  );

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onClick={() => onOpen(person)}
      className="group relative flex flex-col h-full bg-gradient-to-b from-white to-gray-50/50 dark:from-gray-900 dark:to-gray-950 rounded-[2rem] border border-gray-200/80 dark:border-gray-800 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.1)] hover:border-orange-500/30 hover:-translate-y-1 transition-all duration-500 cursor-pointer overflow-hidden"
    >
      {/* Top accent light - subtle gradient line */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-[1px] bg-gradient-to-r from-transparent via-orange-400/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="relative flex-1 flex flex-col p-6 z-10">
        {/* Avatar Header */}
        <div className="flex items-center justify-center mb-6 relative">
          {/* Glow effect behind avatar */}
          <div className="absolute inset-0 bg-orange-500/20 blur-3xl rounded-full scale-150 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-orange-400 to-red-600 flex items-center justify-center shadow-xl shadow-orange-500/20 group-hover:scale-105 transition-transform duration-500 ring-4 ring-white dark:ring-gray-900">
            <User className="w-10 h-10 text-white" strokeWidth={2} />
          </div>
          {hasDetailedStory && (
            <button
              type="button"
              onClick={handleStoryBadgeClick}
              className="absolute top-0 right-0 w-10 h-10 rounded-full bg-white dark:bg-gray-800 text-orange-500 border border-gray-100 dark:border-gray-700 flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-300 z-10"
              title={storyLabel}
              aria-label={storyLabel}
            >
              <BookOpen className="w-5 h-5" strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* Name and Badges */}
        <div className="text-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3 group-hover:text-orange-500 transition-colors duration-300 line-clamp-2 min-h-[3.5rem]">
            {person.fullName || `Person #${shortHash(person.personHash)}`}
          </h3>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {genderText && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-700">
                <User className="w-3 h-3" />
                {genderText}
              </span>
            )}
            {isMinted(person) && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-50 dark:bg-gray-800 text-xs font-mono font-medium text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-700">
                <Hash className="w-3 h-3" />
                {person.tokenId}
              </span>
            )}
            {endorsementCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowEndorseModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-50 dark:bg-orange-900/20 text-xs font-medium text-orange-600 dark:text-orange-400 border border-orange-100 dark:border-orange-900/30 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors"
                title={t("people.clickToEndorse", "Click to endorse this version")}
              >
                <Star className="w-3 h-3 fill-orange-500 text-orange-500" />
                {endorsementCount}
              </button>
            )}
          </div>
        </div>

        {/* Life Events */}
        <div className="space-y-2 mb-6 flex-1">
          {(formatDate.birth || person.birthPlace) && (
            <div className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group/item">
              <div className="w-9 h-9 rounded-full bg-orange-50 dark:bg-orange-900/10 flex items-center justify-center flex-shrink-0 border border-orange-100 dark:border-orange-900/20 group-hover/item:border-orange-200 dark:group-hover/item:border-orange-800/30 transition-colors">
                <Baby className="w-4 h-4 text-orange-500/80 group-hover/item:text-orange-600 transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">
                  {t("people.born", "Born")}
                </div>
                <div className="text-sm text-gray-700 dark:text-gray-300 font-medium truncate">
                  {[formatDate.birth, person.birthPlace].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          )}

          {(formatDate.death || person.deathPlace) && (
            <div className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group/item">
              <div className="w-9 h-9 rounded-full bg-orange-50 dark:bg-orange-900/10 flex items-center justify-center flex-shrink-0 border border-orange-100 dark:border-orange-900/20 group-hover/item:border-orange-200 dark:group-hover/item:border-orange-800/30 transition-colors">
                <Flower2 className="w-4 h-4 text-orange-500/80 group-hover/item:text-orange-600 transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">
                  {t("people.died", "Died")}
                </div>
                <div className="text-sm text-gray-700 dark:text-gray-300 font-medium truncate">
                  {[formatDate.death, person.deathPlace].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          )}

          {/* Story Preview */}
          {storyPreview && (
            <div className="mt-4 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/30 border border-gray-100 dark:border-gray-800/50 italic text-gray-600 dark:text-gray-400 text-sm leading-relaxed relative">
              <span className="absolute top-2 left-2 text-2xl text-gray-200 dark:text-gray-700 font-serif leading-none">
                "
              </span>
              <span className="relative z-10">{storyPreview}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex flex-col gap-1">
            {person.timestamp && (
              <span className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
                <Clock className="w-3 h-3" />
                {formatUnixDate(person.timestamp)}
              </span>
            )}
            {person.storyMetadata && (
              <span className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
                <FileText className="w-3 h-3" />
                {t("people.chunks", "{{count}} chunks", {
                  count: person.storyMetadata.totalChunks,
                })}
              </span>
            )}
          </div>

          <div className="w-10 h-10 rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 flex items-center justify-center group-hover:bg-orange-500 dark:group-hover:bg-orange-500 group-hover:text-white transition-colors duration-300 shadow-lg shadow-gray-200 dark:shadow-none">
            <ChevronRight className="w-5 h-5" />
          </div>
        </div>
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
          onSuccess={() => {
            setEndorsementCount((c) => c + 1);
            bumpEndorsementCount(person.personHash, Number(person.versionIndex || 1), 1);
          }}
        />
      ) : null}
    </div>
  );
}

export default memo(PersonStoryCard);
