import { useId, useMemo } from "react";
import { Check, ChevronDown, FileText, HelpCircle, Link2, Save } from "lucide-react";
import { useListboxA11y } from "../../../shared/ui/useListboxA11y";
import { groupChunkTypeOptions } from "../model/chunkTypeGroups";
import { getByteMeterRatio, getByteMeterTone } from "../model/storyEditorModel";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

const METER_TONE_CLASS: Record<string, string> = {
  normal: "bg-primary",
  warn: "bg-amber-500 dark:bg-amber-400",
  over: "bg-red-500 dark:bg-red-400",
};

/**
 * The composer sits at the end of the manuscript: writing a chunk is composing
 * into the document rather than filling in a form beside it.
 *
 * The 19 tags open as an inline panel instead of a dropdown list — grouped by
 * the same taxonomy the help dialog describes, all visible at once, and never
 * covering the primary action. It keeps listbox semantics so the keyboard model
 * is unchanged.
 */
export function StoryComposer({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  const form = editor.form;

  const chunkTypeLabelId = useId();
  const chunkTypeValueId = useId();
  const chunkTypeListboxId = useId();
  const contentByteStatusId = useId();
  const attachmentLabelId = useId();

  const selected = editor.chunkTypeOptions.find((option) => option.value === form.data.chunkType);
  const SelectedIcon = selected?.icon || FileText;
  const selectedChunkTypeIndex = editor.chunkTypeOptions.findIndex(
    (option) => option.value === form.data.chunkType,
  );

  const groups = useMemo(
    () => groupChunkTypeOptions(editor.chunkTypeOptions, t as never),
    [editor.chunkTypeOptions, t],
  );

  const {
    activeOptionId: activeChunkTypeId,
    getOptionId: getChunkTypeOptionId,
    handleButtonKeyDown: handleChunkTypeKeyDown,
    selectOption: selectChunkTypeOption,
    setActiveIndex: setActiveChunkTypeIndex,
  } = useListboxA11y({
    open: form.showChunkTypeDropdown,
    options: editor.chunkTypeOptions,
    selectedIndex: selectedChunkTypeIndex,
    listboxId: chunkTypeListboxId,
    getOptionKey: (option) => option.value,
    onOpen: () => form.setShowChunkTypeDropdown(true),
    onClose: () => form.setShowChunkTypeDropdown(false),
    onSelect: (option) => form.updateChunkType(option.value),
    disabled: editor.submitting,
  });

  const byteRatio = getByteMeterRatio(form.byteLength);
  const meterTone = getByteMeterTone(form.byteLength);

  return (
    <section
      ref={editor.refs.formRef}
      aria-label={t("storyChunkEditor.addChunk", "Add New Chunk")}
      className="overflow-hidden rounded-[20px] border border-primary bg-surface shadow-lg shadow-primary/5"
    >
      {/* One ref around the trigger and the panel: the controller closes the
          picker on any mousedown outside it, and mousedown precedes click — so
          a ref that covered only the trigger would unmount an option before its
          click could land. */}
      <div ref={editor.refs.chunkTypeDropdownRef}>
        <header className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3 sm:px-5">
          <h3 className="ui-heading text-[13.5px] text-ink">
            {t("storyChunkEditor.newChunk", "New chunk")}
          </h3>
          <span className="font-mono text-[11px] text-ink-subtle">#{editor.draftDisplayIndex}</span>
          <span className="grow" />

          <div className="flex items-center gap-1.5">
            <span id={chunkTypeLabelId} className="sr-only">
              {t("storyChunkEditor.chunkTypeLabel", "Chunk Type")}
            </span>
            <button
              type="button"
              onClick={() =>
                !editor.submitting && form.setShowChunkTypeDropdown(!form.showChunkTypeDropdown)
              }
              onKeyDown={handleChunkTypeKeyDown}
              disabled={editor.submitting}
              aria-haspopup="listbox"
              aria-expanded={form.showChunkTypeDropdown}
              aria-controls={form.showChunkTypeDropdown ? chunkTypeListboxId : undefined}
              aria-activedescendant={activeChunkTypeId}
              aria-labelledby={`${chunkTypeLabelId} ${chunkTypeValueId}`}
              className={`flex min-h-[36px] items-center gap-2 rounded-full border px-3 text-[12.5px] font-medium transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                form.showChunkTypeDropdown
                  ? "border-primary bg-primary/10 text-ink"
                  : "border-hairline bg-surface text-ink hover:border-hairline-strong"
              }`}
            >
              <SelectedIcon
                size={14}
                className={selected?.color || "text-ink-subtle"}
                aria-hidden
              />
              <span id={chunkTypeValueId} className="max-w-[10rem] truncate">
                {selected?.label || t("chunkTypes.unknown", "Unknown")}
              </span>
              <ChevronDown
                size={14}
                aria-hidden
                className={`shrink-0 text-ink-subtle transition-transform ${form.showChunkTypeDropdown ? "rotate-180" : ""}`}
              />
            </button>

            <button
              type="button"
              onClick={() => form.setShowChunkTypeHelp(true)}
              aria-label={t("storyChunkEditor.chunkTypeHelp.title", "Story Chunk Types Guide")}
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-surface-alt hover:text-ink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <HelpCircle size={15} aria-hidden />
            </button>
          </div>
        </header>

        {form.showChunkTypeDropdown && (
          <div className="border-b border-hairline bg-surface-alt px-4 py-4 sm:px-5">
            <div
              id={chunkTypeListboxId}
              role="listbox"
              aria-labelledby={chunkTypeLabelId}
              className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2"
            >
              {groups.map((group) => (
                <div
                  key={group.id}
                  role="group"
                  aria-label={group.label}
                  className="flex flex-col gap-1.5"
                >
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-ink-subtle">
                    {group.label}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {group.options.map(({ option, index }) => {
                      const Icon = option.icon;
                      const isSelected = option.value === form.data.chunkType;
                      return (
                        <button
                          key={option.value}
                          id={getChunkTypeOptionId(option, index)}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={-1}
                          onMouseEnter={() => setActiveChunkTypeIndex(index)}
                          onClick={() => selectChunkTypeOption(index)}
                          className={`flex min-h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/10 font-semibold text-ink"
                              : "border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-ink"
                          }`}
                        >
                          <Icon size={13} className={option.color} aria-hidden />
                          {option.label}
                          {isSelected && <Check size={12} aria-hidden className="text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3.5 border-t border-hairline pt-3 text-[11.5px] leading-relaxed text-ink-muted">
              {t(
                "storyChunkEditor.tagPickerHint",
                "Tags describe content, not chapters — repeat a tag as often as you like and use them in any order.",
              )}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5">
        <textarea
          ref={editor.refs.textareaRef}
          value={form.data.content}
          onChange={(event) => form.updateContent(event.target.value)}
          placeholder={t(
            "storyChunkEditor.contentPlaceholderBytes",
            "Enter story content; network gas capacity determines the record size",
          )}
          disabled={editor.submitting}
          aria-invalid={false}
          aria-describedby={contentByteStatusId}
          className="min-h-[132px] w-full resize-y rounded-2xl border-0 bg-transparent p-0 text-base leading-[1.85] text-ink placeholder:text-ink-subtle focus:ring-0 disabled:opacity-60"
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            id={attachmentLabelId}
            className="text-[10.5px] font-bold uppercase tracking-[0.11em] text-ink-subtle"
          >
            {t("storyChunkEditor.attachmentLabel", "Attachment CID (optional)")}
          </span>
          <div className="flex min-w-[16rem] grow items-center gap-2 rounded-xl border border-hairline bg-surface-alt px-3 focus-within:border-hairline-strong">
            <Link2 size={14} aria-hidden className="shrink-0 text-ink-subtle" />
            <input
              value={form.data.attachmentCID}
              onChange={(event) => form.updateAttachmentCID(event.target.value)}
              aria-labelledby={attachmentLabelId}
              placeholder={t(
                "storyChunkEditor.attachmentPlaceholder",
                "CID (e.g. bafy...) or leave empty",
              )}
              disabled={editor.submitting}
              className="min-h-[38px] w-full min-w-0 border-0 bg-transparent p-0 font-mono text-xs text-ink placeholder:text-ink-subtle focus:ring-0 disabled:opacity-60"
            />
          </div>
        </div>
      </div>

      <footer className="flex flex-col gap-3 border-t border-hairline bg-surface-alt px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <div className="flex w-full max-w-[14rem] flex-col gap-1.5">
          <div
            id={contentByteStatusId}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`text-[12px] ${editor.getByteWarningColor(form.byteLength)}`}
          >
            <span className="font-mono font-semibold">{form.byteLength} bytes</span>
            <span className="ml-1.5 text-ink-muted">
              {t("storyChunkEditor.segmentBudget", "of {{limit}} per record", {
                limit: form.segmentBytes.toLocaleString(),
              })}
            </span>
          </div>
          <div aria-hidden className="h-[5px] overflow-hidden rounded-full bg-hairline-strong/55">
            <div
              className={`h-full rounded-full transition-all ${METER_TONE_CLASS[meterTone]}`}
              style={{ width: `${Math.round(byteRatio * 100)}%` }}
            />
          </div>
        </div>

        <span className="hidden grow sm:block" />

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={form.cancel}
            disabled={editor.submitting}
            className="min-h-9 rounded-full border border-hairline bg-surface px-4 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {t("storyChunkEditor.cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={form.submit}
            disabled={editor.submitting || !form.data.content.trim()}
            className="flex min-h-9 items-center gap-2 rounded-full bg-primary px-[18px] text-[13px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Save size={15} aria-hidden />
            {editor.submitting
              ? t("storyChunkEditor.saving", "Saving...")
              : t("storyChunkEditor.reviewAndSign", "Review & sign")}
          </button>
        </div>
      </footer>
    </section>
  );
}
