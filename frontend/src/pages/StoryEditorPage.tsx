import { useStoryEditorController } from "./story-editor/hooks/useStoryEditorController";
import { SealConfirmDialog, ChunkTypeHelpDialog } from "./story-editor/sections/StoryEditorDialogs";
import { StoryEditorMainSection } from "./story-editor/sections/StoryEditorMainSection";
import { StoryChunksSidebar } from "./story-editor/sections/StoryChunksSidebar";

export default function StoryEditorPage() {
  const editor = useStoryEditorController();

  return (
    <>
      <div data-story-editor-page className="w-full py-8">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
          <StoryEditorMainSection editor={editor} />
          <StoryChunksSidebar editor={editor} />
        </div>
      </div>

      <SealConfirmDialog editor={editor} />
      <ChunkTypeHelpDialog editor={editor} />
    </>
  );
}
