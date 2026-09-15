import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ChevronUp, Edit2, FileText } from "lucide-react";
import {
  getRecordTypeColorClass,
  getRecordTypeI18nKey,
  getRecordTypeIcon,
  getRecordTypeOptions,
} from "../../../domains/person";
import { EmptyState } from "../../../shared/ui";
import type { PersonPageController } from "../hooks/usePersonPageController";
import {
  getRecordTypeLabel,
  hasStoryIntegrityIssues,
  type GroupedStoryRecords,
  type PersonStoryViewMode,
} from "../model/personPageModel";
import { splitSectionRecords, summariseRecordTitles } from "../model/personStoryLayout";
import { PersonSectionChips } from "./PersonContents";
import { PersonStoryEntry } from "./PersonStoryEntry";

const VIEW_MODES: {
  id: PersonStoryViewMode;
  key: string;
  fallback: string;
  titleKey: string;
  titleFallback: string;
}[] = [
  { id: "sections", key: "person.sections", fallback: "Sections", titleKey: "person.viewSections", titleFallback: "Sections Mode" },
  { id: "paragraph", key: "person.paragraph", fallback: "Paragraph", titleKey: "person.viewParagraph", titleFallback: "Paragraph Mode" },
  { id: "raw", key: "person.raw", fallback: "Raw", titleKey: "person.viewRaw", titleFallback: "Raw Mode" },
];

/**
 * The life story: a heading with the view switch, an integrity notice only when
 * verification failed, then the records — by section on one spine, as running
 * paragraphs, or as the raw joined text.
 */
