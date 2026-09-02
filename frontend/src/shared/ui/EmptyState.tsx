import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /**
   * `inline` sits inside a result shell; `page` stands alone as the whole
   * page's answer and needs the larger type to carry it.
   */
  size?: "inline" | "page";
}

/** The app's "nothing here" block — an empty result, a prompt, a gate. */
export function EmptyState({ icon, title, description, action, size = "inline" }: EmptyStateProps) {
  const page = size === "page";
  return (
    <div
      className={`flex flex-col items-center text-center ${page ? "px-8 py-16" : "px-6 py-10"}`}
    >
      <span
        className={`inline-flex items-center justify-center text-ink-subtle ${
          page
            ? "h-16 w-16 rounded-full border border-hairline bg-surface-alt"
            : "mb-3.5 h-12 w-12 rounded-2xl bg-surface-muted"
        }`}
      >
        {icon}
      </span>
      <div className={page ? "mt-4 text-[17px] font-bold text-ink" : "mb-1.5 text-sm font-semibold text-ink"}>
        {title}
      </div>
      {description ? (
        <p
          className={`text-sm leading-relaxed text-ink-muted ${
            page ? "mt-1.5 max-w-md" : "mb-4 max-w-sm"
          }`}
        >
          {description}
        </p>
      ) : null}
      {action ? <div className={page ? "mt-6" : ""}>{action}</div> : null}
    </div>
  );
}
