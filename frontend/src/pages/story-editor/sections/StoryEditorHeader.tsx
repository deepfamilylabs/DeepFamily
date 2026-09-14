import { StoryRecordOrderToggle } from "../../../domains/person";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

/**
 * Page header: whose profile this is, and the order the page lists it in.
 *
 * Nothing else, deliberately. Token id, record count, payload bytes and last
 * update are all rows of the record column's on-chain card, and a fact stated
 * twice in two wordings ("open for writing" here, "editable" there) reads as two
 * facts. Writability needs no pill either: when you can write, the composer is
 * open at the end of the manuscript; when you cannot, the access banner below
 * says why in a sentence; and a sealed profile says so on its seal card.
 *
 * The record order lives here rather than above the manuscript because it
 * orders Contents too. On narrow screens the header sits above the pane
 * switcher, so the choice is in reach from either pane.
 */
export function StoryEditorHeader({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  const name = editor.personName || t("storyRecordEditor.titleFallback", "Profile Data");

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
          {t("person.profileData", "Profile Data")}
        </span>

        {/* The name wraps rather than truncating: an ellipsis on a person's name
            buys nothing the page needs. */}
        <h1 className="page-title break-words text-[1.75rem] font-bold tracking-tight text-ink sm:text-[2.25rem]">
          {name}
        </h1>
      </div>

      {editor.sortedRecords.length > 1 && (
        <div className="ml-auto">
          <StoryRecordOrderToggle t={t} value={editor.order.value} onChange={editor.order.set} />
        </div>
      )}
    </header>
  );
}
