import { Lock } from "lucide-react";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

/**
 * Page header: whose profile this is.
 *
 * Nothing else, deliberately. Token id, record count, payload bytes and last
 * update are all rows of the record column's on-chain card, and a fact stated
 * twice in two wordings ("open for writing" here, "editable" there) reads as two
 * facts. Writability needs no pill either: when you can write, the composer is
 * open at the end of the manuscript, and when you cannot, the access banner
 * below says why in a sentence.
 *
 * Sealing is the exception. It is the one state with no other voice in the
 * default narrow-screen pane — the seal card that explains it lives in the
 * record column, a tab away — so it keeps a marker here.
 */
export function StoryEditorHeader({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  const name = editor.personName || t("storyRecordEditor.titleFallback", "Profile Data");

  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-ink-subtle">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em]">
          {t("person.profileData", "Profile Data")}
        </span>
        <span className="grow" />
        {editor.meta && editor.isSealed && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
            <Lock size={12} aria-hidden />
            {t("storyRecordEditor.sealedReadOnly", "Sealed — read only")}
          </span>
        )}
      </div>

      {/* The name wraps rather than truncating: it has the row to itself now, and
          an ellipsis on a person's name buys nothing the page needs. */}
      <h1 className="page-title break-words text-[1.75rem] font-bold tracking-tight text-ink sm:text-[2.25rem]">
        {name}
      </h1>
    </header>
  );
}
