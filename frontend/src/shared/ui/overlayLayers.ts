/**
 * Overlay stacking order.
 *
 * Everything here must sit ABOVE the app chrome, which is itself fixed and
 * layered: FloatingActionButton z-10000, BottomNav z-9999, the GlobalSidebar
 * mobile drawer z-10005 (its desktop rail sits below the header at z-90),
 * SiteHeader z-100. A dialog below that band ends up painted over by the
 * chrome, which is what the low z-1200/z-1300 layers used to do.
 */
export const OVERLAY_Z_INDEX = {
  /** Page-level confirmations. */
  confirmDialog: "z-10010",
  /** ModalShell default — standalone dialogs raised from a page. */
  modal: "z-10015",
  /** Full transaction/detail sheets (ResponsiveModalFrame). */
  appModal: "z-10020",
  /** Blocks an appModal until answered. */
  blockingDialog: "z-10030",
  /** Raised from inside an appModal, so it must clear it. */
  nestedModal: "z-10040",
  toast: "z-11000",
} as const;
