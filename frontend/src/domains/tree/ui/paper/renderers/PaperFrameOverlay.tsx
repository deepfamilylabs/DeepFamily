import { PAPER_LINE } from "../paperStyles";

// Decorative INNER line of the version frame (版框). The outer line is the host leaf's own border;
// this absolutely-positioned, non-interactive overlay paints the optional second line that the
// double / left-right / 文武 border styles add. It is anchored to the leaf's padding box and offset
// by exactly --df-paper-frame-pad-* — the same padding the leaf reserves — so the inner line lands
// on the content edge where the page's own dividers (bands, spine, generation column) terminate,
// closing the frame with the genealogy instead of floating in the blank margin. The reserved gap
// therefore sits between the inner and outer lines, not between the inner line and the content. All
// geometry comes from the --df-paper-frame-* vars set by the active border-style preset; the
// `single` style collapses this to an invisible 0-width, 0-offset frame.
//
// The host leaf (spread) must be `position: relative` for the offsets to anchor to it. The `z-index`
// lifts the inner line above the leaf's content — notably the spine <aside>, which is positioned and
// has an opaque background, so without this it would paint over and break the inner line where the
// top/bottom rules cross the spine. Since the line sits on the content edge (clear of text), drawing
// it on top closes the frame with the spine and column dividers instead of disappearing behind them.
export function PaperFrameOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-[1]"
      style={{
        top: "var(--df-paper-frame-pad-tb)",
        bottom: "var(--df-paper-frame-pad-tb)",
        left: "var(--df-paper-frame-pad-lr)",
        right: "var(--df-paper-frame-pad-lr)",
        borderStyle: "solid",
        borderColor: PAPER_LINE.strong,
        borderTopWidth: "var(--df-paper-frame-inner-tb)",
        borderBottomWidth: "var(--df-paper-frame-inner-tb)",
        borderLeftWidth: "var(--df-paper-frame-inner-lr)",
        borderRightWidth: "var(--df-paper-frame-inner-lr)",
      }}
      data-testid="paper-frame-overlay"
    />
  );
}
