import { UnsupportedStoryRecord } from "../../../shared/ui/UnsupportedStoryRecord";
import type React from "react";
import type { TFunction } from "i18next";
import { Book, FileText, Layers, AlertCircle, Edit2, Check } from "lucide-react";
import { NodeData, StoryRecord, isMinted, isMetadataUnlockUsable } from "../../../shared/model";
import { CopyIconButton, MODAL_CARD, MODAL_CHIP, ModalSectionHeading } from "../../../shared/ui";
import type { StoryRecordOrder } from "../config/recordTypeGroups";
import { StoryRecordOrderToggle, StoryRecordTimeline } from "./StoryRecordTimeline";

export interface StoryData {
  records: StoryRecord[];
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

type PersonStoryT = TFunction;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <ModalSectionHeading>{children}</ModalSectionHeading>;
}

function InfoCard({ children }: { children: React.ReactNode }) {
  return (
    <div className={`group relative flex items-start gap-4 p-4 ${MODAL_CARD}`}>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * One row of the identity table — same anatomy as the person-detail modal's
 * on-chain record, so the two dialogs present the same data the same way.
 */
function RecordRow({
  label,
  badge,
  value,
  copy,
  copyLabel,
  onCopy,
  inset = true,
}: {
  label: React.ReactNode;
  badge?: React.ReactNode;
  value: React.ReactNode;
  copy?: string;
  copyLabel: string;
  onCopy: (text: string) => void;
  /** false inside a card that already supplies its own horizontal padding. */
  inset?: boolean;
}) {
  return (
    <div
      className={`group flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-4 ${inset ? "px-4" : ""}`}
    >
      <div className="flex w-full shrink-0 items-center gap-1.5 text-xs text-ink-muted sm:w-28">
        <span className="break-words">{label}</span>
        {badge}
      </div>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <div className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-ink">
          {value}
        </div>
        {copy ? <CopyButton label={copyLabel} onClick={() => onCopy(copy)} /> : null}
      </div>
    </div>
  );
}

function CopyButton({
  label,
  onClick,
  compact = false,
}: {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  compact?: boolean;
}) {
  return (
    <CopyIconButton
      label={label}
      onClick={onClick}
      size={compact ? "xs" : "sm"}
      visibility={compact ? "always" : "group-hover"}
    />
  );
}

export function StoryLifeEventsSection({
  t,
  birth,
  birthPlace,
  death,
  deathPlace,
}: {
  t: PersonStoryT;
  birth: string;
  birthPlace?: string;
  death: string;
  deathPlace?: string;
}) {
  if (!birth && !birthPlace && !death && !deathPlace) return null;

  return (
    <div className="space-y-4">
      <SectionTitle>{t("storyRecordsModal.lifeEvents", "Life Events")}</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(birth || birthPlace) && (
          <InfoCard>
            <div className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-1.5">
              {t("storyRecordsModal.born", "Born")}
            </div>
            <div className="text-sm font-medium text-ink leading-relaxed">
              {[birth, birthPlace].filter(Boolean).join(" · ")}
            </div>
          </InfoCard>
        )}

        {(death || deathPlace) && (
          <InfoCard>
            <div className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-1.5">
              {t("storyRecordsModal.died", "Died")}
            </div>
            <div className="text-sm font-medium text-ink leading-relaxed">
              {[death, deathPlace].filter(Boolean).join(" · ")}
            </div>
          </InfoCard>
        )}
      </div>
    </div>
  );
}

export function StoryIdentitySection({
  t,
  person,
  owner,
  copyText,
}: {
  t: PersonStoryT;
  person: NodeData;
  owner?: string;
  copyText: (text: string) => void;
}) {
  const privateMetadataUnlocked = isMetadataUnlockUsable(person);
  const visibleTag = privateMetadataUnlocked ? person.tag : undefined;
  if (!person.personHash && !isMinted(person) && !visibleTag && !person.nftTokenURI) return null;
  const copyLabel = t("common.copy", "Copy");

  return (
    <div className="space-y-4">
      <SectionTitle>{t("storyRecordsModal.blockchainIdentity", "Identity")}</SectionTitle>
      <div className={`${MODAL_CARD} divide-y divide-hairline overflow-hidden`}>
        {person.personHash && (
          <RecordRow
            label={t("storyRecordsModal.personHash", "Person Hash")}
            badge={
              person.versionIndex ? (
                <span className="rounded-sm bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                  v{person.versionIndex}
                </span>
              ) : undefined
            }
            value={person.personHash}
            copy={person.personHash}
            copyLabel={copyLabel}
            onCopy={copyText}
          />
        )}

        {isMinted(person) && (
          <RecordRow
            label={t("person.owner", "Owner Address")}
            value={owner || "-"}
            copy={owner || undefined}
            copyLabel={copyLabel}
            onCopy={copyText}
          />
        )}

        {visibleTag && (
          <RecordRow
            label={t("storyRecordsModal.tag", "Tag")}
            value={<span className="font-sans">{visibleTag}</span>}
            copy={visibleTag}
            copyLabel={copyLabel}
            onCopy={copyText}
          />
        )}

        {person.nftTokenURI && (
          <RecordRow
            label={t("familyTree.nodeDetail.uri", "Token URI")}
            value={person.nftTokenURI}
            copy={person.nftTokenURI}
            copyLabel={copyLabel}
            onCopy={copyText}
          />
        )}
      </div>
    </div>
  );
}

export function BasicStorySection({
  t,
  story,
  title,
  biography,
}: {
  t: PersonStoryT;
  story?: string;
  title?: string;
  biography?: StoryRecord;
}) {
  if (!story && !biography?.unsupportedSchema) return null;

  return (
    <div className="space-y-3">
      <SectionTitle>{t("storyRecordsModal.basicStory", "Basic Story")}</SectionTitle>
      <InfoCard>
        <h4 className="mb-2 break-words text-sm font-semibold text-ink">
          {(biography?.title ?? title)?.trim()
            ? (biography?.title ?? title)
            : t("storyRecordsModal.biographyTitle", "Biography")}
        </h4>
        {biography?.unsupportedSchema ? (
          <UnsupportedStoryRecord record={biography} />
        ) : (
          <p className="text-sm leading-relaxed text-ink whitespace-pre-wrap font-medium">
            {story}
          </p>
        )}
      </InfoCard>
    </div>
  );
}

function StoryViewToggle({
  t,
  viewMode,
  onChange,
}: {
  t: PersonStoryT;
  viewMode: "records" | "full";
  onChange: (mode: "records" | "full") => void;
}) {
  const buttonClass = (active: boolean) =>
    `inline-flex h-[34px] items-center gap-2 px-3.5 rounded-lg border text-[13px] font-semibold transition-colors focus:outline-hidden focus:ring-3 focus:ring-primary/15 ${
      active
        ? "bg-primary border-primary text-white dark:text-orange-950"
        : "bg-surface border-hairline-strong text-ink hover:bg-surface-alt hover:border-primary"
    }`;
  const iconClass = (active: boolean) => (active ? "" : "text-ink-muted");

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-pressed={viewMode === "records"}
        onClick={() => onChange("records")}
        className={buttonClass(viewMode === "records")}
      >
        <Layers size={14} className={iconClass(viewMode === "records")} />
        <span>{t("storyRecordsModal.records", "Records")}</span>
      </button>
      <button
        type="button"
        aria-pressed={viewMode === "full"}
        onClick={() => onChange("full")}
        className={buttonClass(viewMode === "full")}
      >
        <FileText size={14} className={iconClass(viewMode === "full")} />
        <span>{t("storyRecordsModal.fullText", "Full Text")}</span>
      </button>
    </div>
  );
}

