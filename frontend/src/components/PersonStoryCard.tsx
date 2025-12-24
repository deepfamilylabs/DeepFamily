import { useMemo, useCallback, MouseEvent, useState, useEffect } from "react";
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
  onClick: () => void;
}

export default function PersonStoryCard({ person, onClick }: PersonStoryCardProps) {
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
      className="group bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-2xl border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:scale-[1.03] hover:-translate-y-1 hover:border-blue-300 dark:hover:border-blue-600 relative overflow-hidden h-full flex flex-col"
    >
      {/* Animated gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 via-purple-500/0 to-indigo-500/0 group-hover:from-blue-500/5 group-hover:via-purple-500/5 group-hover:to-indigo-500/5 dark:group-hover:from-blue-400/10 dark:group-hover:via-purple-400/10 dark:group-hover:to-indigo-400/10 transition-all duration-300 pointer-events-none rounded-xl"></div>

      <div className="relative flex-1 flex flex-col p-5">
        {/* Avatar Header */}
        <div className="flex items-center justify-center mb-4 relative">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-500 dark:from-blue-400 dark:via-purple-400 dark:to-indigo-400 flex items-center justify-center group-hover:scale-110 group-hover:rotate-6 transition-all duration-300 shadow-lg group-hover:shadow-xl">
            <User className="w-10 h-10 text-white" strokeWidth={2} />
          </div>
          {hasDetailedStory && (
            <button
              type="button"
              onClick={handleStoryBadgeClick}
              className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-blue-500 dark:bg-blue-400 hover:bg-blue-600 dark:hover:bg-blue-500 flex items-center justify-center shadow-lg hover:shadow-xl ring-2 ring-white dark:ring-gray-800 hover:scale-125 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400/70 dark:focus:ring-blue-500/60 cursor-pointer"
              title={storyLabel}
              aria-label={storyLabel}
            >
              <BookOpen className="w-4 h-4 text-white" strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* Name and Badges */}
        <div className="text-center mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2 min-h-[3.5rem]">
            {person.fullName || `Person #${shortHash(person.personHash)}`}
          </h3>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {genderText && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300">
                <User className="w-3 h-3" />
                {genderText}
              </span>
            )}
            {isMinted(person) && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-xs font-mono font-medium text-indigo-700 dark:text-indigo-300">
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
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-xs font-medium text-emerald-700 dark:text-emerald-300 transition-colors"
                title={t("people.clickToEndorse", "Click to endorse this version")}
              >
                <Star className="w-3 h-3 fill-emerald-500 text-emerald-500" />
                {endorsementCount}
              </button>
            )}
          </div>
        </div>

        {/* Life Events */}
        <div className="space-y-2 mb-4 flex-1">
          {(formatDate.birth || person.birthPlace) && (
            <div className="px-3 py-2 rounded-lg bg-green-50/50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                <div className="text-[10px] font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">
                  {t("people.born", "Born")}
                </div>
              </div>
              <div className="text-xs font-mono text-gray-700 dark:text-gray-300 line-clamp-1">
                {[formatDate.birth, person.birthPlace].filter(Boolean).join(" · ")}
              </div>
            </div>
          )}

          {(formatDate.death || person.deathPlace) && (
            <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                <div className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {t("people.died", "Died")}
                </div>
              </div>
              <div className="text-xs font-mono text-gray-700 dark:text-gray-300 line-clamp-1">
                {[formatDate.death, person.deathPlace].filter(Boolean).join(" · ")}
              </div>
            </div>
          )}

          {/* Story Preview */}
          {storyPreview && (
            <div className="p-3 rounded-lg bg-gradient-to-br from-blue-50/50 to-purple-50/30 dark:from-blue-900/10 dark:to-purple-900/10 border border-blue-100/50 dark:border-blue-800/30">
              <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">
                {storyPreview}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              {person.timestamp && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatUnixDate(person.timestamp)}
                </span>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              className="flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:gap-1.5 transition-all duration-200 px-2 py-1 -mx-2 -my-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          {person.storyMetadata && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              <FileText className="w-3 h-3" />
              {t("people.chunks", "{{count}} chunks", { count: person.storyMetadata.totalChunks })}
            </div>
          )}
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
    </div>
  );
}
