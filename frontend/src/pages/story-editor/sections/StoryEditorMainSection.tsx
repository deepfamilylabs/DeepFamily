import { useId } from "react";
import {
  Check,
  ChevronDown,
  Clipboard,
  FileText,
  HelpCircle,
  Lock,
  Plus,
  Save,
  X,
} from "lucide-react";
import { useListboxA11y } from "../../../shared/ui/useListboxA11y";
import type { StoryEditorController } from "../hooks/useStoryEditorController";

export function StoryEditorMainSection({ editor }: { editor: StoryEditorController }) {
  const { t } = editor;
  const form = editor.form;
  const selected = editor.chunkTypeOptions.find((option) => option.value === form.data.chunkType);
  const SelectedIcon = selected?.icon || FileText;
  const chunkTypeLabelId = useId();
  const chunkTypeValueId = useId();
  const chunkTypeListboxId = useId();
  const selectedChunkTypeIndex = editor.chunkTypeOptions.findIndex(
    (option) => option.value === form.data.chunkType,
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

  return (
    <section className="xl:col-span-2 flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4 pb-2">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400">
              {editor.titleText}
            </span>
            {editor.isSealed && <Lock className="text-orange-500" size={24} />}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {editor.meta?.isSealed && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-900/30">
              <Lock size={10} />
              {t("person.sealed", "Sealed")}
            </div>
          )}
          {!editor.isSealed && editor.meta && editor.meta.totalChunks > 0 && (
            <button
              onClick={editor.seal.handleSeal}
              disabled={editor.submitting}
              className="group flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-gray-200/50 transition-all hover:scale-105 hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:shadow-none"
              type="button"
            >
              <Lock size={14} className="transition-transform group-hover:rotate-12" />
              {t("storyChunkEditor.seal", "Seal Story")}
            </button>
          )}
        </div>
      </header>

      <div ref={editor.refs.scrollContainerRef} className="flex flex-col gap-6">
        {editor.showError && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
            <p className="mb-1 font-bold text-red-800 dark:text-red-300">
              {t("common.error", "Error")}
            </p>
            <p>{editor.errorMessage}</p>
          </section>
        )}

        {editor.showEditorForm && (
          <section
            ref={editor.refs.formRef}
            className="relative flex flex-col gap-6 rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-200/50 dark:border-gray-800 dark:bg-gray-900 dark:shadow-none sm:p-8"
          >
            <header className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100/50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                  <Plus size={18} />
                </span>
                {t("storyChunkEditor.addChunk", "Add New Chunk")}
              </h3>
              <button
                onClick={form.cancel}
                disabled={editor.submitting}
                className="rounded-full p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 hover:rotate-90 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                aria-label={t("common.close", "Close") as string}
                type="button"
              >
                <X size={20} />
              </button>
            </header>

            <div className="space-y-4">
              <textarea
                ref={editor.refs.textareaRef}
                value={form.data.content}
                onChange={(event) => form.updateContent(event.target.value)}
                placeholder={t(
                  "storyChunkEditor.contentPlaceholderBytes",
                  "Enter chunk content (max 2048 bytes, approximately 2048 English characters or ~680 Chinese characters)",
                )}
                className="h-[500px] w-full resize-none rounded-2xl border-0 bg-gray-50 p-6 text-base leading-relaxed text-gray-900 transition-all placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-orange-500/20 active:ring-orange-500/20 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-800"
                disabled={editor.submitting}
              />

              <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5 mb-2">
                    <label
                      id={chunkTypeLabelId}
                      className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                    >
                      {t("storyChunkEditor.chunkTypeLabel", "Chunk Type")}
                    </label>
                    <button
                      type="button"
                      onClick={() => form.setShowChunkTypeHelp(true)}
                      className="text-gray-400 hover:text-orange-600 dark:text-gray-500 dark:hover:text-orange-400 transition-colors"
                      aria-label="Help"
                    >
                      <HelpCircle size={14} />
                    </button>
                  </div>
                  <div ref={editor.refs.chunkTypeDropdownRef} className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        !editor.submitting &&
                        form.setShowChunkTypeDropdown(!form.showChunkTypeDropdown)
                      }
                      onKeyDown={handleChunkTypeKeyDown}
                      disabled={editor.submitting}
                      className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition-all hover:border-gray-300 hover:bg-gray-50 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-600"
                      aria-haspopup="listbox"
                      aria-expanded={form.showChunkTypeDropdown}
                      aria-controls={form.showChunkTypeDropdown ? chunkTypeListboxId : undefined}
                      aria-activedescendant={activeChunkTypeId}
                      aria-labelledby={`${chunkTypeLabelId} ${chunkTypeValueId}`}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <SelectedIcon size={16} className={selected?.color || "text-gray-400"} />
                        <span id={chunkTypeValueId} className="truncate">
                          {selected?.label || "Select type"}
                        </span>
                      </div>
                      <ChevronDown
                        size={16}
                        className={`flex-shrink-0 text-gray-400 transition-transform ${form.showChunkTypeDropdown ? "rotate-180" : ""}`}
                      />
                    </button>

                    {form.showChunkTypeDropdown && (
                      <div className="absolute z-50 mt-2 w-full rounded-xl border border-gray-100 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                        <div
                          id={chunkTypeListboxId}
                          role="listbox"
                          aria-labelledby={chunkTypeLabelId}
                          className="max-h-60 overflow-y-auto py-2"
                        >
                          {editor.chunkTypeOptions.map((option, optionIndex) => {
                            const Icon = option.icon;
                            const isSelected = option.value === form.data.chunkType;
                            return (
                              <button
                                key={option.value}
                                id={getChunkTypeOptionId(option, optionIndex)}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                tabIndex={-1}
                                onMouseEnter={() => setActiveChunkTypeIndex(optionIndex)}
                                onClick={() => selectChunkTypeOption(optionIndex)}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                                  isSelected
                                    ? "bg-orange-50 text-orange-900 dark:bg-orange-900/20 dark:text-orange-100"
                                    : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                                }`}
                              >
                                <Icon size={16} className={option.color} />
                                <span className="flex-1 truncate font-medium">{option.label}</span>
                                {isSelected && (
                                  <Check
                                    size={16}
                                    className="flex-shrink-0 text-orange-600 dark:text-orange-400"
                                  />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col sm:min-w-0">
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                    {t("storyChunkEditor.attachmentLabel", "Attachment CID (optional)")}
                  </label>
                  <input
                    value={form.data.attachmentCID}
                    onChange={(event) => form.updateAttachmentCID(event.target.value)}
                    placeholder={t(
                      "storyChunkEditor.attachmentPlaceholder",
                      "CID (e.g. bafy...) or leave empty",
                    )}
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 transition-all hover:border-gray-300 hover:bg-gray-50 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-600"
                    disabled={editor.submitting}
                  />
                </div>
              </div>

              <div className="flex flex-col justify-between gap-3 text-sm sm:flex-row sm:items-center pt-2">
                <div className={`font-medium ${editor.getByteWarningColor(form.byteLength)}`}>
                  {form.byteLength}/{form.maxBytes} bytes
                  {form.byteLength > form.warningOrangeBytes && form.byteLength <= form.maxBytes && (
                    <span className="ml-2 text-xs">
                      ({form.maxBytes - form.byteLength} remaining)
                    </span>
                  )}
                  {form.byteLength > form.maxBytes && (
                    <span className="ml-2 text-xs">
                      ({form.byteLength - form.maxBytes} over limit!)
                    </span>
                  )}
                </div>

                {form.data.expectedHash && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {t("storyChunkEditor.hashLabel", "Hash")}:
                    </span>
                    <code className="rounded-lg bg-gray-100 px-2 py-1 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {editor.formatHash(form.data.expectedHash)}
                    </code>
                    <button
                      type="button"
                      onClick={() => editor.copyText(form.data.expectedHash || "")}
                      className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                      aria-label={t("search.copy", "Copy") as string}
                    >
                      <Clipboard size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <footer className="flex flex-col gap-3 pt-2 sm:flex-row">
              <button
                onClick={form.submit}
                disabled={
                  editor.submitting ||
                  !form.data.content.trim() ||
                  form.byteLength > form.maxBytes
                }
                className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-400 to-red-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all hover:scale-[1.02] hover:shadow-orange-500/50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:grayscale"
                type="button"
              >
                <Save size={16} />
                {editor.submitting
                  ? t("storyChunkEditor.saving", "Saving...")
                  : t("storyChunkEditor.save", "Save Chunk")}
              </button>
              <button
                onClick={form.cancel}
                disabled={editor.submitting}
                className="rounded-full border border-gray-200 bg-white px-6 py-3 text-sm font-bold text-gray-700 transition-all hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                type="button"
              >
                {t("storyChunkEditor.cancel", "Cancel")}
              </button>
            </footer>
          </section>
        )}

        {editor.loading && (
          <section className="flex flex-col items-center justify-center gap-4 py-12 text-gray-500 dark:text-gray-400">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 dark:border-blue-800 dark:border-t-blue-400" />
            <p className="text-sm font-medium">{t("storyChunkEditor.loading", "Loading...")}</p>
          </section>
        )}

        {editor.showEmptySealed && (
          <section className="py-12 text-center text-gray-500 dark:text-gray-400">
            <Lock size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-sm font-medium">
              {t("storyChunkEditor.noChunksSealed", "This story is sealed with no chunks.")}
            </p>
          </section>
        )}
      </div>
    </section>
  );
}
