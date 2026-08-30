/**
 * One class vocabulary for every dialog in the app.
 *
 * Before this module the modal layer carried four visual languages — the glass
 * panel (ModalShell default, wallet/network pickers), the flat sheet
 * (ResponsiveModalFrame), the fixed 420px ConfirmDialog and the pill/gradient
 * story-seal dialog — each hardcoding its own `gray-*` scale. Everything here
 * consumes the semantic tokens declared in index.css, so dark mode is the same
 * composition with `--df-*` flipped rather than a parallel set of utilities.
 *
 * Radius scale: 16 panel (rounded-2xl) · 12 card (rounded-xl) · 10 field ·
 * 8 button (rounded-lg) · pill for status chips.
 */

/** Flow identity. Colours the header tile only — never a button. */
export type ModalAccent = "primary" | "emerald" | "blue" | "purple" | "danger";

/** Backdrop behind every dialog. One value, one elevation, no blur. */
export const MODAL_SCRIM = "absolute inset-0 bg-scrim";

export const MODAL_PANEL =
  "bg-surface border border-hairline rounded-2xl shadow-[0_24px_48px_-24px_rgba(15,23,42,0.28),0_2px_6px_-2px_rgba(15,23,42,0.08)] dark:shadow-[0_24px_48px_-24px_rgba(0,0,0,0.7)]";

/**
 * Dialog title. `modal-title` restores a line-height that fits CJK glyphs — see
 * the note in index.css; a `leading-*` utility cannot do it from here.
 */
export const MODAL_TITLE = "modal-title text-lg text-ink truncate";

export const MODAL_HEADER =
  "flex items-center gap-3 px-5 py-4 border-b border-hairline bg-surface";

/** The scrolling region between header and footer sits one step below them. */
export const MODAL_BODY = "bg-surface-body";

export const MODAL_FOOTER =
  "flex gap-2.5 px-5 py-3.5 border-t border-hairline bg-surface";

/** Content block inside MODAL_BODY. One step of depth — never a nested shadow. */
export const MODAL_CARD = "bg-surface border border-hairline rounded-xl";

export const MODAL_LABEL = "block text-xs font-semibold text-ink";

export const MODAL_HINT = "text-xs text-ink-muted";

const FIELD_BASE =
  "w-full rounded-[10px] border bg-surface text-ink placeholder:text-ink-subtle outline-hidden transition-colors";

const FIELD_REST = "border-hairline focus:border-primary focus:ring-3 focus:ring-primary/15";

const FIELD_ERROR = "border-danger focus:border-danger focus:ring-3 focus:ring-danger/15";

export const MODAL_FIELD = `${FIELD_BASE} ${FIELD_REST} h-11 px-3.5 text-sm`;

/** Swap for MODAL_FIELD when the value fails validation. */
export const MODAL_FIELD_INVALID = `${FIELD_BASE} ${FIELD_ERROR} h-11 px-3.5 text-sm`;

/** Compact field for dense rows (address chips, per-item inputs). */
export const MODAL_FIELD_SM = `${FIELD_BASE} ${FIELD_REST} h-10 px-3 text-xs`;

export const MODAL_TEXTAREA = `${FIELD_BASE} ${FIELD_REST} px-3.5 py-3 text-sm leading-relaxed resize-y`;

/** Pick the field class for a validated input. */
export function modalField(invalid?: boolean) {
  return invalid ? MODAL_FIELD_INVALID : MODAL_FIELD;
}

/** 36px header tile at a 12% tint of the flow's accent. */
export const MODAL_ACCENT_TILE: Record<ModalAccent, string> = {
  primary: "bg-primary/12 text-primary",
  emerald: "bg-emerald-600/12 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
  blue: "bg-info/12 text-info",
  purple: "bg-purple-600/12 text-purple-600 dark:bg-purple-400/15 dark:text-purple-400",
  danger: "bg-danger/12 text-danger",
};

export const MODAL_TILE_BASE =
  "w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0";

export const MODAL_CLOSE_BUTTON =
  "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-surface-muted text-ink-muted transition-colors hover:bg-hairline-strong/40 hover:text-ink";

/** Status pill — the only fully-round shape in the system. */
export const MODAL_CHIP =
  "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-semibold";
