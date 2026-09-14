import { useEffect, useState } from "react";
import { BookOpen, ChevronRight, FileText, Star, User } from "lucide-react";
import { EndorseCompactModal, type EndorseSuccessHandler } from "../../../domains/person";
import {
  formatUnixDate,
  genderText as genderTextFn,
  getStoryPresentation,
  hasDetailedStory,
  isMinted,
  lifeSpanYears,
  placesLine,
  shortAddress,
  shortHash,
  type NodeData,
} from "../../../shared/model";
import type { PeoplePageT } from "../model/peoplePageModel";

/**
 * Column widths are shared by the header and the rows so the two stay aligned;
 * the narrower columns drop out on small screens rather than squeezing.
 */
const COL = {
  person: "flex-1 min-w-0",
  life: "w-[104px] shrink-0 hidden sm:block",
  places: "w-[200px] shrink-0 hidden lg:block",
  endorsements: "w-[88px] shrink-0 text-right",
  records: "w-[56px] shrink-0 text-right hidden md:block",
  token: "w-[64px] shrink-0 text-right hidden md:block",
  creator: "w-[124px] shrink-0 hidden xl:block",
  minted: "w-[96px] shrink-0 hidden xl:block",
  open: "w-7 shrink-0 flex justify-end",
} as const;

export function PeopleListHeader({ t }: { t: PeoplePageT }) {
  const cell = "text-[11px] font-semibold tracking-wide text-ink-subtle whitespace-nowrap";
  return (
    <div className="flex items-center gap-3 h-9 px-5 bg-surface-alt border-b border-hairline">
      <div className={`${COL.person} ${cell}`}>{t("people.colPerson", "Person")}</div>
      <div className={`${COL.life} ${cell}`}>{t("people.colLife", "Life")}</div>
      <div className={`${COL.places} ${cell}`}>{t("people.colPlaces", "Places")}</div>
      <div className={`${COL.endorsements} ${cell}`}>
        {t("people.filterByEndorsement", "Endorsements")}
      </div>
      <div className={`${COL.records} ${cell}`}>{t("people.colRecords", "Records")}</div>
      <div className={`${COL.token} ${cell}`}>{t("people.colToken", "Token ID")}</div>
      <div className={`${COL.creator} ${cell}`}>{t("people.colCreator", "Creator")}</div>
      <div className={`${COL.minted} ${cell}`}>{t("people.colMinted", "Minted")}</div>
      <div className={COL.open} />
    </div>
  );
}

interface PeopleListRowProps {
  t: PeoplePageT;
  person: NodeData;
  generation?: number;
  isFirst: boolean;
  onOpen: (person: NodeData) => void;
  preloadStoryData?: (tokenId: string) => void;
  onEndorseSuccess?: EndorseSuccessHandler;
}

/**
 * One person in the list view. The row opens the person's details; the book and
 * the endorsement count are their own actions, as they are on the grid card —
 * the encyclopedia in a new tab, endorsing in the compact modal — so each stops
 * its click from also opening the row.
 */
