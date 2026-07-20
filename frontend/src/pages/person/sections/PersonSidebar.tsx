import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Clock, Hash, Link, User } from "lucide-react";
import {
  getChunkTypeBorderColorClass,
  getChunkTypeColorClass,
  getChunkTypeIcon,
  getChunkTypeOptions,
} from "../../../domains/person";
import { formatHashMiddle, formatUnixSeconds, shortAddress, type StoryChunk } from "../../../shared/model";
import type { PersonPageController } from "../hooks/usePersonPageController";
import { getChunkTypeLabel } from "../model/personPageModel";
import { CopyIconButton } from "../../../shared/ui";

export function PersonSidebar({ person }: { person: PersonPageController }) {
  const data = person.data;

  if (!data) return null;

  return (
    <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
      <ChunkListCard person={person} />
      {data.storyMetadata && <DesktopMetadataCard person={person} />}
    </div>
  );
}

function ChunkListCard({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;
  const sortedChunks = useMemo(
    () =>
      data?.storyChunks
        ? [...data.storyChunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
        : [],
    [data?.storyChunks],
  );

  if (!data) return null;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-4 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t("person.chunkList", "Chunk List")}
          {data.storyChunks && data.storyChunks.length > 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-sm">
              {data.storyChunks.length}
            </span>
          )}
        </h3>
      </div>
      {sortedChunks.length > 0 ? (
        <div className="divide-y divide-gray-200 dark:divide-gray-800 max-h-[500px] overflow-y-auto scrollbar-gutter-stable">
          {sortedChunks.map((chunk) => (
            <ChunkListItem key={chunk.chunkIndex} chunk={chunk} person={person} />
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            {t("person.noChunks", "No chunks")}
          </p>
        </div>
      )}
    </div>
  );
}

function ChunkListItem({
  chunk,
  person,
}: {
  chunk: StoryChunk;
  person: PersonPageController;
}) {
  const { t } = useTranslation();
  const chunkTypeOptions = useMemo(() => getChunkTypeOptions(t), [t]);
  const open = person.expandedChunks.has(chunk.chunkIndex);
  const preview =
    chunk.content.length > 60 ? `${chunk.content.slice(0, 60)}...` : chunk.content;
  const ChunkIcon = getChunkTypeIcon(chunk.chunkType);
  const iconColor = getChunkTypeColorClass(chunk.chunkType);
  const borderColor = getChunkTypeBorderColorClass(chunk.chunkType);

  return (
    <div className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <div
        role="button"
        tabIndex={0}
        onClick={() => person.toggleChunk(chunk.chunkIndex)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            person.toggleChunk(chunk.chunkIndex);
          }
        }}
        className="w-full text-left flex items-start gap-1.5 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm"
      >
        <span className="mt-0.5 text-gray-400 dark:text-gray-500 shrink-0">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                #{chunk.chunkIndex}
              </span>
              <div className="flex items-center gap-1.5">
                <ChunkIcon size={14} className={iconColor} />
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border ${iconColor} ${borderColor} bg-white dark:bg-gray-900`}
                >
                  {getChunkTypeLabel(
                    chunk.chunkType,
                    chunkTypeOptions,
                    t("chunkTypes.unknown", "Unknown"),
                  )}
                </span>
              </div>
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {chunk.content.length}
            </span>
          </div>
          <div
            className={`text-xs text-gray-600 dark:text-gray-400 ${
              open ? "whitespace-pre-wrap" : "line-clamp-2"
            }`}
          >
            {open ? chunk.content : preview}
          </div>
          {open && <ChunkDetails chunk={chunk} person={person} />}
        </div>
      </div>
    </div>
  );
}

function ChunkDetails({
  chunk,
  person,
}: {
  chunk: StoryChunk;
  person: PersonPageController;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-1 mt-1.5 pt-1.5 border-t border-gray-200 dark:border-gray-700"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <User size={12} className="shrink-0" />
        {chunk.editor ? (
          <>
            <span className="truncate" title={chunk.editor}>
              {shortAddress(chunk.editor)}
            </span>
            <CopyIconButton
              label={t("search.copy")}
              onClick={() => person.copyText(chunk.editor)}
              size="xs"
              stopPropagation
            />
          </>
        ) : (
          <span>-</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Clock size={12} className="shrink-0" />
        <span>{formatUnixSeconds(chunk.timestamp)}</span>
      </div>
      {chunk.attachmentCID && chunk.attachmentCID.trim().length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Link size={12} className="shrink-0" />
          <span className="truncate font-mono" title={chunk.attachmentCID}>
            {chunk.attachmentCID.length > 20
              ? `${chunk.attachmentCID.slice(0, 8)}...${chunk.attachmentCID.slice(-8)}`
              : chunk.attachmentCID}
          </span>
          <CopyIconButton
            label={t("search.copy")}
            onClick={() => person.copyText(chunk.attachmentCID)}
            size="xs"
            stopPropagation
          />
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Hash size={12} className="shrink-0" />
        <span className="font-mono truncate" title={chunk.chunkHash}>
          {formatHashMiddle(chunk.chunkHash)}
        </span>
        <CopyIconButton
          label={t("search.copy")}
          onClick={() => person.copyText(chunk.chunkHash)}
          size="xs"
          stopPropagation
        />
      </div>
    </div>
  );
}

function DesktopMetadataCard({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;

  if (!data?.storyMetadata) return null;

  return (
    <div className="hidden xl:block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-4 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t("person.metadata", "Metadata")}
        </h3>
      </div>
      <div className="p-4 space-y-2.5 text-sm">
        <DesktopMetadataValue label={t("person.tokenId", "Token ID")} value={`#${data.tokenId}`} />
        <DesktopMetadataValue
          label={t("person.totalChunks", "Total Chunks")}
          value={data.storyMetadata.totalChunks}
        />
        <DesktopMetadataValue
          label={t("person.totalLength", "Total Length")}
          value={data.storyMetadata.totalLength}
        />
        <DesktopMetadataValue
          label={t("person.lastUpdate", "Last Update")}
          value={formatUnixSeconds(data.storyMetadata.lastUpdateTime)}
          small
        />
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
        <DesktopCopyValue
          label={t("person.storyHash", "Story Hash")}
          value={data.storyMetadata.fullStoryHash}
          onCopy={() => person.copyText(data.storyMetadata!.fullStoryHash)}
        />
        <DesktopCopyValue
          label={t("person.owner", "Owner Address")}
          title={data.owner}
          value={data.owner || "-"}
          onCopy={data.owner ? () => person.copyText(data.owner!) : undefined}
        />
        {data.personHash && (
          <DesktopCopyValue
            label={t("person.personHashLabel", "Person Hash")}
            value={data.personHash}
            onCopy={() => person.copyText(data.personHash!)}
          />
        )}
        {data.versionIndex !== undefined && data.versionIndex > 0 && (
          <DesktopCopyValue
            label={t("person.versionLabel", "Version:")}
            value={`${data.versionIndex}`}
            onCopy={() => person.copyText(`${data.versionIndex}`)}
          />
        )}
      </div>
    </div>
  );
}

function DesktopMetadataValue({
  label,
  small,
  value,
}: {
  label: string;
  small?: boolean;
  value: number | string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500 dark:text-gray-400 text-xs">{label}</span>
      <span
        className={`font-mono ${
          small
            ? "text-xs text-gray-700 dark:text-gray-300"
            : "font-medium text-gray-900 dark:text-gray-100"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function DesktopCopyValue({
  label,
  onCopy,
  title,
  value,
}: {
  label: string;
  onCopy?: () => void;
  title?: string;
  value: string;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{label}</div>
      <div className="flex items-center">
        <div
          className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-sm select-all text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700"
          title={title}
        >
          {value}
        </div>
        {onCopy && (
          <CopyIconButton
            onClick={onCopy}
            label={t("search.copy")}
            size="xs"
          />
        )}
      </div>
    </div>
  );
}
