import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock,
  Hash,
  Link,
  Lock,
  User,
} from "lucide-react";
import {
  getChunkTypeBorderColorClass,
  getChunkTypeColorClass,
  getChunkTypeIcon,
} from "../../../domains/person";
import { formatUnixSeconds, shortAddress } from "../../../shared/model";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

export function StoryChunksSidebar({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;

  return (
    <aside className="xl:col-span-1 flex flex-col gap-6">
      {editor.sortedChunks.length > 0 ? (
        <section className="flex flex-col flex-shrink-0 overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-200/50 dark:border-gray-800 dark:bg-gray-900 dark:shadow-none">
          <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {t("storyChunkEditor.chunks", "Existing Chunks")}
            </h3>
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
              {editor.sortedChunks.length}
            </span>
          </header>
          <ul className="max-h-[600px] overflow-y-auto p-4 space-y-3">
            {editor.sortedChunks.map((chunk) => {
              const isExpanded = editor.expandedChunks.has(chunk.chunkIndex);
              const preview =
                chunk.content.length > 60 ? `${chunk.content.slice(0, 60)}...` : chunk.content;
              return (
                <li key={chunk.chunkIndex}>
                  <div
                    className={`w-full text-left flex items-start gap-3 rounded-2xl border p-4 transition-all cursor-pointer ${
                      isExpanded
                        ? "bg-white border-orange-200 shadow-md shadow-orange-100 dark:bg-gray-800 dark:border-orange-900/50 dark:shadow-none"
                        : "bg-gray-50/50 border-transparent hover:bg-white hover:border-gray-100 hover:shadow-sm dark:bg-gray-800/30 dark:hover:bg-gray-800 dark:hover:border-gray-700"
                    }`}
                    onClick={() => editor.toggleChunkExpansion(chunk.chunkIndex)}
                  >
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        editor.toggleChunkExpansion(chunk.chunkIndex);
                      }}
                      className="mt-0.5 text-gray-400 dark:text-gray-500 flex-shrink-0 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                      type="button"
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                    >
                      {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </button>
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => editor.toggleChunkExpansion(chunk.chunkIndex)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            #{chunk.chunkIndex}
                          </span>
                          {(() => {
                            const ChunkIcon = getChunkTypeIcon(chunk.chunkType);
                            const iconColor = getChunkTypeColorClass(chunk.chunkType);
                            const borderColor = getChunkTypeBorderColorClass(chunk.chunkType);
                            return (
                              <div className="flex items-center gap-1.5">
                                <ChunkIcon size={14} className={iconColor} />
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border ${iconColor} ${borderColor} bg-white dark:bg-gray-900`}
                                >
                                  {editor.getChunkTypeLabel(chunk.chunkType)}
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                        <div
                          className="flex items-center gap-1.5"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {chunk.content.length}
                          </span>
                        </div>
                      </div>
                      <p
                        className={`text-xs text-gray-600 dark:text-gray-400 ${isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}
                      >
                        {isExpanded ? chunk.content : preview}
                      </p>
                      {isExpanded && <ExpandedChunkDetails editor={editor} chunk={chunk} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm font-medium text-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-500">
          {t("storyChunkEditor.noChunks")}
        </div>
      )}

      {editor.meta && <StoryMetadataCard editor={editor} />}
    </aside>
  );
}

function ExpandedChunkDetails({
  editor,
  chunk,
}: {
  editor: StoryEditorController;
  chunk: StoryEditorController["sortedChunks"][number];
}) {
  const { t } = editor;

  return (
    <div
      className="space-y-1 mt-1.5 pt-1.5 border-t border-gray-200 dark:border-gray-700"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <User size={12} className="flex-shrink-0" />
        {chunk.editor ? (
          <>
            <span className="truncate" title={chunk.editor}>
              {shortAddress(chunk.editor)}
            </span>
            <CopyIconButton
              label={t("search.copy")}
              onClick={() => editor.copyText(chunk.editor)}
            />
          </>
        ) : (
          <span>-</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Clock size={12} className="flex-shrink-0" />
        <span>{formatUnixSeconds(chunk.timestamp)}</span>
      </div>
      {chunk.attachmentCID && chunk.attachmentCID.trim().length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Link size={12} className="flex-shrink-0" />
          <span className="truncate font-mono">{chunk.attachmentCID}</span>
          <CopyIconButton
            label={t("search.copy")}
            onClick={() => editor.copyText(chunk.attachmentCID)}
          />
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Hash size={12} className="flex-shrink-0" />
        <span className="font-mono truncate" title={chunk.chunkHash}>
          {editor.formatHash(chunk.chunkHash)}
        </span>
        <CopyIconButton label={t("search.copy")} onClick={() => editor.copyText(chunk.chunkHash)} />
      </div>
    </div>
  );
}

function StoryMetadataCard({ editor }: { editor: StoryEditorController }) {
  const { t, meta } = editor;
  if (!meta) return null;

  return (
    <section className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-200/50 dark:border-gray-800 dark:bg-gray-900 dark:shadow-none">
      <header className="border-b border-gray-100 px-6 py-4 dark:border-gray-800">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t("person.metadata", "Metadata")}
        </h3>
      </header>
      <div className="p-4 space-y-2.5 text-sm">
        <MetadataRow label={t("person.tokenId", "Token ID")} value={`#${editor.validTokenId || "-"}`} />
        <MetadataRow label={t("person.totalChunks", "Total Chunks")} value={meta.totalChunks} />
        <MetadataRow label={t("person.totalLength", "Total Length")} value={meta.totalLength} />
        <div className="flex justify-between items-center">
          <span className="text-gray-500 dark:text-gray-400 text-xs">
            {t("person.lastUpdate", "Last Update")}
          </span>
          <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
            {meta.lastUpdateTime ? formatUnixSeconds(meta.lastUpdateTime) : t("common.na", "N/A")}
          </span>
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-800">
          <span className="text-gray-500 dark:text-gray-400 text-xs">
            {t("person.status", "Status")}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded font-medium ${meta.isSealed ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"}`}
          >
            {meta.isSealed ? t("person.sealed", "Sealed") : t("person.editable", "Editable")}
          </span>
        </div>
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
        <HashCopyBlock
          label={t("person.storyHash", "Story Hash")}
          value={meta.fullStoryHash || "-"}
          canCopy={Boolean(meta.fullStoryHash)}
          onCopy={() => editor.copyText(meta.fullStoryHash!)}
          copyLabel={t("search.copy") as string}
        />
        {editor.nodeDetails?.personHash && (
          <HashCopyBlock
            label={t("person.personHashLabel", "Person Hash")}
            value={editor.nodeDetails.personHash}
            canCopy
            onCopy={() => editor.copyText(editor.nodeDetails!.personHash!)}
            copyLabel={t("search.copy") as string}
          />
        )}
        {editor.nodeDetails?.versionIndex !== undefined && editor.nodeDetails.versionIndex > 0 && (
          <HashCopyBlock
            label={t("person.versionLabel", "Version:")}
            value={`${editor.nodeDetails.versionIndex}`}
            canCopy
            onCopy={() => editor.copyText(`${editor.nodeDetails!.versionIndex}`)}
            copyLabel={t("search.copy") as string}
          />
        )}
      </div>
    </section>
  );
}

function MetadataRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500 dark:text-gray-400 text-xs">{label}</span>
      <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}

function HashCopyBlock({
  label,
  value,
  canCopy,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  canCopy: boolean;
  onCopy: () => void;
  copyLabel: string;
}) {
  return (
    <div>
      <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{label}</div>
      <div className="flex items-center">
        <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-md select-all text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700">
          {value}
        </div>
        {canCopy && (
          <button
            onClick={onCopy}
            className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label={copyLabel}
            title={copyLabel}
            type="button"
          >
            <Clipboard size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function CopyIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      aria-label={label}
      title={label}
      type="button"
    >
      <Clipboard size={12} />
    </button>
  );
}
