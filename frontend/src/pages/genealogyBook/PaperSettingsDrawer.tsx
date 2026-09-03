import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { TFunction } from "i18next";
import {
  getPaperBorderStyleVars,
  getPaperColorThemeSwatch,
  PAPER_BACK_COVER_MODES,
  PAPER_BORDER_STYLE_IDS,
  PAPER_COLOR_THEME_IDS,
  PAPER_COVER_STYLE_IDS,
  PAPER_EXPORT_MARGIN_MAX,
  PAPER_EXPORT_MARGIN_MIN,
  PAPER_EXPORT_MARGIN_STEP,
  PAPER_FONT_PRESET_IDS,
  PAPER_FONT_SCALE_MAX,
  PAPER_FONT_SCALE_MIN,
  PAPER_FONT_SCALE_STEP,
  PAPER_TEXTURE_IDS,
  type PaperAppearance,
  type PaperBackCoverMode,
  type PaperBorderStyleId,
  type PaperColorThemeId,
  type PaperCoverStyleId,
  type PaperFontPresetId,
  type PaperTextureId,
} from "../../domains/tree";

const PAPER_SETTINGS_TABS = ["book", "cover", "paper", "typesetting"] as const;
export type PaperSettingsTab = (typeof PAPER_SETTINGS_TABS)[number];

// Which panel each tab shows. The panel test ids are the ones the old accordions carried, so a
// panel is still addressed by the same name now that it is reached by a tab instead of a summary.
const TAB_PANEL_TEST_ID: Record<PaperSettingsTab, string> = {
  book: "paper-info-settings",
  cover: "paper-cover-settings",
  paper: "paper-appearance-settings",
  typesetting: "paper-typesetting-settings",
};

const fieldInputClassName =
  "h-9 w-full rounded-md border border-stone-300 bg-white px-2.5 text-sm text-slate-900 shadow-xs transition-colors placeholder:text-stone-400 hover:border-orange-300 focus:border-orange-500 focus:outline-hidden focus:ring-2 focus:ring-orange-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-orange-700 dark:focus:border-orange-400 dark:focus:ring-orange-400/30";
const segmentGroupClassName =
  "inline-flex w-full items-center gap-1 rounded-md border border-stone-200 bg-stone-100 p-1 dark:border-slate-700 dark:bg-slate-900";
const segmentButtonClassName = (selected: boolean) =>
  `h-7 min-w-0 flex-1 rounded px-1 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-orange-500/40 ${
    selected
      ? "bg-white text-orange-700 shadow-xs ring-1 ring-orange-500/20 dark:bg-slate-700 dark:text-orange-200 dark:ring-orange-400/20"
      : "text-stone-600 hover:bg-white/70 hover:text-orange-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-orange-200"
  }`;
const optionCardStateClassName = (selected: boolean) =>
  selected
    ? "border-orange-400 bg-orange-50/70 text-orange-800 ring-1 ring-orange-500/20 dark:border-orange-600 dark:bg-orange-950/30 dark:text-orange-200 dark:ring-orange-400/20"
    : "border-stone-200 bg-white text-stone-600 hover:border-orange-300 hover:bg-orange-50/50 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-orange-800 dark:hover:bg-orange-950/10 dark:hover:text-orange-200";
const rangeInputClassName =
  "w-full cursor-pointer accent-orange-500 transition-opacity hover:accent-orange-600 hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-orange-500/30 dark:accent-orange-400 dark:hover:accent-orange-300";
const groupLabelClassName = "text-xs font-medium text-slate-600 dark:text-slate-300";
const hintClassName = "text-[11px] leading-snug text-stone-500 dark:text-slate-400";