/**
 * Edit or seal status, and integrity only when it fails.
 *
 * Every record shown was already verified byte-for-byte as it was read, so a
 * standing "verified" badge said nothing on the ordinary day. What is worth
 * saying is the other case — the list itself is incomplete, the sizes do not add
 * up, or the recomputed record-chain head disagrees with the chain — and that is
 * said the way the person page says it.
 */
function StoryIntegritySection({
  t,
  person,
  canEditStory,
  storyData,
}: {
  t: PersonStoryT;
  person: NodeData;
  canEditStory: boolean;
  storyData: StoryData;
}) {
  const sealed = Boolean(person.storyMetadata?.isSealed);
  const editable = !sealed && canEditStory && Boolean(person.tokenId);
  const integrity = storyData.integrity;
  const hasIssues =
    !storyData.loading &&
    !storyData.integrityChecking &&
    Number(person.storyMetadata?.totalRecords ?? 0) > 0 &&
    Boolean(integrity) &&
    (integrity.missing.length > 0 || !integrity.lengthMatch || integrity.hashMatch === false);

  if (!sealed && !editable && !hasIssues) return null;

  return (
    <>
      {sealed ? (
        <div>
          <span className={`${MODAL_CHIP} border-info/25 bg-info/10 text-info`}>
            <Check size={12} strokeWidth={3} />
            {t("person.sealed", "Sealed")}
          </span>
        </div>
      ) : editable ? (
        <div>
          <button
            type="button"
            onClick={() => {
              if (!person.tokenId || !canEditStory) return;
              window.open(`/editor/${person.tokenId}`, "_blank", "noopener,noreferrer");
            }}
            className={`group ${MODAL_CHIP} border-hairline-strong bg-surface text-ink transition-colors hover:border-primary hover:text-primary`}
          >
            <Edit2 size={12} className="group-hover:scale-110 transition-transform" />
            {t("familyTree.nodeDetail.editStory", "Edit Story")}
          </button>
        </div>
      ) : null}

      {hasIssues && (
        <div
          role="alert"
          className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          {integrity.missing.length > 0 && (
            <span className="inline-flex items-start gap-1.5">
              <AlertCircle size={13} className="mt-px shrink-0" aria-hidden />
              {t("person.integrityMissing", "Missing indices: {{indices}}", {
                indices: integrity.missing.join(","),
              })}
            </span>
          )}
          {!integrity.lengthMatch && (
            <span className="inline-flex items-start gap-1.5">
              <AlertCircle size={13} className="mt-px shrink-0" aria-hidden />
              {t("person.integrityLenDiff", "Length mismatch local={{local}} bytes", {
                local: integrity.computedLength,
              })}
            </span>
          )}
          {integrity.hashMatch === false && (
            <span className="inline-flex items-start gap-1.5">
              <AlertCircle size={13} className="mt-px shrink-0" aria-hidden />
              {t("person.integrityLocalHashMismatch", "Local hash mismatch")}
            </span>
          )}
        </div>
      )}
    </>
  );
}

