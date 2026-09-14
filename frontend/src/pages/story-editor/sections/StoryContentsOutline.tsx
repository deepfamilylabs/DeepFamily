import { Lock } from "lucide-react";
import { getRecordTypeColorClass } from "../../../domains/person";
import { storyRecordAnchorId } from "../model/storyOutline";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

/**
 * Contents column — the profile in the order it will be read, grouped the way
 * the published page groups it. Rows jump to the matching manuscript entry; the
 * dashed row is the record being composed, shown inside the group where readers
 * will find it once it is written.
 */
export function StoryContentsOutline({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;

  const jumpTo = (recordIndex: number) => {
    const scroll = () =>
      document
        .getElementById(storyRecordAnchorId(recordIndex))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Contents lists every record, including the ones behind the manuscript's
    // fold — open it first, then scroll once React has rendered the entry.
    if (editor.manuscript.reveal(recordIndex)) {
      requestAnimationFrame(() => requestAnimationFrame(scroll));
      return;
    }
    scroll();
  };

  return (
    <nav
      aria-label={t("storyRecordEditor.contents", "Contents")}
      className="flex flex-col gap-3.5 rounded-[20px] border border-hairline bg-surface px-3.5 pb-3.5 pt-4 shadow-sm"
    >
      <div className="flex items-center justify-between px-1.5">
        <h2 className="ui-heading text-[13px] text-ink">
          {t("storyRecordEditor.contents", "Contents")}
        </h2>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
          {editor.sortedRecords.length}
        </span>
      </div>

      {editor.outline.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {editor.outline.map((item) => {
            if (item.kind === "group") {
              return (
                <li
                  key={item.key}
                  className="px-1.5 pb-[3px] pt-2.5 text-[9.5px] font-bold uppercase tracking-[0.13em] text-ink-subtle first:pt-1.5"
                >
                  {item.label}
                </li>
              );
            }

            if (item.kind === "draft") {
              return (
                <li key={item.key}>
                  <div className="flex items-center gap-[9px] rounded-[10px] border border-dashed border-primary bg-primary/8 px-2 py-[7px]">
                    <span
                      aria-hidden
                      className={`h-[7px] w-[7px] shrink-0 rounded-full bg-current ${getRecordTypeColorClass(item.recordType)}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
                      {item.label}
                    </span>
                    <span className="font-mono text-[10.5px] text-primary">
                      {item.displayIndex}
                    </span>
                  </div>
                </li>
              );
            }

            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => jumpTo(item.recordIndex)}
                  className={`flex w-full items-center gap-[9px] rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-surface-alt focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 ${
                    editor.expandedRecords.has(item.recordIndex) ? "bg-surface-alt" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-[7px] w-[7px] shrink-0 rounded-full bg-current ${getRecordTypeColorClass(item.recordType)}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {item.label}
                  </span>
                  <span className="font-mono text-[10.5px] text-ink-subtle">
                    {item.displayIndex}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-1.5 pb-1 text-[12.5px] text-ink-subtle">
          {t("storyRecordEditor.noRecords", "No profile records yet.")}
        </p>
      )}

      {editor.isSealed && (
        <p className="flex items-center gap-2 border-t border-hairline px-1.5 pt-3 text-[11.5px] text-ink-muted">
          <Lock size={13} aria-hidden className="shrink-0" />
          {t("storyRecordEditor.closedToNewRecords", "Closed to new records")}
        </p>
      )}
    </nav>
  );
}