function CoverStyleThumbnail({ styleId }: { styleId: PaperCoverStyleId }) {
  const verticalText = (
    <span className="absolute left-1/2 top-1/2 h-7 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
  );

  return (
    <span
      className="relative block h-14 w-10 overflow-hidden rounded-[2px] border border-current/50 bg-[#f4eddd] shadow-xs dark:bg-slate-800"
      aria-hidden="true"
      data-testid={`paper-cover-style-thumbnail-${styleId}`}
    >
      {styleId === "traditional-slip" ? (
        <span className="absolute bottom-1.5 right-1.5 top-1.5 w-3 border border-current/70 bg-white/55">
          {verticalText}
        </span>
      ) : null}
      {styleId === "centered-classic" ? (
        <>
          {verticalText}
          <span className="absolute right-1.5 top-1.5 h-2.5 w-1.5 border border-current/60" />
          <span className="absolute bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 bg-current/70" />
        </>
      ) : null}
      {styleId === "minimal-thread" ? (
        <>
          <span className="absolute bottom-2 right-2 top-2 w-2.5 border border-current/60 bg-white/45">
            {verticalText}
          </span>
          <span className="absolute bottom-0 left-1 top-0 border-l border-dashed border-current/60" />
          <span className="absolute left-0.5 top-3 h-1 w-1 rounded-full bg-current/70" />
          <span className="absolute bottom-3 left-0.5 h-1 w-1 rounded-full bg-current/70" />
        </>
      ) : null}
      {styleId === "archive-frame" ? (
        <span className="absolute inset-1.5 border-2 border-current/70 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.45)]">
          {verticalText}
        </span>
      ) : null}
    </span>
  );
}

function SettingsSwitch({
  checked,
  onChange,
  ariaLabel,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  testId: string;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel}
        className="peer sr-only"
        data-testid={testId}
      />
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-orange-500/40 peer-focus-visible:ring-offset-2 peer-disabled:cursor-not-allowed ${
          checked ? "bg-orange-500" : "bg-stone-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </span>
  );
}

export interface PaperSettingsDrawerProps {
  t: TFunction;
  open: boolean;
  onClose: () => void;
  appearance: PaperAppearance;
  updateAppearance: (patch: Partial<PaperAppearance>) => void;
  spineTitleValue: string;
  spineTitlePlaceholder: string;
  onSpineTitleChange: (value: string) => void;
  spineTitleDisabled: boolean;
  hallNameValue: string;
  hallNamePlaceholder: string;
  canReset: boolean;
  onReset: () => void;
  colorThemeLabels: Record<PaperColorThemeId, string>;
  fontPresetLabels: Record<PaperFontPresetId, string>;
  textureLabels: Record<PaperTextureId, string>;
  borderStyleLabels: Record<PaperBorderStyleId, string>;
  coverStyleLabels: Record<PaperCoverStyleId, string>;
  backCoverModeLabels: Record<PaperBackCoverMode, string>;
}

/**
 * 纸谱设置, as a slide-over rather than a permanently docked column.
 *
 * Two changes over the old aside. It no longer holds 256px of the stage for good — what it contains
 * (colour, font, page margin) is set once and then left alone, while the book is what the page is
 * for; and its four stacked <details> became four tabs, because at 256px wide they ran to well over
 * a screen of scrolling to reach the last group. There is deliberately no scrim: the point of these
 * controls is watching the sheet change, so the book stays visible and simply re-fits beside it.
 */
