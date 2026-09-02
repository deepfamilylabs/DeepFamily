import { Book, ChevronRight, FileText, Star, User } from "lucide-react";
import {
  formatUnixDate,
  genderText as genderTextFn,
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
  chunks: "w-[56px] shrink-0 text-right hidden md:block",
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
      <div className={`${COL.chunks} ${cell}`}>{t("people.colChunks", "Chunks")}</div>
      <div className={`${COL.token} ${cell}`}>Token</div>
      <div className={`${COL.creator} ${cell}`}>{t("people.colCreator", "Creator")}</div>
      <div className={`${COL.minted} ${cell}`}>{t("people.colMinted", "Minted")}</div>
      <div className={COL.open} />
    </div>
  );
}

interface PeopleListRowProps {
  t: PeoplePageT;
  person: NodeData;
  isFirst: boolean;
  onOpen: (person: NodeData) => void;
  preloadStoryData?: (tokenId: string) => void;
}

export function PeopleListRow({
  t,
  person,
  isFirst,
  onOpen,
  preloadStoryData,
}: PeopleListRowProps) {
  const lifespan = lifeSpanYears(person);
  const places = placesLine(person);
  const chunks = person.storyMetadata?.totalChunks ?? 0;
  const dash = <span className="text-ink-subtle">—</span>;

  const handleMouseEnter = () => {
    if (person.tokenId && hasDetailedStory(person)) preloadStoryData?.(person.tokenId);
  };

  return (
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
        {chunks > 0 && (
          <span className="inline-flex items-center justify-center w-[18px] h-[18px] shrink-0 rounded-full bg-primary/10 text-primary">
            <Book className="w-[11px] h-[11px]" strokeWidth={2.5} />
          </span>
        )}
      </div>

      <div className={`${COL.life} text-xs text-ink-muted tabular-nums whitespace-nowrap`}>
        {lifespan || dash}
      </div>
      <div className={`${COL.places} text-xs text-ink-muted truncate`}>{places || dash}</div>
      <div className={`${COL.endorsements} text-xs font-semibold text-primary tabular-nums`}>
        {person.endorsementCount ? (
          <span className="inline-flex items-center gap-1 justify-end">
            <Star className="w-3 h-3 fill-current" />
            {person.endorsementCount}
          </span>
        ) : (
          dash
        )}
      </div>
      <div className={`${COL.chunks} text-xs text-ink-muted tabular-nums`}>
        {chunks > 0 ? (
          <span className="inline-flex items-center gap-1 justify-end">
            <FileText className="w-3 h-3" />
            {chunks}
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
  );
}
