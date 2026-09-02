import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

export type ActionCardTone = "primary" | "info" | "success" | "neutral";

export interface ActionCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** Semantic accent for the icon tile. Never a raw hue. */
  tone?: ActionCardTone;
  /** Renders the call-to-action row; omit for a card that only explains. */
  cta?: string;
  /** With a handler the card becomes a button; without it, static copy. */
  onClick?: () => void;
}

const TONE_CLASS: Record<ActionCardTone, string> = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  neutral: "bg-surface-muted text-ink-muted",
};

const SHELL =
  "flex h-full flex-col items-start gap-3.5 rounded-3xl border border-hairline bg-surface p-5 text-left";

/**
 * One card for "here is a thing you can do / can search for". Used by the
 * actions page and by the search page's entry cards, which had grown into two
 * copies of the same anatomy at different sizes.
 */
export function ActionCard({
  icon,
  title,
  description,
  tone = "primary",
  cta,
  onClick,
}: ActionCardProps) {
  const body = (
    <>
      <span
        className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${TONE_CLASS[tone]}`}
      >
        {icon}
      </span>
      <h3 className="text-lg text-ink">{title}</h3>
      <p className="flex-1 text-sm leading-relaxed text-ink-muted">{description}</p>
      {cta ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
          {cta}
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </span>
      ) : null}
    </>
  );

  if (!onClick) return <div className={SHELL}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group ${SHELL} transition-all duration-300 hover:-translate-y-1 hover:border-primary/45 hover:shadow-[0_18px_34px_-18px_rgba(15,23,42,0.28)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-0 dark:hover:shadow-none`}
    >
      {body}
    </button>
  );
}
