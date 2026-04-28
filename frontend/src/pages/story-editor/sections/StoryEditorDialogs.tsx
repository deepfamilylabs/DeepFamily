import { createPortal } from "react-dom";
import { HelpCircle, Lock, X } from "lucide-react";
import { getChunkTypeColorClass, getChunkTypeIcon } from "../../../domains/person";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

export function SealConfirmDialog({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  if (!editor.seal.showConfirm) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1002] flex items-center justify-center p-4" data-seal-dialog>
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="p-8">
          <div className="flex flex-col items-center text-center gap-4 mb-8">
            <div className="flex-shrink-0 w-16 h-16 rounded-full bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center">
              <Lock size={32} className="text-orange-600 dark:text-orange-500" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                {t("storyChunkEditor.sealDialog.title", "Seal Story")}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-xs mx-auto">
                {t(
                  "storyChunkEditor.sealDialog.description",
                  "Are you sure you want to seal the story? Once sealed, it cannot be modified.",
                )}
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => editor.seal.setShowConfirm(false)}
              disabled={editor.submitting}
              className="flex-1 px-4 py-3 text-sm font-bold text-gray-700 dark:text-gray-300 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-full disabled:opacity-50 transition-colors"
            >
              {t("storyChunkEditor.sealDialog.cancel", "Cancel")}
            </button>
            <button
              onClick={editor.seal.execute}
              disabled={editor.submitting}
              className="flex-1 px-4 py-3 text-sm font-bold text-white bg-gradient-to-r from-orange-400 to-red-600 hover:shadow-lg shadow-orange-500/20 rounded-full disabled:opacity-50 transition-all hover:scale-[1.02] flex items-center justify-center gap-2"
            >
              {editor.submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{t("storyChunkEditor.saving", "Saving...")}</span>
                </>
              ) : (
                <>
                  <Lock size={16} />
                  <span>{t("storyChunkEditor.sealDialog.confirm", "Confirm Seal")}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ChunkTypeHelpDialog({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  if (!editor.form.showChunkTypeHelp) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1002] flex items-center justify-center p-4"
      onClick={() => editor.form.setShowChunkTypeHelp(false)}
      data-chunk-help-dialog
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-3xl border border-gray-100 dark:border-gray-800 max-h-[75vh] overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <HelpCircle size={24} className="text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("storyChunkEditor.chunkTypeHelp.title", "Story Chunk Types Guide")}
            </h3>
          </div>
          <button
            onClick={() => editor.form.setShowChunkTypeHelp(false)}
            className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 hover:rotate-90"
            aria-label="Close"
            type="button"
          >
            <X size={24} />
          </button>
        </div>

        <div className="overflow-y-auto p-8 space-y-8">
          <div className="prose dark:prose-invert max-w-none">
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              {t(
                "storyChunkEditor.chunkTypeHelp.intro",
                "Story chunks are content type tags for organizing biographical narratives and life stories. These 19 types allow flexible storytelling - you can use multiple chunks of the same type in any order.",
              )}
            </p>
          </div>

          <HelpGroup
            title={t("storyChunkEditor.chunkTypeHelp.opening", "Opening")}
            items={[
              {
                value: 0,
                label: t("chunkTypes.summary", "Summary"),
                desc: t(
                  "storyChunkEditor.chunkTypeHelp.summaryDesc",
                  "Brief overview of the person's life and significance",
                ),
              },
            ]}
          />

          <HelpGroup
            title={t("storyChunkEditor.chunkTypeHelp.earlyYears", "Early Years")}
            items={[
              {
                value: 1,
                label: t("chunkTypes.earlyLife", "Early Life"),
                desc: t(
                  "storyChunkEditor.chunkTypeHelp.earlyLifeDesc",
                  "Birth, childhood, family background",
                ),
              },
              {
                value: 2,
                label: t("chunkTypes.education", "Education"),
                desc: t(
                  "storyChunkEditor.chunkTypeHelp.educationDesc",
                  "Schools, degrees, mentors, academic training",
                ),
              },
            ]}
          />

          <HelpGroup
            title={t("storyChunkEditor.chunkTypeHelp.mainNarrative", "Main Narrative")}
            items={[
              {
                value: 3,
                label: t("chunkTypes.lifeEvents", "Life Events"),
                desc: t(
                  "storyChunkEditor.chunkTypeHelp.lifeEventsDesc",
                  "Chronological life story from birth to present/death. Can include career, family, society - a complete timeline.",
                ),
              },
            ]}
          />

          <HelpGroup
            title={t("storyChunkEditor.chunkTypeHelp.specializedTopics", "Specialized Topics")}
            intro={t(
              "storyChunkEditor.chunkTypeHelp.specializedDesc",
              "Thematic deep dives extracted from life narrative",
            )}
            items={[
              { value: 4, key: "career", desc: "Professional history, positions, job transitions" },
              { value: 5, key: "works", desc: "Publications, creations, products, projects" },
              { value: 6, key: "achievements", desc: "Awards, honors, recognitions, milestones" },
              { value: 7, key: "philosophy", desc: "Beliefs, values, theoretical contributions" },
              { value: 8, key: "quotes", desc: "Famous sayings, memorable statements" },
            ].map((item) => keyedItem(item, t))}
          />

          <HelpGroup
            title={t("storyChunkEditor.chunkTypeHelp.personalLife", "Personal Life")}
            items={[
              { value: 9, key: "family", desc: "Spouse, children, close relatives" },
              { value: 10, key: "lifestyle", desc: "Hobbies, habits, interests, daily routines" },
              { value: 11, key: "relations", desc: "Friendships, mentorships, collaborations, rivalries" },
            ].map((item) => keyedItem(item, t))}
          />

          <HelpGroup
            title={t("storyChunkEditor.chunkTypeHelp.socialEngagement", "Social Engagement")}
            items={[
              { value: 12, key: "activities", desc: "Public service, charity, speeches, social causes" },
              { value: 13, key: "anecdotes", desc: "Interesting stories, lesser-known facts" },
              { value: 14, key: "controversies", desc: "Disputes, criticisms, scandals" },
            ].map((item) => keyedItem(item, t))}
          />

          <HelpGroup
            title={t("storyChunkEditor.chunkTypeHelp.closing", "Closing")}
            items={[
              { value: 15, key: "legacy", desc: "Historical impact, influence, commemorations" },
              { value: 16, key: "gallery", desc: "Photos, videos, audio, documents, and multimedia" },
              { value: 17, key: "references", desc: "Sources, citations, bibliography" },
              { value: 18, key: "notes", desc: "Additional remarks, corrections, clarifications" },
            ].map((item) => keyedItem(item, t))}
          />

          <section className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3 uppercase tracking-wide">
              {t("storyChunkEditor.chunkTypeHelp.usageNotes", "Usage Notes")}
            </h4>
            <ul className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
              {[
                t(
                  "storyChunkEditor.chunkTypeHelp.note1",
                  "These are content type tags, not exclusive chapters - you can have multiple chunks of the same type",
                ),
                t(
                  "storyChunkEditor.chunkTypeHelp.note2",
                  "Types are not mutually exclusive - feel free to use types in any order",
                ),
                t(
                  "storyChunkEditor.chunkTypeHelp.note3",
                  "Life Events: For chronological narrative (birth → childhood → adulthood → death)",
                ),
                t(
                  "storyChunkEditor.chunkTypeHelp.note4",
                  "Career: For focused professional history (jobs, companies, positions)",
                ),
                t(
                  "storyChunkEditor.chunkTypeHelp.note5",
                  "Early Life vs Life Events: Early Life for childhood snippets, Life Events for full timeline",
                ),
              ].map((note) => (
                <li key={note} className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type HelpItem = {
  value: number;
  label: string;
  desc: string;
};

function keyedItem(
  item: { value: number; key: string; desc: string },
  t: StoryEditorController["t"],
): HelpItem {
  return {
    value: item.value,
    label: t(`chunkTypes.${item.key}`, item.key.charAt(0).toUpperCase() + item.key.slice(1)),
    desc: t(`storyChunkEditor.chunkTypeHelp.${item.key}Desc`, item.desc),
  };
}

function HelpGroup({
  title,
  intro,
  items,
}: {
  title: string;
  intro?: string;
  items: HelpItem[];
}) {
  return (
    <section>
      <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2 uppercase tracking-wide">
        {title}
      </h4>
      {intro ? <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 italic">{intro}</p> : null}
      <div className="space-y-2">
        {items.map((item) => {
          const Icon = getChunkTypeIcon(item.value);
          return (
            <div
              key={item.value}
              className="flex items-start gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800/50"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Icon
                  size={16}
                  className={getChunkTypeColorClass(item.value) + " flex-shrink-0 mt-0.5"}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {item.label}
                  </span>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{item.desc}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
