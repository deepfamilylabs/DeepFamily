import { useCallback, useId } from "react";
import { HelpCircle, Lock, X } from "lucide-react";
import { getChunkTypeColorClass, getChunkTypeIcon } from "../../../domains/person";
import {
  MODAL_ACCENT_TILE,
  MODAL_CLOSE_BUTTON,
  MODAL_HEADER,
  MODAL_PANEL,
  MODAL_TITLE,
  MODAL_TILE_BASE,
  ModalShell,
  OVERLAY_Z_INDEX,
} from "../../../shared/ui";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

import { ArchiveTransactionDetails } from "../../../domains/transactions";

export function StoryTransactionPreviewDialog({ editor }: { editor: StoryEditorController }) {
  const titleId = useId();
  const close = useCallback(() => editor.resolveTransactionPreview(false), [editor]);
  return (
    <ModalShell
      isOpen={Boolean(editor.transactionPreview)}
      onClose={close}
      bare
      ariaLabelledBy={titleId}
      zIndex={OVERLAY_Z_INDEX.confirmDialog}
    >
      <div className="h-full flex items-center justify-center p-4">
        <div
          onClick={(event) => event.stopPropagation()}
          className={`w-full max-w-xl max-h-[85vh] overflow-auto p-5 space-y-4 ${MODAL_PANEL}`}
        >
          <h2 id={titleId} className={MODAL_TITLE}>
            {editor.t("archive.reviewStory", "Review story transaction")}
          </h2>
          {editor.transactionPreview && (
            <ArchiveTransactionDetails preview={editor.transactionPreview} />
          )}
          <div className="flex gap-4">
            <button
              className="flex-1 h-10 rounded-lg border border-hairline-strong text-sm font-semibold hover:bg-surface-alt focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              type="button"
              onClick={close}
            >
              {editor.t("common.cancel", "Cancel")}
            </button>
            <button
              className="flex-1 h-10 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              type="button"
              onClick={() => editor.resolveTransactionPreview(true)}
            >
              {editor.t("archive.confirm", "Continue to wallet")}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export function SealConfirmDialog({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  const titleId = useId();
  const descriptionId = useId();
  const { setShowConfirm, showConfirm } = editor.seal;
  const closeDialog = useCallback(() => setShowConfirm(false), [setShowConfirm]);

  return (
    <ModalShell
      isOpen={showConfirm}
      onClose={closeDialog}
      bare
      zIndex={OVERLAY_Z_INDEX.confirmDialog}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      disableBackdropClose
    >
      <div className="h-full flex items-center justify-center p-4" data-seal-dialog>
        <div
          className={`relative w-[420px] max-w-[95vw] overflow-hidden ${MODAL_PANEL}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex gap-3.5 p-5">
            <div className={`${MODAL_TILE_BASE} ${MODAL_ACCENT_TILE.danger}`}>
              <Lock size={19} aria-hidden />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <h3 id={titleId} className="modal-heading font-body text-base font-semibold text-ink">
                {t("storyChunkEditor.sealDialog.title", "Seal Story")}
              </h3>
              <p id={descriptionId} className="text-sm text-ink-muted leading-relaxed">
                {t(
                  "storyChunkEditor.sealDialog.description",
                  "Are you sure you want to seal the story? Once sealed, it cannot be modified.",
                )}
              </p>
            </div>
          </div>

          <div className="flex gap-2.5 px-5 py-3.5 border-t border-hairline bg-surface-body">
            <button
              type="button"
              onClick={closeDialog}
              disabled={editor.submitting}
              className="flex-1 h-10 rounded-lg border border-hairline-strong bg-surface text-ink text-sm font-semibold transition-colors hover:bg-surface-alt disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            >
              {t("storyChunkEditor.sealDialog.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={editor.seal.execute}
              disabled={editor.submitting}
              className="flex-1 h-10 rounded-lg bg-danger text-white dark:text-red-950 text-sm font-semibold transition-colors hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 focus:outline-hidden focus:ring-2 focus:ring-danger/40"
            >
              {editor.submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                  <span>{t("storyChunkEditor.saving", "Saving...")}</span>
                </>
              ) : (
                <>
                  <Lock size={15} aria-hidden />
                  <span>{t("storyChunkEditor.sealDialog.confirm", "Confirm Seal")}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export function ChunkTypeHelpDialog({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  const titleId = useId();
  const descriptionId = useId();
  const { setShowChunkTypeHelp, showChunkTypeHelp } = editor.form;
  const closeDialog = useCallback(() => setShowChunkTypeHelp(false), [setShowChunkTypeHelp]);

  return (
    <ModalShell
      isOpen={showChunkTypeHelp}
      onClose={closeDialog}
      bare
      zIndex={OVERLAY_Z_INDEX.confirmDialog}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
    >
      <div className="h-full flex items-center justify-center p-4" data-chunk-help-dialog>
        <div
          className={`w-full max-w-3xl max-h-[75vh] overflow-hidden flex flex-col ${MODAL_PANEL}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={MODAL_HEADER}>
            <div className={`${MODAL_TILE_BASE} ${MODAL_ACCENT_TILE.blue}`}>
              <HelpCircle size={18} aria-hidden />
            </div>
            <h2 id={titleId} className={`flex-1 min-w-0 ${MODAL_TITLE}`}>
              {t("storyChunkEditor.chunkTypeHelp.title", "Story Chunk Types Guide")}
            </h2>
            <button
              onClick={closeDialog}
              className={MODAL_CLOSE_BUTTON}
              aria-label="Close"
              type="button"
            >
              <X size={17} />
            </button>
          </div>

          <div className="overflow-y-auto bg-surface-body p-6 space-y-7">
            <div className="prose dark:prose-invert max-w-none">
              <p id={descriptionId} className="text-sm text-ink-muted leading-relaxed">
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
                  value: 1,
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
                  value: 2,
                  label: t("chunkTypes.earlyLife", "Early Life"),
                  desc: t(
                    "storyChunkEditor.chunkTypeHelp.earlyLifeDesc",
                    "Birth, childhood, family background",
                  ),
                },
                {
                  value: 3,
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
                  value: 4,
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
                {
                  value: 5,
                  key: "career",
                  desc: "Professional history, positions, job transitions",
                },
                { value: 6, key: "works", desc: "Publications, creations, products, projects" },
                { value: 7, key: "achievements", desc: "Awards, honors, recognitions, milestones" },
                { value: 8, key: "philosophy", desc: "Beliefs, values, theoretical contributions" },
                { value: 9, key: "quotes", desc: "Famous sayings, memorable statements" },
              ].map((item) => keyedItem(item, t))}
            />

            <HelpGroup
              title={t("storyChunkEditor.chunkTypeHelp.personalLife", "Personal Life")}
              items={[
                { value: 10, key: "family", desc: "Spouse, children, close relatives" },
                { value: 11, key: "lifestyle", desc: "Hobbies, habits, interests, daily routines" },
                {
                  value: 12,
                  key: "relations",
                  desc: "Friendships, mentorships, collaborations, rivalries",
                },
              ].map((item) => keyedItem(item, t))}
            />

            <HelpGroup
              title={t("storyChunkEditor.chunkTypeHelp.socialEngagement", "Social Engagement")}
              items={[
                {
                  value: 13,
                  key: "activities",
                  desc: "Public service, charity, speeches, social causes",
                },
                { value: 14, key: "anecdotes", desc: "Interesting stories, lesser-known facts" },
                { value: 15, key: "controversies", desc: "Disputes, criticisms, scandals" },
              ].map((item) => keyedItem(item, t))}
            />

            <HelpGroup
              title={t("storyChunkEditor.chunkTypeHelp.closing", "Closing")}
              items={[
                { value: 16, key: "legacy", desc: "Historical impact, influence, commemorations" },
                {
                  value: 17,
                  key: "gallery",
                  desc: "Photos, videos, audio, documents, and multimedia",
                },
                { value: 18, key: "references", desc: "Sources, citations, bibliography" },
                {
                  value: 19,
                  key: "notes",
                  desc: "Additional remarks, corrections, clarifications",
                },
              ].map((item) => keyedItem(item, t))}
            />

            <section className="border-t border-hairline pt-4">
              <h4 className="text-sm font-bold text-ink mb-3 uppercase tracking-wide">
                {t("storyChunkEditor.chunkTypeHelp.usageNotes", "Usage Notes")}
              </h4>
              <ul className="space-y-2 text-xs text-ink-muted">
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
                    <span className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </ModalShell>
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

function HelpGroup({ title, intro, items }: { title: string; intro?: string; items: HelpItem[] }) {
  return (
    <section>
      <h4 className="text-sm font-bold text-ink mb-2 uppercase tracking-wide">{title}</h4>
      {intro ? <p className="text-xs text-ink-muted mb-2 italic">{intro}</p> : null}
      <div className="space-y-2">
        {items.map((item) => {
          const Icon = getChunkTypeIcon(item.value);
          return (
            <div
              key={item.value}
              className="flex items-start gap-2 p-2 rounded-sm bg-surface-alt/50"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Icon
                  size={16}
                  className={getChunkTypeColorClass(item.value) + " shrink-0 mt-0.5"}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-ink">{item.label}</span>
                  <p className="text-xs text-ink-muted mt-0.5">{item.desc}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