export function StoryEmptyState({ t, icon = "file" }: { t: PersonStoryT; icon?: "file" | "book" }) {
  const Icon = icon === "book" ? Book : FileText;
  return (
    <div className="text-center py-16 bg-surface-alt rounded-xl border border-dashed border-hairline">
      <Icon className="w-10 h-10 text-ink-subtle mx-auto mb-4" />
      <p className="text-sm font-medium text-ink-muted">
        {icon === "book"
          ? t("storyRecordsModal.noStory", "No story content available")
          : t("storyRecordsModal.noStoryData", "No story data available")}
      </p>
    </div>
  );
}

function StoryLoadingState({ t }: { t: PersonStoryT }) {
  return (
    <div className="flex items-center justify-center py-16 bg-surface-alt rounded-xl border border-dashed border-hairline">
      <div className="text-center">
        <div className="animate-spin w-6 h-6 border-2 border-ink border-t-transparent rounded-full mx-auto mb-4 opacity-50" />
        <span className="text-sm font-medium text-ink-muted">
          {t("storyRecordsModal.loading", "Loading story records...")}
        </span>
      </div>
    </div>
  );
}

function StoryErrorState({ error }: { error: string }) {
  return (
    <div className="text-center py-16 bg-red-50 dark:bg-red-900/10 rounded-xl border border-danger/25/20">
      <AlertCircle className="w-10 h-10 text-danger/50 dark:text-red-400/50 mx-auto mb-4" />
      <p className="text-sm font-medium text-danger">{error}</p>
    </div>
  );
}

