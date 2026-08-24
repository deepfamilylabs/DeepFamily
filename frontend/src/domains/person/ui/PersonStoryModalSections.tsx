import type React from "react";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import {
  User,
  Book,
  FileText,
  Clock,
  ChevronDown,
  ChevronRight,
  Layers,
  Hash,
  AlertCircle,
  Link,
  Edit2,
  Check,
} from "lucide-react";
import {
  NodeData,
  StoryChunk,
  isMinted,
  isMetadataUnlockUsable,
  formatUnixSeconds,
  shortAddress,
  formatHashMiddle,
} from "../../../shared/model";
import { CopyIconButton } from "../../../shared/ui";
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

interface AbbreviatedTextProps {
  text?: string | null;
  isDesktop: boolean;
  format: (value: string) => string;
}

function AbbreviatedText({ text, isDesktop, format }: AbbreviatedTextProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [useAbbrev, setUseAbbrev] = useState<boolean>(() => !isDesktop);
  const fullText = text ?? "";

  useEffect(() => {
    if (!text) {
      setUseAbbrev(false);
      return;
    }
    if (!isDesktop) {
      setUseAbbrev(true);
      return;
    }
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    setUseAbbrev(measure.scrollWidth > container.clientWidth + 1);
  }, [fullText, isDesktop, text]);

  useEffect(() => {
    if (!isDesktop) return;
    const onResize = () => {
      const container = containerRef.current;
      const measure = measureRef.current;
      if (!container || !measure) return;
      setUseAbbrev(measure.scrollWidth > container.clientWidth + 1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isDesktop]);

  if (!text) return <span>-</span>;

  return (
    <div ref={containerRef} className="relative min-w-0" title={text}>
      <span className="block whitespace-nowrap overflow-hidden text-ellipsis">
        {useAbbrev ? format(text) : text}
      </span>
      <span
        ref={measureRef}
        className="absolute left-0 top-0 opacity-0 pointer-events-none whitespace-nowrap"
      >
        {text}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider px-1">
      {children}
    </h3>
  );
}

function InfoCard({ borderClass, children }: { borderClass: string; children: React.ReactNode }) {
  return (
    <div
      className={`group relative flex items-start gap-4 p-4 pl-5 rounded-r-2xl rounded-l-md bg-white dark:bg-gray-900 border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] ${borderClass} transition-all duration-300`}
    >
      <div className="min-w-0 flex-1">{children}</div>
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
          <InfoCard borderClass="border-l-emerald-500/80 hover:shadow-[0_8px_30px_-4px_rgba(16,185,129,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(16,185,129,0.25)]">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              {t("storyChunksModal.born", "Born")}
            </div>
            <div className="text-sm font-medium text-gray-900 dark:text-white leading-relaxed">
              {[birth, birthPlace].filter(Boolean).join(" · ")}
            </div>
          </InfoCard>
        )}

        {(death || deathPlace) && (
          <InfoCard borderClass="border-l-gray-400 hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.25)]">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              {t("storyChunksModal.died", "Died")}
            </div>
            <div className="text-sm font-medium text-gray-900 dark:text-white leading-relaxed">
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
  isDesktop,
  copyText,
}: {
  t: PersonStoryT;
  person: NodeData;
  owner?: string;
  isDesktop: boolean;
  copyText: (text: string) => void;
}) {
  const privateMetadataUnlocked = isMetadataUnlockUsable(person);
  const visibleTag = privateMetadataUnlocked ? person.tag : undefined;
  if (!person.personHash && !isMinted(person) && !visibleTag && !person.nftTokenURI) return null;
  const copyLabel = t("common.copy", "Copy");

  return (
    <div className="space-y-4">
      <SectionTitle>{t("storyChunksModal.blockchainIdentity", "Identity")}</SectionTitle>
      <div className="grid grid-cols-1 gap-3">
        {person.personHash && (
          <InfoCard borderClass="border-l-purple-500/80 hover:shadow-[0_8px_30px_-4px_rgba(168,85,247,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(168,85,247,0.25)]">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t("storyChunksModal.personHash", "Person Hash")}
              </div>
              {person.versionIndex && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-md">
                  v{person.versionIndex}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm font-medium text-gray-900 dark:text-white min-w-0 flex-1 font-mono break-all leading-relaxed">
                <AbbreviatedText
                  text={person.personHash}
                  isDesktop={isDesktop}
                  format={formatHashMiddle}
                />
              </div>
              <CopyButton label={copyLabel} onClick={() => copyText(person.personHash)} />
            </div>
          </InfoCard>
        )}

        {isMinted(person) && (
          <InfoCard borderClass="border-l-amber-500/80 hover:shadow-[0_8px_30px_-4px_rgba(245,158,11,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(245,158,11,0.25)]">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              {t("person.owner", "Owner Address")}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm font-medium text-gray-900 dark:text-white min-w-0 flex-1 font-mono break-all leading-relaxed">
                <AbbreviatedText text={owner} isDesktop={isDesktop} format={shortAddress} />
              </div>
              {owner && <CopyButton label={copyLabel} onClick={() => copyText(owner)} />}
            </div>
          </InfoCard>
        )}

        {visibleTag && (
          <InfoCard borderClass="border-l-gray-400 hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.25)]">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              {t("storyChunksModal.tag", "Tag")}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm font-medium text-gray-900 dark:text-white leading-relaxed">
                {visibleTag}
              </div>
              <CopyButton label={copyLabel} onClick={() => copyText(visibleTag)} />
            </div>
          </InfoCard>
        )}

        {person.nftTokenURI && (
          <InfoCard borderClass="border-l-gray-400 hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(156,163,175,0.25)]">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              {t("familyTree.nodeDetail.uri", "Token URI")}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 break-all line-clamp-1 flex-1 font-mono leading-relaxed">
                {person.nftTokenURI}
              </div>
              <CopyButton label={copyLabel} onClick={() => copyText(person.nftTokenURI!)} />
            </div>
          </InfoCard>
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
      <InfoCard borderClass="border-l-blue-500/80 hover:shadow-[0_8px_30px_-4px_rgba(59,130,246,0.15)] dark:hover:shadow-[0_8px_30px_-4px_rgba(59,130,246,0.25)]">
        <p className="text-sm leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap font-medium">
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
    `group relative inline-flex h-9 items-center gap-2 px-4 rounded-full border transition-all duration-200 ${
      active
        ? "bg-orange-500 border-orange-500 text-white shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)]"
        : "bg-white dark:bg-black/40 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-orange-500 hover:border-orange-500 hover:text-white hover:shadow-[0_4px_15px_-3px_rgba(249,115,22,0.4)] hover:scale-105 active:scale-95"
    }`;
  const iconClass = (active: boolean) =>
    active ? "text-white" : "text-gray-400 group-hover:text-white transition-colors";

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-pressed={viewMode === "chunks"}
        onClick={() => onChange("chunks")}
        className={buttonClass(viewMode === "chunks")}
      >
        <Layers size={14} className={iconClass(viewMode === "chunks")} />
        <span className="text-xs font-bold tracking-wide">
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
        <span className="text-xs font-bold tracking-wide">
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
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-100 dark:border-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold bg-blue-50 dark:bg-blue-900/10">
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
              className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 border border-transparent hover:border-green-200 dark:hover:border-green-500/30 text-green-700 dark:text-green-400 text-xs font-bold transition-all duration-300"
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
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-gray-500 dark:text-gray-400 text-xs font-medium bg-gray-50 dark:bg-gray-800">
            <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
            {t("storyChunksModal.integrityChecking", "Checking...")}
          </span>
        ) : (
          storyData.integrity &&
          (integrityOk ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-green-600 dark:text-green-400 text-xs font-bold bg-green-50 dark:bg-green-900/10">
              <Check size={12} strokeWidth={3} />
              {t("storyChunksModal.integrityVerified", "Integrity verified")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-amber-600 dark:text-amber-400 text-xs font-bold bg-amber-50 dark:bg-amber-900/10">
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
    <div className="text-center py-16 bg-gray-50/50 dark:bg-white/5 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
      <Icon className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {icon === "book"
          ? t("storyChunksModal.noStory", "No story content available")
          : t("storyChunksModal.noStoryData", "No story data available")}
      </p>
    </div>
  );
}

function StoryLoadingState({ t }: { t: PersonStoryT }) {
  return (
    <div className="flex items-center justify-center py-16 bg-gray-50/50 dark:bg-white/5 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
      <div className="text-center">
        <div className="animate-spin w-6 h-6 border-2 border-gray-900 dark:border-white border-t-transparent rounded-full mx-auto mb-4 opacity-50" />
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {t("storyChunksModal.loading", "Loading story chunks...")}
        </span>
      </div>
    </div>
  );
}

function StoryErrorState({ error }: { error: string }) {
  return (
    <div className="text-center py-16 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-200 dark:border-red-800/20">
      <AlertCircle className="w-10 h-10 text-red-500/50 dark:text-red-400/50 mx-auto mb-4" />
      <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
    </div>
  );
}

function StoryFullTextPanel({ fullStory }: { fullStory: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 sm:p-8 border border-gray-100 dark:border-gray-800 shadow-xs leading-relaxed">
      <div className="prose prose-base dark:prose-invert max-w-none">
        <div className="whitespace-pre-wrap text-gray-800 dark:text-gray-200 font-serif leading-relaxed">
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
      className={`group relative rounded-r-2xl rounded-l-md border-y border-r border-gray-100 dark:border-gray-800 border-l-[3px] transition-all duration-300 ${
        isExpanded
          ? "bg-white dark:bg-gray-900 border-l-orange-500 shadow-[0_8px_30px_-4px_rgba(249,115,22,0.15)] dark:shadow-[0_8px_30px_-4px_rgba(249,115,22,0.25)]"
          : "bg-white dark:bg-gray-900 border-l-gray-200 dark:border-l-gray-700 hover:border-l-orange-400 hover:shadow-lg dark:hover:shadow-none hover:shadow-gray-200/50"
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
        className="w-full text-left p-4 pl-5 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-orange-500/50 rounded-r-2xl rounded-l-md"
      >
        <div className="flex items-start gap-4">
          <div
            className={`mt-0.5 p-1.5 rounded-full transition-colors ${
              isExpanded
                ? "bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400"
                : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300"
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
                  className={`text-sm font-bold tracking-tight ${isExpanded ? "text-orange-700 dark:text-orange-400" : "text-gray-900 dark:text-gray-100"}`}
                >
                  #{chunk.chunkIndex}
                </span>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white dark:bg-black border border-gray-100 dark:border-gray-800 shadow-xs">
                  <ChunkIcon size={12} className={iconColor} />
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider ${iconColor.replace("text-", "text-opacity-80 text-")}`}
                  >
                    {getChunkTypeLabel(chunk.chunkType)}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full uppercase tracking-wider">
                {chunk.content.length} {t("storyChunksModal.characters", "chars")}
              </span>
            </div>

            <div
              className={`text-sm leading-relaxed ${isExpanded ? "text-gray-900 dark:text-gray-100 whitespace-pre-wrap" : "text-gray-600 dark:text-gray-400 line-clamp-2"}`}
            >
              {isExpanded ? chunk.content : preview}
            </div>

            {isExpanded && (
              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800/50"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <User size={14} className="text-gray-400" />
                  {chunk.editor ? (
                    <>
                      <span className="truncate" title={chunk.editor}>
                        {shortAddress(chunk.editor)}
                      </span>
                      <CopyButton
                        compact
                        label={copyLabel}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyText(chunk.editor);
                        }}
                      />
                    </>
                  ) : (
                    <span>-</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <Clock size={14} className="text-gray-400" />
                  <span>{formatUnixSeconds(chunk.timestamp)}</span>
                </div>
                {chunk.attachmentCID && chunk.attachmentCID.trim().length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 sm:col-span-2">
                    <Link size={14} className="text-gray-400" />
                    <span
                      className="truncate font-mono bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 rounded-sm"
                      title={chunk.attachmentCID}
                    >
                      {chunk.attachmentCID}
                    </span>
                    <CopyButton
                      compact
                      label={copyLabel}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyText(chunk.attachmentCID);
                      }}
                    />
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 sm:col-span-2">
                  <Hash size={14} className="text-gray-400" />
                  <span className="font-mono truncate" title={chunk.chunkHash}>
                    {formatHashMiddle(chunk.chunkHash)}
                  </span>
                  <CopyButton
                    compact
                    label={copyLabel}
                    onClick={(e) => {
                      e.stopPropagation();
                      copyText(chunk.chunkHash);
                    }}
                  />
                </div>
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
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 px-2.5 py-1 bg-gray-100 dark:bg-gray-800 rounded-full">
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
