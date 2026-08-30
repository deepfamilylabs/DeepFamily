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
  StoryChunk,
  isMinted,
  isMetadataUnlockUsable,
  formatUnixSeconds,
} from "../../../shared/model";
import { CopyIconButton, MODAL_CARD, MODAL_CHIP, ModalSectionHeading } from "../../../shared/ui";
import { getChunkTypeIcon, getChunkTypeColorClass } from "../config/chunkTypes";

export interface StoryData {
  chunks: StoryChunk[];
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
      <SectionTitle>{t("storyChunksModal.lifeEvents", "Life Events")}</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(birth || birthPlace) && (
          <InfoCard>
            <div className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-1.5">
              {t("storyChunksModal.born", "Born")}
            </div>
            <div className="text-sm font-medium text-ink leading-relaxed">
              {[birth, birthPlace].filter(Boolean).join(" · ")}
            </div>
          </InfoCard>
        )}

        {(death || deathPlace) && (
          <InfoCard>
            <div className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-1.5">
              {t("storyChunksModal.died", "Died")}
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
      <SectionTitle>{t("storyChunksModal.blockchainIdentity", "Identity")}</SectionTitle>
      <div className={`${MODAL_CARD} divide-y divide-hairline overflow-hidden`}>
        {person.personHash && (
          <RecordRow
            label={t("storyChunksModal.personHash", "Person Hash")}
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
            label={t("storyChunksModal.tag", "Tag")}
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

export function BasicStorySection({ t, story }: { t: PersonStoryT; story?: string }) {
  if (!story) return null;

  return (
    <div className="space-y-3">
      <SectionTitle>{t("storyChunksModal.basicStory", "Basic Story")}</SectionTitle>
      <InfoCard>
        <p className="text-sm leading-relaxed text-ink whitespace-pre-wrap font-medium">
          {story}
        </p>
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
  viewMode: "chunks" | "full";
  onChange: (mode: "chunks" | "full") => void;
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
        aria-pressed={viewMode === "chunks"}
        onClick={() => onChange("chunks")}
        className={buttonClass(viewMode === "chunks")}
      >
        <Layers size={14} className={iconClass(viewMode === "chunks")} />
        <span>
          {t("storyChunksModal.chunks", "Chunks")}
        </span>
      </button>
      <button
        type="button"
        aria-pressed={viewMode === "full"}
        onClick={() => onChange("full")}
        className={buttonClass(viewMode === "full")}
      >
        <FileText size={14} className={iconClass(viewMode === "full")} />
        <span>
          {t("storyChunksModal.fullText", "Full Text")}
        </span>
      </button>
    </div>
  );
}

function StoryIntegritySection({
  t,
  person,
  chunksCount,
  storyData,
  integrityOk,
}: {
  t: PersonStoryT;
  person: NodeData;
  chunksCount: number;
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
          person.tokenId && (
            <button
              type="button"
              onClick={() => {
                if (!person.tokenId) return;
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
      {chunksCount > 0 &&
        !storyData.loading &&
        (storyData.integrityChecking ? (
          <span className={`${MODAL_CHIP} border-hairline bg-surface-alt text-ink-muted`}>
            <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
            {t("storyChunksModal.integrityChecking", "Checking...")}
          </span>
        ) : (
          storyData.integrity &&
          (integrityOk ? (
            <span className={`${MODAL_CHIP} border-success/25 bg-success/10 text-success`}>
              <Check size={12} strokeWidth={3} />
              {t("storyChunksModal.integrityVerified", "Integrity verified")}
            </span>
          ) : (
            <span className={`${MODAL_CHIP} border-warning/25 bg-warning/10 text-warning`}>
              <AlertCircle size={12} />
              {t("storyChunksModal.integrityWarning", "Integrity failed")}
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
          ? t("storyChunksModal.noStory", "No story content available")
          : t("storyChunksModal.noStoryData", "No story data available")}
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
          {t("storyChunksModal.loading", "Loading story chunks...")}
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
        <div className="whitespace-pre-wrap text-ink font-serif leading-relaxed">
          {fullStory}
        </div>
      </div>
    </div>
  );
}

function StoryChunkCard({
  t,
  chunk,
  isExpanded,
  getChunkTypeLabel,
  onToggle,
  copyText,
}: {
  t: PersonStoryT;
  chunk: StoryChunk;
  isExpanded: boolean;
  getChunkTypeLabel: (type: number | string | null | undefined) => string;
  onToggle: (index: number) => void;
  copyText: (text: string) => void;
}) {
  const preview = chunk.content.length > 120 ? `${chunk.content.slice(0, 120)}...` : chunk.content;
  const ChunkIcon = getChunkTypeIcon(chunk.chunkType);
  const iconColor = getChunkTypeColorClass(chunk.chunkType);
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
        onClick={() => onToggle(chunk.chunkIndex)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle(chunk.chunkIndex);
          }
        }}
        className="w-full text-left p-4 cursor-pointer rounded-xl focus:outline-hidden focus:ring-3 focus:ring-primary/15"
      >
        <div className="flex items-start gap-4">
          <div
            className={`mt-0.5 p-1.5 rounded-full transition-colors ${
              isExpanded
                ? "bg-primary/12 text-primary"
                : "bg-surface-muted text-ink-subtle"
            }`}
          >
            {isExpanded ? (
              <ChevronDown size={16} strokeWidth={2.5} />
            ) : (
              <ChevronRight size={16} strokeWidth={2.5} />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-bold tracking-tight ${isExpanded ? "text-orange-700 dark:text-orange-400" : "text-ink"}`}
                >
                  #{chunk.chunkIndex}
                </span>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface border border-hairline shadow-xs">
                  <ChunkIcon size={12} className={iconColor} />
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider ${iconColor.replace("text-", "text-opacity-80 text-")}`}
                  >
                    {getChunkTypeLabel(chunk.chunkType)}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-bold text-ink-subtle bg-surface-muted px-2 py-0.5 rounded-full uppercase tracking-wider">
                {chunk.content.length} {t("storyChunksModal.characters", "chars")}
              </span>
            </div>

            <div
              className={`text-sm leading-relaxed ${isExpanded ? "text-ink whitespace-pre-wrap" : "text-ink-muted line-clamp-2"}`}
            >
              {isExpanded ? chunk.content : preview}
            </div>

            {isExpanded && (
              <div
                className="mt-4 border-t border-hairline divide-y divide-hairline"
                onClick={(e) => e.stopPropagation()}
              >
                <RecordRow
                  inset={false}
                  label={t("storyChunksModal.chunkEditor", "Editor")}
                  value={chunk.editor || "-"}
                  copy={chunk.editor || undefined}
                  copyLabel={copyLabel}
                  onCopy={copyText}
                />
                <RecordRow
                  inset={false}
                  label={t("familyTree.nodeDetail.timestamp", "Timestamp")}
                  value={formatUnixSeconds(chunk.timestamp)}
                  copyLabel={copyLabel}
                  onCopy={copyText}
                />
                {chunk.attachmentCID && chunk.attachmentCID.trim().length > 0 && (
                  <RecordRow
                    inset={false}
                    label={t("storyChunksModal.attachment", "Attachment")}
                    value={chunk.attachmentCID}
                    copy={chunk.attachmentCID}
                    copyLabel={copyLabel}
                    onCopy={copyText}
                  />
                )}
                <RecordRow
                  inset={false}
                  label={t("storyChunksModal.chunkHash", "Chunk Hash")}
                  value={chunk.chunkHash}
                  copy={chunk.chunkHash}
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

function StoryChunkList({
  t,
  chunks,
  expandedChunks,
  getChunkTypeLabel,
  onToggleChunk,
  copyText,
}: {
  t: PersonStoryT;
  chunks: StoryChunk[];
  expandedChunks: Set<number>;
  getChunkTypeLabel: (type: number | string | null | undefined) => string;
  onToggleChunk: (index: number) => void;
  copyText: (text: string) => void;
}) {
  return (
    <div className="space-y-3">
      {chunks.map((chunk) => (
        <StoryChunkCard
          key={chunk.chunkIndex}
          t={t}
          chunk={chunk}
          isExpanded={expandedChunks.has(chunk.chunkIndex)}
          getChunkTypeLabel={getChunkTypeLabel}
          onToggle={onToggleChunk}
          copyText={copyText}
        />
      ))}
    </div>
  );
}

export function DetailedStorySection({
  t,
  person,
  storyData,
  chunksCount,
  lengthBytes,
  integrityOk,
  viewMode,
  expandedChunks,
  personHasDetailedStory,
  onViewModeChange,
  onToggleChunk,
  getChunkTypeLabel,
  copyText,
}: {
  t: PersonStoryT;
  person: NodeData;
  storyData: StoryData;
  chunksCount: number;
  lengthBytes: number;
  integrityOk: boolean;
  viewMode: "chunks" | "full";
  expandedChunks: Set<number>;
  personHasDetailedStory: boolean;
  onViewModeChange: (mode: "chunks" | "full") => void;
  onToggleChunk: (index: number) => void;
  getChunkTypeLabel: (type: number | string | null | undefined) => string;
  copyText: (text: string) => void;
}) {
  const shouldRender =
    personHasDetailedStory ||
    person.storyMetadata ||
    storyData.loading ||
    storyData.chunks.length > 0 ||
    !!storyData.fullStory ||
    storyData.integrity.computedLength > 0 ||
    isMinted(person);

  if (!shouldRender) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <SectionTitle>{t("storyChunksModal.detailedStory", "Detailed Story")}</SectionTitle>
          {chunksCount > 0 && (
            <span className="text-xs font-bold text-ink-muted px-2.5 py-1 bg-surface-muted rounded-full">
              {t("storyChunksModal.chunksAndSize", "{{count}} chunks · {{size}} bytes", {
                count: chunksCount,
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
        chunksCount={chunksCount}
        storyData={storyData}
        integrityOk={integrityOk}
      />

      {storyData.loading ? (
        <StoryLoadingState t={t} />
      ) : storyData.error ? (
        <StoryErrorState error={storyData.error} />
      ) : viewMode === "chunks" && storyData.chunks.length > 0 ? (
        <StoryChunkList
          t={t}
          chunks={storyData.chunks}
          expandedChunks={expandedChunks}
          getChunkTypeLabel={getChunkTypeLabel}
          onToggleChunk={onToggleChunk}
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