function StoryFullTextPanel({ fullStory }: { fullStory: string }) {
  return (
    <div className="bg-surface rounded-xl p-6 sm:p-8 border border-hairline shadow-xs leading-relaxed">
      <div className="prose prose-base dark:prose-invert max-w-none">
        <div className="whitespace-pre-wrap text-ink font-serif leading-relaxed">{fullStory}</div>
      </div>
    </div>
  );
}

export function DetailedStorySection({
  t,
  person,
  canEditStory,
  storyData,
  recordsCount,
  lengthBytes,
  viewMode,
  recordOrder,
  expandedRecords,
  personHasDetailedStory,
  onViewModeChange,
  onRecordOrderChange,
  onToggleRecord,
  getRecordTypeLabel,
  copyText,
}: {
  t: PersonStoryT;
  person: NodeData;
  canEditStory: boolean;
  storyData: StoryData;
  recordsCount: number;
  lengthBytes: number;
  viewMode: "records" | "full";
  recordOrder: StoryRecordOrder;
  expandedRecords: Set<number>;
  personHasDetailedStory: boolean;
  onViewModeChange: (mode: "records" | "full") => void;
  onRecordOrderChange: (next: StoryRecordOrder) => void;
  onToggleRecord: (index: number) => void;
  getRecordTypeLabel: (type: number | string | null | undefined) => string;
  copyText: (text: string) => void;
}) {
  const shouldRender =
    personHasDetailedStory ||
    person.storyMetadata ||
    storyData.loading ||
    storyData.records.length > 0 ||
    !!storyData.fullStory ||
    storyData.integrity.computedLength > 0 ||
    isMinted(person);

  if (!shouldRender) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <SectionTitle>{t("storyRecordsModal.detailedStory", "Detailed Story")}</SectionTitle>
          {recordsCount > 0 && (
            <span className="text-xs font-bold text-ink-muted px-2.5 py-1 bg-surface-muted rounded-full">
              {t("storyRecordsModal.recordsAndSize", "{{count}} records · {{size}} bytes", {
                count: recordsCount,
                size: lengthBytes,
              })}
            </span>
          )}
        </div>
        <StoryViewToggle t={t} viewMode={viewMode} onChange={onViewModeChange} />
      </div>

      <StoryIntegritySection
        t={t}
        person={person}
        canEditStory={canEditStory}
        storyData={storyData}
      />

      {/* Applies to both views: the full text is the records joined in this order. */}
      {!storyData.loading && !storyData.error && storyData.records.length > 1 && (
        <StoryRecordOrderToggle t={t} value={recordOrder} onChange={onRecordOrderChange} />
      )}

      {storyData.loading ? (
        <StoryLoadingState t={t} />
      ) : storyData.error ? (
        <StoryErrorState error={storyData.error} />
      ) : viewMode === "records" && storyData.records.length > 0 ? (
        <StoryRecordTimeline
          t={t}
          records={storyData.records}
          expandedRecords={expandedRecords}
          getRecordTypeLabel={getRecordTypeLabel}
          onToggleRecord={onToggleRecord}
          copyText={copyText}
        />
      ) : viewMode === "full" && storyData.fullStory ? (
        <StoryFullTextPanel fullStory={storyData.fullStory} />
      ) : (
        <StoryEmptyState t={t} />
      )}
    </div>
  );
}