export function PaperSettingsDrawer({
  t,
  open,
  onClose,
  appearance,
  updateAppearance,
  spineTitleValue,
  spineTitlePlaceholder,
  onSpineTitleChange,
  spineTitleDisabled,
  hallNameValue,
  hallNamePlaceholder,
  canReset,
  onReset,
  colorThemeLabels,
  fontPresetLabels,
  textureLabels,
  borderStyleLabels,
  coverStyleLabels,
  backCoverModeLabels,
}: PaperSettingsDrawerProps) {
  const [tab, setTab] = useState<PaperSettingsTab>("book");
  if (!open) return null;

  const tabLabels: Record<PaperSettingsTab, string> = {
    book: t("genealogyBook.settings.tabs.book", "Book"),
    cover: t("genealogyBook.settings.tabs.cover", "Cover"),
    paper: t("genealogyBook.settings.tabs.paper", "Paper"),
    typesetting: t("genealogyBook.settings.tabs.typesetting", "Layout"),
  };

  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 flex w-[86vw] max-w-[340px] flex-col border-l border-hairline bg-surface shadow-[-18px_0_40px_-24px_rgba(15,23,42,.3)] lg:relative lg:inset-auto lg:w-[340px] lg:max-w-none lg:shrink-0"
      aria-label={t("genealogyBook.settings.title", "Paper book settings")}
      data-testid="paper-settings-drawer"
    >
      <div className="flex h-13 shrink-0 items-center justify-between gap-2.5 border-b border-hairline px-4 py-3">
        <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          <SlidersHorizontal className="h-[15px] w-[15px] shrink-0 text-ink-muted" />
          <span className="truncate">
            {t("genealogyBook.settings.title", "Paper book settings")}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onReset}
            disabled={!canReset}
            className="text-xs font-medium text-ink-muted transition-colors hover:text-orange-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-orange-200"
            title={t("genealogyBook.settings.resetDefault", "Reset defaults")}
            data-testid="paper-reset-display-settings"
          >
            {t("genealogyBook.settings.resetDefault", "Reset defaults")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close", "Close")}
            title={t("common.close", "Close")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            data-testid="paper-settings-close"
          >
            <X className="h-4 w-4" />
          </button>
        </span>
      </div>

      <div className="shrink-0 px-3.5 pt-3">
        <div
          className="flex gap-0.5 rounded-lg border border-hairline bg-surface-muted p-[3px]"
          role="tablist"
          aria-label={t("genealogyBook.settings.title", "Paper book settings")}
        >
          {PAPER_SETTINGS_TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`h-[30px] min-w-0 flex-1 rounded-md text-[12.5px] transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 ${
                tab === id
                  ? "bg-surface font-semibold text-orange-700 shadow-xs dark:text-orange-200"
                  : "font-medium text-ink-muted hover:text-ink"
              }`}
              data-testid={`paper-settings-tab-${id}`}
            >
              {tabLabels[id]}
            </button>
          ))}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4"
        role="tabpanel"
        data-testid={TAB_PANEL_TEST_ID[tab]}
      >
        {tab === "book" ? (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className={groupLabelClassName}>
                {t("genealogyBook.settings.spineTitleLabel", "Genealogy title")}
              </span>
              <input
                type="text"
                value={spineTitleValue}
                onChange={(event) => onSpineTitleChange(event.target.value)}
                disabled={spineTitleDisabled}
                placeholder={spineTitlePlaceholder}
                aria-label={t("genealogyBook.settings.spineTitleLabel", "Genealogy title")}
                className={fieldInputClassName}
                data-testid="paper-spine-title-input"
              />
              <span className={hintClassName}>
                {t(
                  "genealogyBook.settings.spineTitleHint",
                  "Leave blank to use the auto-generated title",
                )}
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={groupLabelClassName}>
                {t("genealogyBook.settings.hallNameLabel", "Hall name")}
              </span>
              <input
                type="text"
                value={hallNameValue}
                onChange={(event) => updateAppearance({ hallName: event.target.value })}
                placeholder={hallNamePlaceholder}
                aria-label={t("genealogyBook.settings.hallNameLabel", "Hall name")}
                className={fieldInputClassName}
                data-testid="paper-hall-name-input"
              />
              <span className={hintClassName}>
                {t(
                  "genealogyBook.settings.hallNameHint",
                  "Leave blank to use the default hall name",
                )}
              </span>
            </label>
          </div>
        ) : null}

        {tab === "cover" ? (
          <div className="flex flex-col">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/70">
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {t("genealogyBook.settings.coverEnabledLabel", "Enable front & back cover")}
                </span>
                <span className={`mt-0.5 block ${hintClassName}`}>
                  {t(
                    "genealogyBook.settings.coverEnabledHint",
                    "When disabled, the book starts directly with its contents",
                  )}
                </span>
              </span>
              <SettingsSwitch
                checked={appearance.coverEnabled}
                onChange={(checked) => updateAppearance({ coverEnabled: checked })}
                ariaLabel={t(
                  "genealogyBook.settings.coverEnabledLabel",
                  "Enable front & back cover",
                )}
                testId="paper-cover-enabled-input"
              />
            </label>

            {/* Every cover/back-cover control lives inside one disabled fieldset so the whole group
            dims and locks together when the cover page is turned off. */}
            <fieldset
              className="mt-3 flex flex-col gap-3 transition-opacity disabled:opacity-45"
              disabled={!appearance.coverEnabled}
              aria-label={t("genealogyBook.settings.coverSectionLabel", "Front & back cover")}
            >
              <section
                className="rounded-lg border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/45"
                data-testid="paper-front-cover-settings"
              >
                <h4 className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {t("genealogyBook.settings.frontCoverSectionLabel", "Front cover")}
                </h4>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-stone-500 dark:text-slate-400">
                    {t("genealogyBook.settings.coverStyleLabel", "Layout")}
                  </span>
                  <div
                    className="grid grid-cols-2 gap-2"
                    role="group"
                    aria-label={t("genealogyBook.settings.coverStyleLabel", "Layout")}
                  >
                    {PAPER_COVER_STYLE_IDS.map((id) => {
                      const selected = appearance.coverStyleId === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => updateAppearance({ coverStyleId: id })}
                          className={`flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-md border p-2 text-center text-[11px] font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-orange-500/40 ${optionCardStateClassName(selected)}`}
                          aria-pressed={selected}
                          data-testid={`paper-cover-style-${id}`}
                        >
                          <CoverStyleThumbnail styleId={id} />
                          <span className="leading-tight">{coverStyleLabels[id]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-1.5 border-t border-stone-100 pt-3 dark:border-slate-800">
                  <label
                    htmlFor="paper-cover-inscription-input"
                    className="text-[11px] font-medium text-stone-500 dark:text-slate-400"
                  >
                    {t("genealogyBook.settings.coverInscriptionLabel", "Cover inscription")}
                  </label>
                  <input
                    id="paper-cover-inscription-input"
                    type="text"
                    value={appearance.coverInscription ?? ""}
                    onChange={(event) => updateAppearance({ coverInscription: event.target.value })}
                    placeholder={t(
                      "genealogyBook.settings.coverInscriptionPlaceholder",
                      "For example: Revised in spring 2024",
                    )}
                    className={fieldInputClassName}
                    data-testid="paper-cover-inscription-input"
                  />
                  <span className={hintClassName}>
                    {t(
                      "genealogyBook.settings.coverInscriptionHint",
                      "Optional; use for a revision date or short inscription",
                    )}
                  </span>
                </div>
              </section>

              <section
                className="rounded-lg border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/45"
                data-testid="paper-spine-settings"
              >
                <h4 className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {t("genealogyBook.settings.spineSectionLabel", "Spine")}
                </h4>
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span className={groupLabelClassName}>
                    {t("genealogyBook.settings.coverSpineLabel", "Show title and hall name")}
                  </span>
                  <SettingsSwitch
                    checked={appearance.showCoverSpine}
                    onChange={(checked) => updateAppearance({ showCoverSpine: checked })}
                    ariaLabel={t(
                      "genealogyBook.settings.coverSpineLabel",
                      "Show title and hall name",
                    )}
                    testId="paper-cover-spine-input"
                  />
                </label>
              </section>

              <section
                className="rounded-lg border border-stone-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/45"
                data-testid="paper-back-cover-settings"
              >
                <h4 className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {t("genealogyBook.settings.backCoverSectionLabel", "Back cover")}
                </h4>
                <div className={segmentGroupClassName} role="group">
                  {PAPER_BACK_COVER_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => updateAppearance({ backCoverMode: mode })}
                      className={segmentButtonClassName(appearance.backCoverMode === mode)}
                      aria-pressed={appearance.backCoverMode === mode}
                      data-testid={`paper-back-cover-mode-${mode}`}
                    >
                      {backCoverModeLabels[mode]}
                    </button>
                  ))}
                </div>
                {appearance.backCoverMode === "matched" ? (
                  <span className={`mt-1.5 block ${hintClassName}`}>
                    {t(
                      "genealogyBook.settings.backCoverMatchedHint",
                      "The print year and volume count are generated automatically",
                    )}
                  </span>
                ) : null}
              </section>
            </fieldset>
          </div>
        ) : null}

        {tab === "paper" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className={groupLabelClassName}>
                {t("genealogyBook.settings.colorThemeLabel", "Color theme")}
              </span>
              <span className={hintClassName}>
                {t("genealogyBook.settings.livePreviewHint", "Changes show on the sheet at once")}
              </span>
              <div
                className="mt-0.5 grid grid-cols-2 gap-2"
                role="group"
                aria-label={t("genealogyBook.settings.colorThemeLabel", "Color theme")}
              >
                {PAPER_COLOR_THEME_IDS.map((id) => {
                  const [sheet, line, accent] = getPaperColorThemeSwatch(id);
                  const selected = appearance.colorThemeId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => updateAppearance({ colorThemeId: id })}
                      aria-pressed={selected}
                      title={colorThemeLabels[id]}
                      className={`group/option flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-orange-500/40 ${optionCardStateClassName(selected)}`}
                      data-testid={`paper-color-theme-${id}`}
                    >
                      <span
                        className="flex h-5 w-5 shrink-0 overflow-hidden rounded-xs border border-black/10"
                        aria-hidden="true"
                      >
                        <span className="h-full w-1/3" style={{ backgroundColor: sheet }} />
                        <span className="h-full w-1/3" style={{ backgroundColor: line }} />
                        <span className="h-full w-1/3" style={{ backgroundColor: accent }} />
                      </span>
                      <span
                        className={`min-w-0 truncate text-xs transition-colors ${
                          selected
                            ? "text-orange-800 dark:text-orange-200"
                            : "text-slate-700 group-hover/option:text-orange-700 dark:text-slate-200 dark:group-hover/option:text-orange-200"
                        }`}
                      >
                        {colorThemeLabels[id]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={groupLabelClassName}>
                {t("genealogyBook.settings.textureLabel", "Paper texture")}
              </span>
              <div
                className={segmentGroupClassName}
                role="group"
                aria-label={t("genealogyBook.settings.textureLabel", "Paper texture")}
              >
                {PAPER_TEXTURE_IDS.map((id) => {
                  const selected = appearance.textureId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => updateAppearance({ textureId: id })}
                      aria-pressed={selected}
                      title={textureLabels[id]}
                      className={segmentButtonClassName(selected)}
                      data-testid={`paper-texture-${id}`}
                    >
                      {textureLabels[id]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={groupLabelClassName}>
                {t("genealogyBook.settings.borderStyleLabel", "Page border")}
              </span>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label={t("genealogyBook.settings.borderStyleLabel", "Page border")}
              >
                {PAPER_BORDER_STYLE_IDS.map((id) => {
                  const vars = getPaperBorderStyleVars(id);
                  const selected = appearance.borderStyleId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => updateAppearance({ borderStyleId: id })}
                      aria-pressed={selected}
                      title={borderStyleLabels[id]}
                      className={`group/option flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-orange-500/40 ${optionCardStateClassName(selected)}`}
                      data-testid={`paper-border-style-${id}`}
                    >
                      <span
                        className={`relative block h-5 w-6 shrink-0 transition-colors ${
                          selected
                            ? "text-orange-700 dark:text-orange-200"
                            : "text-stone-500 group-hover/option:text-orange-700 dark:text-slate-300 dark:group-hover/option:text-orange-200"
                        }`}
                        style={{
                          borderStyle: "solid",
                          borderColor: "currentColor",
                          borderWidth: vars["--df-paper-frame-outer"],
                        }}
                        aria-hidden="true"
                      >
                        <span
                          className="absolute"
                          style={{
                            top: vars["--df-paper-frame-pad-tb"],
                            bottom: vars["--df-paper-frame-pad-tb"],
                            left: vars["--df-paper-frame-pad-lr"],
                            right: vars["--df-paper-frame-pad-lr"],
                            borderStyle: "solid",
                            borderColor: "currentColor",
                            borderTopWidth: vars["--df-paper-frame-inner-tb"],
                            borderBottomWidth: vars["--df-paper-frame-inner-tb"],
                            borderLeftWidth: vars["--df-paper-frame-inner-lr"],
                            borderRightWidth: vars["--df-paper-frame-inner-lr"],
                          }}
                        />
                      </span>
                      <span
                        className={`min-w-0 truncate text-xs transition-colors ${
                          selected
                            ? "text-orange-800 dark:text-orange-200"
                            : "text-slate-700 group-hover/option:text-orange-700 dark:text-slate-200 dark:group-hover/option:text-orange-200"
                        }`}
                      >
                        {borderStyleLabels[id]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {tab === "typesetting" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className={groupLabelClassName}>
                {t("genealogyBook.settings.fontLabel", "Font")}
              </span>
              <div
                className={segmentGroupClassName}
                role="group"
                aria-label={t("genealogyBook.settings.fontLabel", "Font")}
              >
                {PAPER_FONT_PRESET_IDS.map((id) => {
                  const selected = appearance.fontPresetId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => updateAppearance({ fontPresetId: id })}
                      aria-pressed={selected}
                      title={fontPresetLabels[id]}
                      className={segmentButtonClassName(selected)}
                      data-testid={`paper-font-preset-${id}`}
                    >
                      {fontPresetLabels[id]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className={groupLabelClassName}>
                  {t("genealogyBook.settings.fontScaleLabel", "Type scale")}
                </span>
                <span className="text-[11px] tabular-nums text-stone-500 dark:text-slate-400">
                  {Math.round(appearance.fontScale * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={PAPER_FONT_SCALE_MIN}
                max={PAPER_FONT_SCALE_MAX}
                step={PAPER_FONT_SCALE_STEP}
                value={appearance.fontScale}
                onChange={(event) => updateAppearance({ fontScale: Number(event.target.value) })}
                aria-label={t("genealogyBook.settings.fontScaleLabel", "Type scale")}
                className={rangeInputClassName}
                data-testid="paper-font-scale-input"
              />
              <span className={hintClassName}>
                {t(
                  "genealogyBook.settings.fontScaleHint",
                  "Scales the whole sheet in the preview only",
                )}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className={groupLabelClassName}>
                  {t("genealogyBook.settings.exportMarginLabel", "Page margin")}
                </span>
                <span className="text-[11px] tabular-nums text-stone-500 dark:text-slate-400">
                  {appearance.exportMarginPx}px
                </span>
              </div>
              <input
                type="range"
                min={PAPER_EXPORT_MARGIN_MIN}
                max={PAPER_EXPORT_MARGIN_MAX}
                step={PAPER_EXPORT_MARGIN_STEP}
                value={appearance.exportMarginPx}
                onChange={(event) =>
                  updateAppearance({ exportMarginPx: Number(event.target.value) })
                }
                aria-label={t("genealogyBook.settings.exportMarginLabel", "PDF margin")}
                className={rangeInputClassName}
                data-testid="paper-export-margin-input"
              />
              <span className={hintClassName}>
                {t(
                  "genealogyBook.settings.exportMarginHint",
                  "Blank book edge around each leaf, shown in the preview and the exported PDF",
                )}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
