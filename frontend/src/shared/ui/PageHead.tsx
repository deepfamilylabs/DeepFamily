import type { ReactNode } from "react";

export interface PageHeadProps {
  title: string;
  subtitle?: string;
  /** Right-hand slot — a metric strip, an action, whatever the page needs. */
  trailing?: ReactNode;
}

/**
 * The one page head. /people and /search each sized their own h1 and subtitle,
 * so two sibling top-level pages read at different scales; this holds them to
 * one.
 */
export function PageHead({ title, subtitle, trailing }: PageHeadProps) {
  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-8">
      <div className="min-w-0">
        <h1 className="text-3xl text-ink md:text-[2.125rem]">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p> : null}
      </div>
      {trailing}
    </div>
  );
}
