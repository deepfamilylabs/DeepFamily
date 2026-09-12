import { Lock } from "lucide-react";
import { getChunkTypeColorClass } from "../../../domains/person";
import { storyChunkAnchorId } from "../model/storyOutline";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

/**
 * Contents column — a map of the manuscript in document order. Rows jump to the
 * matching entry; the trailing dashed row is the chunk being composed, so the
 * draft has a place in the outline before it has a place on chain.
 */
export function StoryContentsOutline({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  const hasChunks = editor.sortedChunks.length > 0;

  const jumpTo = (chunkIndex: number) => {
    const scroll = () =>
      document
        .getElementById(storyChunkAnchorId(chunkIndex))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Contents lists every chunk, including the ones behind the manuscript's
    // fold — open it first, then scroll once React has rendered the entry.
    if (editor.manuscript.reveal(chunkIndex)) {
      requestAnimationFrame(() => requestAnimationFrame(scroll));
      return;
    }
    scroll();
  };

  return (
    <nav
      aria-label={t("storyChunkEditor.contents", "Contents")}
      className="flex flex-col gap-3.5 rounded-[20px] border border-hairline bg-surface px-3.5 pb-3.5 pt-4 shadow-sm"
    >
      <div className="flex items-center justify-between px-1.5">
        <h2 className="ui-heading text-[13px] text-ink">
          {t("storyChunkEditor.contents", "Contents")}
        </h2>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
          {editor.sortedChunks.length}
        </span>
      </div>

      {hasChunks ? (
        <ul className="flex flex-col gap-0.5">
          {editor.outline.map((item) =>
            item.kind === "group" ? (
              <li
                key={item.key}
                className="px-1.5 pb-[3px] pt-2.5 text-[9.5px] font-bold uppercase tracking-[0.13em] text-ink-subtle first:pt-1.5"
              >
                {item.label}
              </li>
            ) : (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => jumpTo(item.chunkIndex)}
                  className={`flex w-full items-center gap-[9px] rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-surface-alt focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 ${
                    editor.expandedChunks.has(item.chunkIndex) ? "bg-surface-alt" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-[7px] w-[7px] shrink-0 rounded-full bg-current ${getChunkTypeColorClass(item.chunkType)}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {item.label}
                  </span>
                  <span className="font-mono text-[10.5px] text-ink-subtle">
                    #{item.displayIndex}
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="px-1.5 pb-1 text-[12.5px] text-ink-subtle">
          {t("storyChunkEditor.noChunks", "No profile chunks yet.")}
        </p>
      )}

      {editor.isSealed ? (
        <p className="flex items-center gap-2 border-t border-hairline px-1.5 pt-3 text-[11.5px] text-ink-muted">
          <Lock size={13} aria-hidden className="shrink-0" />
          {t("storyChunkEditor.closedToNewChunks", "Closed to new chunks")}
        </p>
      ) : (
        <div className="border-t border-dashed border-hairline pt-3">
          <div className="flex items-center gap-[9px] rounded-[10px] border border-dashed border-primary bg-primary/8 px-2 py-[7px]">
            <span
              aria-hidden
              className={`h-[7px] w-[7px] shrink-0 rounded-full bg-current ${getChunkTypeColorClass(editor.form.data.chunkType)}`}
            />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
              {editor.getChunkTypeLabel(editor.form.data.chunkType)}
            </span>
            <span className="font-mono text-[10.5px] text-primary">
              #{editor.draftDisplayIndex}
            </span>
          </div>
        </div>
      )}
    </nav>
  );
}
