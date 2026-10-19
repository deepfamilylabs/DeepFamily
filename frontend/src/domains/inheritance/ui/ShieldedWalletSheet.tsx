import { useId, type ComponentType, type ReactNode } from "react";
import { X, type LucideProps } from "lucide-react";
import { ModalShell } from "../../../shared/ui";

/** A side sheet over the workspace for one wallet's receive code or key management. */
export function ShieldedWalletSheet({
  open,
  title,
  icon: Icon,
  closeLabel,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  icon: ComponentType<LucideProps>;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <ModalShell
      isOpen={open}
      onClose={onClose}
      bare
      ariaLabelledBy={titleId}
      closeLabel={closeLabel}
    >
      <div
        className="absolute inset-y-0 right-0 flex w-full max-w-[32.5rem] flex-col bg-surface shadow-[-24px_0_48px_-24px_rgba(15,23,42,0.35)] dark:border-l dark:border-hairline"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline/70 px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300"
            >
              <Icon className="h-5 w-5" />
            </span>
            <h2 id={titleId} className="ui-heading min-w-0 text-lg text-ink">
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">{children}</div>
      </div>
    </ModalShell>
  );
}