export function PersonStory({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;
  if (!data) return null;

  const sealed = Boolean(data.storyMetadata?.isSealed);
  const hasFullStory = Boolean(data.fullStory && data.fullStory.length > 0);
  const paragraphs =
    person.recordParagraphs.length > 0 ? person.recordParagraphs : person.fullStoryParagraphs;

  let body: React.ReactNode;
  if (person.viewMode === "sections" && person.groupedRecords.length > 0) {
    body = <StorySections person={person} />;
  } else if (person.viewMode === "paragraph" && (paragraphs.length > 0 || data.fullStory)) {
    body = (
      <div className="mt-6 flex flex-col gap-4 text-[15.5px] leading-[1.8] text-ink">
        {(paragraphs.length > 0 ? paragraphs : [data.fullStory]).map((content, index) => (
          <p key={index} className="whitespace-pre-wrap break-words">
            {content}
          </p>
        ))}
      </div>
    );
  } else if (person.viewMode === "raw" && data.fullStory) {
    body = (
      <div className="mt-6 overflow-x-auto rounded-xl border border-hairline bg-surface-alt p-4">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink-muted sm:text-[13px]">
          {data.fullStory}
        </pre>
      </div>
    );
  } else {
    body = (
      <div className="mt-6 rounded-2xl border border-dashed border-hairline bg-surface">
        <EmptyState
          icon={<FileText size={22} aria-hidden />}
          title={t("person.noProfileData", "No life story yet")}
          action={
            person.canEditStory && !sealed ? (
              <button
                type="button"
                onClick={person.openEditorInNewTab}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-hairline-strong bg-surface px-3.5 text-[13px] font-semibold text-ink transition-colors hover:border-primary hover:text-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <Edit2 size={15} aria-hidden className="text-ink-muted" />
                {t("familyTree.nodeDetail.editStory", "Edit Story")}
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <section className="mt-9 sm:mt-11">
      <div className="flex items-center justify-between gap-3 border-b border-hairline pb-3 sm:pb-3.5">
        <h2 className="text-xl text-ink sm:text-[22px]">{t("person.profileData", "Life Story")}</h2>
        {hasFullStory && (
          <div className="inline-flex shrink-0 gap-1 rounded-full bg-surface-muted p-1">
            {VIEW_MODES.map((mode) => {
              const active = person.viewMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={active}
                  title={t(mode.titleKey, mode.titleFallback) as string}
                  onClick={() => person.setViewMode(mode.id)}
                  className={`inline-flex min-h-[30px] items-center rounded-full px-3 text-[12px] transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 ${
                    active
                      ? "bg-surface font-semibold text-ink shadow-sm"
                      : "font-medium text-ink-muted hover:text-ink"
                  }`}
                >
                  {t(mode.key, mode.fallback)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <IntegrityNotice person={person} />
      {body}
    </section>
  );
}

function IntegrityNotice({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const integrity = person.data?.integrity;
  if (!hasStoryIntegrityIssues(person.data) || !integrity) return null;

  return (
    <div
      role="alert"
      aria-label={t("person.integrityWarn", "Integrity Possibly Inconsistent") as string}
      className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning"
    >
      {integrity.missing.length > 0 && (
        <span className="inline-flex items-start gap-1.5">
          <AlertCircle size={13} aria-hidden className="mt-px shrink-0" />
          {t("person.integrityMissing", "Missing indices: {{indices}}", {
            indices: integrity.missing.join(","),
          })}
        </span>
      )}
      {!integrity.lengthMatch && (
        <span className="inline-flex items-start gap-1.5">
          <AlertCircle size={13} aria-hidden className="mt-px shrink-0" />
          {t("person.integrityLenDiff", "Length mismatch local={{local}} bytes", {
            local: integrity.computedLength,
          })}
        </span>
      )}
      {integrity.hashMatch === false && (
        <span className="inline-flex items-start gap-1.5">
          <AlertCircle size={13} aria-hidden className="mt-px shrink-0" />
          {t("person.integrityLocalHashMismatch", "Local hash mismatch")}
        </span>
      )}
    </div>
  );
}

function StorySections({ person }: { person: PersonPageController }) {
  return (
    <>
      <PersonSectionChips person={person} />
      <div className="relative mt-6 pl-9 sm:mt-8 sm:pl-11">
        {/* the spine every section and record hangs off */}
        <div
          aria-hidden
          className="absolute bottom-7 left-3 top-3.5 w-px bg-hairline-strong/50 sm:left-3.5"
        />
        {person.groupedRecords.map((group) => (
          <StorySection key={group.type} person={person} group={group} />
        ))}
      </div>
    </>
  );
}

function StorySection({
  person,
  group,
}: {
  person: PersonPageController;
  group: GroupedStoryRecords;
}) {
  const { t } = useTranslation();
  const recordTypeOptions = useMemo(() => getRecordTypeOptions(t), [t]);
  const expanded = person.expandedSections.has(group.type);
  const { visible, hidden } = splitSectionRecords(group.records, expanded);
  const foldable = group.records.length !== splitSectionRecords(group.records, false).visible.length;
  const Icon = getRecordTypeIcon(group.type);
  const label = t(
    getRecordTypeI18nKey(group.type),
    getRecordTypeLabel(group.type, recordTypeOptions, t("recordTypes.unknown", "Unknown")),
  );

  return (
    <section
      ref={person.registerSection(group.type)}
      id={`person-section-${group.type}`}
      className="mt-10 scroll-mt-40 first-of-type:mt-0 sm:mt-11 xl:scroll-mt-24"
    >
      <div className="relative flex min-h-[25px] items-center gap-2 sm:min-h-[29px] sm:gap-2.5">
        <span
          aria-hidden
          className={`absolute -left-9 top-0 flex h-[25px] w-[25px] items-center justify-center rounded-full border border-hairline bg-surface shadow-xs sm:-left-11 sm:h-[29px] sm:w-[29px] ${getRecordTypeColorClass(group.type)}`}
        >
          <Icon className="h-[13px] w-[13px] sm:h-[15px] sm:w-[15px]" />
        </span>
        <h3 className="text-lg text-ink sm:text-[19px]">{label}</h3>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
          {group.records.length}
        </span>
      </div>

      <div className="mt-3.5 flex flex-col gap-4 sm:mt-4 sm:gap-[18px]">
        {visible.map((record) => (
          <PersonStoryEntry
            key={record.recordIndex}
            t={t}
            record={record}
            expanded={person.expandedRecords.has(record.recordIndex)}
            onToggle={person.toggleRecord}
            copyText={person.copyText}
            entryRef={person.registerRecord(record.recordIndex)}
          />
        ))}
        {hidden.length > 0 && (
          <CollapsedFold
            type={group.type}
            hidden={hidden}
            onExpand={() => person.toggleSection(group.type)}
          />
        )}
        {expanded && foldable && (
          <FoldMarker>
            <button
              type="button"
              onClick={() => person.toggleSection(group.type)}
              aria-expanded
              className="flex w-fit items-center gap-1.5 rounded-lg py-0.5 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <ChevronUp size={13} aria-hidden />
              {t("storyRecordEditor.collapseRun", "Collapse {{total}} records", {
                total: group.records.length - splitSectionRecords(group.records, false).visible.length,
              })}
            </button>
          </FoldMarker>
        )}
      </div>
    </section>
  );
}

/** Keeps a fold control anchored to the spine in both states. */
function FoldMarker({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="absolute -left-[27px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-hairline-strong sm:-left-[33px]"
      />
      {children}
    </div>
  );
}

function CollapsedFold({
  type,
  hidden,
  onExpand,
}: {
  type: number;
  hidden: GroupedStoryRecords["records"];
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const { titles, truncated } = summariseRecordTitles(hidden);
  const summary = titles.join(t("storyRecordEditor.listSeparator", ", ")) + (truncated ? "…" : "");

  return (
    <FoldMarker>
      <button
        type="button"
        onClick={onExpand}
        aria-expanded={false}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-hairline bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-hairline-strong focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span aria-hidden className={`flex shrink-0 gap-1 ${getRecordTypeColorClass(type)}`}>
          {hidden.slice(0, 6).map((record) => (
            <span key={record.recordIndex} className="h-[7px] w-[7px] rounded-full bg-current" />
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted">
          {t("storyRecordEditor.collapsedRun", "{{total}} records collapsed", {
            total: hidden.length,
          })}
          {titles.length > 0 && <span className="ml-1">— {summary}</span>}
        </span>
        <span className="shrink-0 text-[12px] font-medium text-ink-muted">
          {t("storyRecordEditor.expandRun", "Expand")}
        </span>
      </button>
    </FoldMarker>
  );
}
