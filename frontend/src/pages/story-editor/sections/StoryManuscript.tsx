import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Clock, Hash, Link2, Lock, User } from "lucide-react";
import {
  getChunkTypeBorderColorClass,
  getChunkTypeColorClass,
  getChunkTypeIcon,
} from "../../../domains/person";
import { formatUnixSeconds, shortAddress } from "../../../shared/model";
import { CopyIconButton } from "../../../shared/ui";
import { UnsupportedStoryRecord } from "../../../shared/ui/UnsupportedStoryRecord";
import { summariseCollapsedTypes } from "../model/manuscriptSegments";
import { storyChunkAnchorId } from "../model/storyOutline";
import { StoryComposer } from "./StoryComposer";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

/**
 * The manuscript: every chunk on one spine, in order, read as a document. The
 * composer is the last stop on that spine rather than a separate form.
 */
export function StoryManuscript({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;

  return (
    <div ref={editor.refs.scrollContainerRef} className="flex flex-col gap-6">
      {editor.showError && (
        <section
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400"
        >
          <p className="mb-1 font-bold text-red-800 dark:text-red-300">
            {t("common.error", "Error")}
          </p>
          <p>{editor.errorMessage}</p>
        </section>
      )}

      {editor.loading && (
        <section
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex flex-col items-center justify-center gap-4 py-12 text-ink-muted"
        >
          <div
            aria-hidden
            className="h-10 w-10 animate-spin rounded-full border-4 border-hairline border-t-primary"
          />
          <p className="text-sm font-medium">{t("storyChunkEditor.loading", "Loading...")}</p>
        </section>
      )}

      {editor.showEmptySealed && (
        <section className="py-12 text-center text-ink-muted">
          <Lock size={44} aria-hidden className="mx-auto mb-4 opacity-50" />
          <p className="text-sm font-medium">
            {t("storyChunkEditor.noChunksSealed", "This profile is sealed with no chunks.")}
          </p>
        </section>
      )}

      {(editor.sortedChunks.length > 0 || editor.showEditorForm) && (
        <div className="relative flex flex-col gap-7 pl-8 sm:pl-9">
          {/* the spine the entries hang off */}
          <div
            aria-hidden
            className="absolute bottom-10 left-[6px] top-2.5 w-px bg-hairline-strong/50 sm:left-[7px]"
          />

          {editor.manuscript.head.map((chunk) => (
            <ManuscriptEntry key={chunk.chunkIndex} editor={editor} chunk={chunk} />
          ))}

          {editor.manuscript.collapsed.length > 0 && <ManuscriptFold editor={editor} />}

          {editor.manuscript.isExpanded && (
            <>
              {editor.manuscript.collapsed.map((chunk) => (
                <ManuscriptEntry key={chunk.chunkIndex} editor={editor} chunk={chunk} />
              ))}
              {/* the run's closing bracket — reading to the end of it should not
                  cost a scroll back to the top to fold it away again */}
              <ManuscriptFold editor={editor} placement="end" />
            </>
          )}

          {editor.manuscript.tail.map((chunk) => (
            <ManuscriptEntry key={chunk.chunkIndex} editor={editor} chunk={chunk} />
          ))}

          {editor.sortedChunks.length === 0 && !editor.loading && (
            <p className="text-sm text-ink-subtle">
              {t("storyChunkEditor.noChunks", "No profile chunks yet.")}
            </p>
          )}

          {editor.showEditorForm && (
            <div className="relative">
              <span
                aria-hidden
                className="absolute -left-8 top-4 box-border h-[15px] w-[15px] rounded-full border-[3px] border-primary bg-primary/10 sm:-left-9"
              />
              <StoryComposer editor={editor} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The fold, in its two jobs.
 *
 * Collapsed it stands in for content, so it carries weight: a dot per hidden
 * entry and the distinct types, enough to judge whether to open it. Expanded it
 * stands in for nothing — the entries are right there — so it drops to a quiet
 * way back, matching an entry's own "read the full chunk" toggle. Restating
 * "7 chunks collapsed" over seven visible chunks would simply be false.
 */
function ManuscriptFold({
  editor,
  placement = "start",
}: {
  editor: StoryEditorController;
  placement?: "start" | "end";
}) {
  const { t } = editor;
  const collapsed = editor.manuscript.collapsed;
  const expanded = editor.manuscript.isExpanded;

  if (expanded) {
    return (
      <div className="relative">
        <FoldSpineMarker />
        <button
          type="button"
          onClick={editor.manuscript.toggle}
          aria-expanded
          className="flex w-fit items-center gap-1.5 rounded-lg py-0.5 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <ChevronUp size={13} aria-hidden />
          {t("storyChunkEditor.collapseRun", "Collapse {{total}} chunks", {
            total: collapsed.length,
          })}
        </button>
      </div>
    );
  }

  // Collapsed there is only ever one control, at the top; the closing one is
  // what the expanded run needs, so it has nothing to render here.
  if (placement === "end") return null;

  const { labels, truncated } = summariseCollapsedTypes(collapsed, editor.getChunkTypeLabel);
  const summary = labels.join(t("storyChunkEditor.listSeparator", ", ")) + (truncated ? "…" : "");

  return (
    <div className="relative">
      <FoldSpineMarker />
      <button
        type="button"
        onClick={editor.manuscript.toggle}
        aria-expanded={false}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-hairline bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-hairline-strong focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span aria-hidden className="flex shrink-0 gap-1">
          {collapsed.slice(0, 6).map((chunk) => (
            <span
              key={chunk.chunkIndex}
              className={`h-[7px] w-[7px] rounded-full bg-current ${getChunkTypeColorClass(chunk.chunkType)}`}
            />
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted">
          {t("storyChunkEditor.collapsedRun", "{{total}} chunks collapsed", {
            total: collapsed.length,
          })}
          {labels.length > 0 && <span className="ml-1">— {summary}</span>}
        </span>
        <span className="shrink-0 text-[12px] font-medium text-ink-muted">
          {t("storyChunkEditor.expandRun", "Expand")}
        </span>
      </button>
    </div>
  );
}

/** Keeps the fold control anchored to the spine in both states. */
function FoldSpineMarker() {
  return (
    <span
      aria-hidden
      className="absolute -left-[31px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-hairline-strong sm:-left-[35px]"
    />
  );
}

function ManuscriptEntry({
  editor,
  chunk,
}: {
  editor: StoryEditorController;
  chunk: StoryEditorController["sortedChunks"][number];
}) {
  const { t } = editor;
  const isExpanded = editor.expandedChunks.has(chunk.chunkIndex);
  const bodyRef = useRef<HTMLParagraphElement | null>(null);
  // Whether the clamped body actually overflows. Measured rather than guessed
  // from a character count: 320 characters is three lines of English and seven
  // of Chinese, so a length threshold silently truncates CJK entries.
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element || isExpanded) return;
    const measure = () => setOverflows(element.scrollHeight - element.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [chunk.content, isExpanded]);

  const ChunkIcon = getChunkTypeIcon(chunk.chunkType);
  const iconColor = getChunkTypeColorClass(chunk.chunkType);
  const borderColor = getChunkTypeBorderColorClass(chunk.chunkType);
  const byteLength = chunk.payloadLength ?? editor.getByteLength(chunk.content);

  return (
    <article
      id={storyChunkAnchorId(chunk.chunkIndex)}
      className="relative flex scroll-mt-24 flex-col gap-2.5"
    >
      <span
        aria-hidden
        className={`absolute -left-8 top-1 box-border h-[13px] w-[13px] rounded-full border-[3px] bg-surface-body sm:-left-9 ${borderColor}`}
      />

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-mono text-[11px] text-ink-subtle">#{chunk.displayIndex}</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border bg-surface py-[3px] pl-2 pr-2.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] ${iconColor} ${borderColor}`}
        >
          <ChunkIcon size={12} aria-hidden />
          {editor.getChunkTypeLabel(chunk.chunkType)}
        </span>
        <span className="grow" />
        {/* Author drops away on narrow screens — it stays one tap away in the
            expanded provenance, and keeping it here dangles a separator. */}
        {chunk.editor && (
          <span className="hidden items-center gap-2.5 sm:flex">
            <span className="font-mono text-[11px] text-ink-subtle" title={chunk.editor}>
              {shortAddress(chunk.editor)}
            </span>
            <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-hairline-strong" />
          </span>
        )}
        <span className="flex items-center gap-2 whitespace-nowrap text-[11px] text-ink-subtle">
          <span>{formatUnixSeconds(chunk.timestamp)}</span>
          <span aria-hidden className="text-hairline-strong">
            ·
          </span>
          <span>{byteLength} B</span>
        </span>
      </div>

      {chunk.unsupportedSchema ? (
        <UnsupportedStoryRecord record={chunk} />
      ) : (
        <p
          ref={bodyRef}
          className={`text-[15.5px] leading-[1.8] text-ink ${
            isExpanded ? "whitespace-pre-wrap" : "line-clamp-4"
          }`}
          style={{ textWrap: "pretty" } as React.CSSProperties}
        >
          {chunk.content}
        </p>
      )}

      {(overflows || isExpanded) && !chunk.unsupportedSchema && (
        <button
          type="button"
          onClick={() => editor.toggleChunkExpansion(chunk.chunkIndex)}
          aria-expanded={isExpanded}
          className="flex w-fit items-center gap-1.5 rounded-lg py-0.5 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {isExpanded
            ? t("storyChunkEditor.collapseChunk", "Collapse")
            : t("storyChunkEditor.readFullChunk", "Read the full chunk")}
          <ChevronDown
            size={13}
            aria-hidden
            className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
          />
        </button>
      )}

      {isExpanded && <EntryProvenance editor={editor} chunk={chunk} />}
    </article>
  );
}

function EntryProvenance({
  editor,
  chunk,
}: {
  editor: StoryEditorController;
  chunk: StoryEditorController["sortedChunks"][number];
}) {
  const { t } = editor;

  return (
    <div className="flex flex-col gap-1 border-t border-hairline pt-2">
      {chunk.editor && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          <User size={12} aria-hidden className="shrink-0" />
          <span className="truncate font-mono" title={chunk.editor}>
            {shortAddress(chunk.editor)}
          </span>
          <CopyIconButton
            label={t("search.copy", "Copy") as string}
            onClick={() => editor.copyText(chunk.editor)}
            size="xs"
            stopPropagation
          />
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
        <Clock size={12} aria-hidden className="shrink-0" />
        <span>{formatUnixSeconds(chunk.timestamp)}</span>
      </div>
      {chunk.attachmentCID && chunk.attachmentCID.trim().length > 0 && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          <Link2 size={12} aria-hidden className="shrink-0" />
          <span className="truncate font-mono">{chunk.attachmentCID}</span>
          <CopyIconButton
            label={t("search.copy", "Copy") as string}
            onClick={() => editor.copyText(chunk.attachmentCID)}
            size="xs"
            stopPropagation
          />
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
        <Hash size={12} aria-hidden className="shrink-0" />
        <span className="truncate font-mono" title={chunk.chunkHash}>
          {editor.formatHash(chunk.chunkHash)}
        </span>
        <CopyIconButton
          label={t("search.copy", "Copy") as string}
          onClick={() => editor.copyText(chunk.chunkHash)}
          size="xs"
          stopPropagation
        />
      </div>
    </div>
  );
}
