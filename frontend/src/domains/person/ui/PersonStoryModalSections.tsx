import { UnsupportedStoryRecord } from "../../../shared/ui/UnsupportedStoryRecord";
import type React from "react";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import {
  Book,
  FileText,
  ChevronDown,
  ChevronRight,
  Layers,
  AlertCircle,
  Edit2,
  Check,
} from "lucide-react";
import {
  NodeData,
  StoryRecord,
  isMinted,
  isMetadataUnlockUsable,
  formatUnixSeconds,
} from "../../../shared/model";
import { CopyIconButton, MODAL_CARD, MODAL_CHIP, ModalSectionHeading } from "../../../shared/ui";
import { getRecordTypeIcon, getRecordTypeColorClass } from "../config/recordTypes";

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

function StoryIntegritySection({
  t,
  person,
  canEditStory,
  recordsCount,
  storyData,
  integrityOk,
}: {
  t: PersonStoryT;
  person: NodeData;
  canEditStory: boolean;
  recordsCount: number;
  storyData: StoryData;
  integrityOk: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap min-h-[32px]">
      <div>
        {person.storyMetadata?.isSealed ? (
          <span className={`${MODAL_CHIP} border-info/25 bg-info/10 text-info`}>
            <Check size={12} strokeWidth={3} />
            {t("person.sealed", "Sealed")}
          </span>
        ) : (
          canEditStory &&
          person.tokenId && (
            <button
              type="button"
              onClick={() => {
                if (!person.tokenId || !canEditStory) return;
                window.open(`/editor/${person.tokenId}`, "_blank", "noopener,noreferrer");
              }}
              className={`group ${MODAL_CHIP} border-success/25 bg-success/10 text-success transition-colors hover:bg-success/15`}
            >
              <Edit2 size={12} className="group-hover:scale-110 transition-transform" />
              {t("person.editable", "Editable")}
            </button>
          )
        )}
      </div>
      {recordsCount > 0 &&
        !storyData.loading &&
        (storyData.integrityChecking ? (
          <span className={`${MODAL_CHIP} border-hairline bg-surface-alt text-ink-muted`}>
            <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
            {t("storyRecordsModal.integrityChecking", "Checking...")}
          </span>
        ) : (
          storyData.integrity &&
          (integrityOk ? (
            <span className={`${MODAL_CHIP} border-success/25 bg-success/10 text-success`}>
              <Check size={12} strokeWidth={3} />
              {t("storyRecordsModal.integrityVerified", "Integrity verified")}
            </span>
          ) : (
            <span className={`${MODAL_CHIP} border-warning/25 bg-warning/10 text-warning`}>
              <AlertCircle size={12} />
              {t("storyRecordsModal.integrityWarning", "Integrity failed")}
            </span>
          ))
        ))}
    </div>
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

function StoryRecordCard({
  t,
  record,
  isExpanded,
  getRecordTypeLabel,
  onToggle,
  copyText,
}: {
  t: PersonStoryT;
  record: StoryRecord;
  isExpanded: boolean;
  getRecordTypeLabel: (type: number | string | null | undefined) => string;
  onToggle: (index: number) => void;
  copyText: (text: string) => void;
}) {
  const preview =
    record.content.length > 120 ? `${record.content.slice(0, 120)}...` : record.content;
  const RecordIcon = getRecordTypeIcon(record.recordType);
  const iconColor = getRecordTypeColorClass(record.recordType);
  const copyLabel = t("common.copy", "Copy");

  return (
    <div
      className={`group relative rounded-xl border bg-surface transition-colors ${
        isExpanded ? "border-primary/40" : "border-hairline hover:border-hairline-strong"
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={() => onToggle(record.recordIndex)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle(record.recordIndex);
          }
        }}
        className="w-full text-left p-4 cursor-pointer rounded-xl focus:outline-hidden focus:ring-3 focus:ring-primary/15"
      >
        <div className="flex items-start gap-4">
          <div
            className={`mt-0.5 p-1.5 rounded-full transition-colors ${
              isExpanded ? "bg-primary/12 text-primary" : "bg-surface-muted text-ink-subtle"
            }`}
          >
            {isExpanded ? (
              <ChevronDown size={16} strokeWidth={2.5} />
            ) : (
              <ChevronRight size={16} strokeWidth={2.5} />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {record.title?.trim() && (
              <h4 className="mb-2 break-words font-semibold text-ink">{record.title}</h4>
            )}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-bold tracking-tight ${isExpanded ? "text-orange-700 dark:text-orange-400" : "text-ink"}`}
                >
                  #{record.displayIndex ?? record.recordIndex + 1}
                </span>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface border border-hairline shadow-xs">
                  <RecordIcon size={12} className={iconColor} />
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider ${iconColor.replace("text-", "text-opacity-80 text-")}`}
                  >
                    {getRecordTypeLabel(record.recordType)}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-bold text-ink-subtle bg-surface-muted px-2 py-0.5 rounded-full uppercase tracking-wider">
                {record.content.length} {t("storyRecordsModal.characters", "chars")}
              </span>
            </div>

            <div
              className={`text-sm leading-relaxed ${isExpanded ? "text-ink whitespace-pre-wrap" : "text-ink-muted line-clamp-2"}`}
            >
              {record.unsupportedSchema ? (
                <UnsupportedStoryRecord record={record} />
              ) : isExpanded ? (
                record.content
              ) : (
                preview
              )}
            </div>

            {isExpanded && (
              <div
                className="mt-4 border-t border-hairline divide-y divide-hairline"
                onClick={(e) => e.stopPropagation()}
              >
                <RecordRow
                  inset={false}
                  label={t("storyRecordsModal.author", "Author")}
                  value={record.author || "-"}
                  copy={record.author || undefined}
                  copyLabel={copyLabel}
                  onCopy={copyText}
                />
                <RecordRow
                  inset={false}
                  label={t("familyTree.nodeDetail.timestamp", "Timestamp")}
                  value={formatUnixSeconds(record.timestamp)}
                  copyLabel={copyLabel}
                  onCopy={copyText}
                />
                {record.attachmentCID && record.attachmentCID.trim().length > 0 && (
                  <RecordRow
                    inset={false}
                    label={t("storyRecordsModal.attachment", "Attachment")}
                    value={record.attachmentCID}
                    copy={record.attachmentCID}
                    copyLabel={copyLabel}
                    onCopy={copyText}
                  />
                )}
                <RecordRow
                  inset={false}
                  label={t("storyRecordsModal.payloadHash", "Record Hash")}
                  value={record.payloadHash}
                  copy={record.payloadHash}
                  copyLabel={copyLabel}
                  onCopy={copyText}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StoryRecordList({
  t,
  records,
  expandedRecords,
  getRecordTypeLabel,
  onToggleRecord,
  copyText,
}: {
  t: PersonStoryT;
  records: StoryRecord[];
  expandedRecords: Set<number>;
  getRecordTypeLabel: (type: number | string | null | undefined) => string;
  onToggleRecord: (index: number) => void;
  copyText: (text: string) => void;
}) {
  return (
    <div className="space-y-3">
      {records.map((record) => (
        <StoryRecordCard
          key={record.recordIndex}
          t={t}
          record={record}
          isExpanded={expandedRecords.has(record.recordIndex)}
          getRecordTypeLabel={getRecordTypeLabel}
          onToggle={onToggleRecord}
          copyText={copyText}
        />
      ))}
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
  integrityOk,
  viewMode,
  expandedRecords,
  personHasDetailedStory,
  onViewModeChange,
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
  integrityOk: boolean;
  viewMode: "records" | "full";
  expandedRecords: Set<number>;
  personHasDetailedStory: boolean;
  onViewModeChange: (mode: "records" | "full") => void;
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
        recordsCount={recordsCount}
        storyData={storyData}
        integrityOk={integrityOk}
      />

      {storyData.loading ? (
        <StoryLoadingState t={t} />
      ) : storyData.error ? (
        <StoryErrorState error={storyData.error} />
      ) : viewMode === "records" && storyData.records.length > 0 ? (
        <StoryRecordList
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
