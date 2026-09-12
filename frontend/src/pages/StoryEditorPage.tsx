import { useState } from "react";
import { useStoryEditorController } from "./story-editor/hooks/useStoryEditorController";
import {
  SealConfirmDialog,
  ChunkTypeHelpDialog,
  StoryTransactionPreviewDialog,
} from "./story-editor/sections/StoryEditorDialogs";
import { StoryContentsOutline } from "./story-editor/sections/StoryContentsOutline";
import { StoryEditorHeader } from "./story-editor/sections/StoryEditorHeader";
import { StoryManuscript } from "./story-editor/sections/StoryManuscript";
import { StoryRecordPanel } from "./story-editor/sections/StoryRecordPanel";

type EditorPane = "story" | "contents" | "record";

const PANES: { id: EditorPane; key: string; fallback: string }[] = [
  { id: "story", key: "storyChunkEditor.paneStory", fallback: "Profile" },
  { id: "contents", key: "storyChunkEditor.contents", fallback: "Contents" },
  { id: "record", key: "storyChunkEditor.paneRecord", fallback: "Record" },
];

/**
 * Profile data editor.
 *
 * Three columns on wide screens — Contents, the manuscript you compose into, and
 * the on-chain record. Narrower than xl there is not room for all three side by
 * side, so a toggle group swaps between them and the manuscript leads.
 */
export default function StoryEditorPage() {
  const editor = useStoryEditorController();
  const [pane, setPane] = useState<EditorPane>("story");
  const paneClass = (id: EditorPane) => (pane === id ? "" : "hidden xl:block");

  return (
    <>
      <div data-story-editor-page className="flex w-full flex-col gap-7 py-8">
        <StoryEditorHeader editor={editor} />

        <div
          role="group"
          aria-label={editor.t("storyChunkEditor.paneSwitcher", "Editor section")}
          className="grid grid-cols-3 gap-1 rounded-full bg-surface-muted p-1 xl:hidden"
        >
          {PANES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={pane === item.id}
              onClick={() => setPane(item.id)}
              className={`min-h-[38px] rounded-full text-[12.5px] transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 ${
                pane === item.id
                  ? "bg-surface font-semibold text-ink shadow-sm"
                  : "font-medium text-ink-muted hover:text-ink"
              }`}
            >
              {editor.t(item.key, item.fallback)}
            </button>
          ))}
        </div>

        <div className="grid items-start gap-7 xl:grid-cols-[248px_minmax(0,1fr)_256px]">
          <div className={`${paneClass("contents")} xl:sticky xl:top-20`}>
            <StoryContentsOutline editor={editor} />
          </div>

          <div className={paneClass("story")}>
            <StoryManuscript editor={editor} />
          </div>

          <div className={`${paneClass("record")} xl:sticky xl:top-20`}>
            <StoryRecordPanel editor={editor} />
          </div>
        </div>
      </div>

      <StoryTransactionPreviewDialog editor={editor} />
      <SealConfirmDialog editor={editor} />
      <ChunkTypeHelpDialog editor={editor} />
    </>
  );
}
