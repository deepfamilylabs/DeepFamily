import type React from "react";

export interface ModalSectionHeadingProps {
  /** Optional trailing note on the rule ("Public", a count, "Optional", …). */
  aside?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}

/**
 * Section heading inside a dialog body: a small caption plus a rule, so the
 * dialog title stays the only large type in the panel. Replaces the
 * `h3.text-lg.font-bold` headings that competed with it.
 */
export function ModalSectionHeading({ aside, id, children }: ModalSectionHeadingProps) {
  return (
    <div className="flex items-center gap-2">
      <h3
        id={id}
        className="modal-heading font-body text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted"
      >
        {children}
      </h3>
      <div className="h-px flex-1 bg-hairline" aria-hidden />
      {aside ? <div className="text-[11px] text-ink-subtle">{aside}</div> : null}
    </div>
  );
}