export function PeopleListRow({
  t,
  person,
  generation,
  isFirst,
  onOpen,
  preloadStoryData,
  onEndorseSuccess,
}: PeopleListRowProps) {
  const lifespan = lifeSpanYears(person);
  const places = placesLine(person);
  const records = getStoryPresentation(person.storyRecords, person.storyMetadata).totalRecords;
  const dash = <span className="text-ink-subtle">—</span>;
  const [showEndorseModal, setShowEndorseModal] = useState(false);
  const [endorsementCount, setEndorsementCount] = useState<number>(person.endorsementCount ?? 0);
  const canOpenEncyclopedia = Boolean(person.tokenId) && hasDetailedStory(person);
  const encyclopediaLabel = t("people.viewEncyclopedia", "View Encyclopedia");
  const endorseLabel = t("people.clickToEndorse", "Click to endorse this version");

  useEffect(() => {
    setEndorsementCount(person.endorsementCount ?? 0);
  }, [person.endorsementCount, person.personHash, person.versionIndex]);

  const handleMouseEnter = () => {
    if (person.tokenId && hasDetailedStory(person)) preloadStoryData?.(person.tokenId);
  };

  return (
    <>
      <div
        onMouseEnter={handleMouseEnter}
        onClick={() => onOpen(person)}
        className={`flex items-center gap-3 h-13 px-5 cursor-pointer hover:bg-surface-alt/60 transition-colors ${
          isFirst ? "" : "border-t border-hairline"
        }`}
      >
        <div className={`${COL.person} flex items-center gap-2.5`}>
          <div className="relative w-6.5 h-6.5 shrink-0 rounded-full bg-linear-to-br from-orange-400 to-red-600 flex items-center justify-center ring-2 ring-surface">
            <User className="w-3 h-3 text-white" strokeWidth={2} />
          </div>
          <span className="text-[13.5px] font-semibold text-ink truncate">
            {person.fullName || `Person #${shortHash(person.personHash)}`}
          </span>
          {person.gender !== undefined && (
            <span className="hidden sm:inline-flex items-center h-[19px] px-[7px] shrink-0 rounded-full bg-surface-muted text-[11px] text-ink-muted">
              {genderTextFn(person.gender, t as any)}
            </span>
          )}
          {generation !== undefined && (
            <span className="hidden sm:inline-flex items-center h-[19px] px-[7px] shrink-0 rounded-full bg-surface-muted text-[11px] text-ink-muted whitespace-nowrap">
              {t("people.generationShort", "Gen {{number}}", { number: generation })}
            </span>
          )}
          {canOpenEncyclopedia && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                preloadStoryData?.(person.tokenId!);
                window.open(`/person/${person.tokenId}`, "_blank", "noopener,noreferrer");
              }}
              title={encyclopediaLabel}
              aria-label={encyclopediaLabel}
              className="inline-flex items-center justify-center w-[22px] h-[22px] shrink-0 rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary hover:text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <BookOpen className="w-[11px] h-[11px]" strokeWidth={2.5} aria-hidden />
            </button>
          )}
        </div>

        <div className={`${COL.life} text-xs text-ink-muted tabular-nums whitespace-nowrap`}>
          {lifespan || dash}
        </div>
        <div className={`${COL.places} text-xs text-ink-muted truncate`}>{places || dash}</div>
        <div className={`${COL.endorsements} text-xs font-semibold text-primary tabular-nums`}>
          {endorsementCount > 0 ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setShowEndorseModal(true);
              }}
              title={endorseLabel}
              aria-label={endorseLabel}
              className="inline-flex items-center gap-1 justify-end rounded-md px-1 -mx-1 transition-colors hover:text-primary-hover hover:bg-primary/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <Star className="w-3 h-3 fill-current" aria-hidden />
              {endorsementCount}
            </button>
          ) : (
            dash
          )}
        </div>
        <div className={`${COL.records} text-xs text-ink-muted tabular-nums`}>
          {records > 0 ? (
            <span className="inline-flex items-center gap-1 justify-end">
              <FileText className="w-3 h-3" />
              {records}
            </span>
          ) : (
            dash
          )}
        </div>
        <div className={`${COL.token} text-xs font-mono text-ink-muted`}>
          {isMinted(person) ? `#${person.tokenId}` : dash}
        </div>
        <div className={`${COL.creator} text-xs font-mono text-ink-muted truncate`}>
          {person.addedBy ? shortAddress(person.addedBy, 6, 4) : dash}
        </div>
        <div className={`${COL.minted} text-xs text-ink-subtle tabular-nums`}>
          {formatUnixDate(person.timestamp) || dash}
        </div>
        <div className={COL.open}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(person);
            }}
            aria-label={t("common.open", "Open details")}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full text-ink-subtle hover:bg-primary hover:text-white transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Outside the row on purpose: React bubbles events through portals along
          the component tree, so a modal inside the row would reopen the person
          on every click made in it. */}
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
            setEndorsementCount((count) => count + 1);
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
    </>
  );
}
