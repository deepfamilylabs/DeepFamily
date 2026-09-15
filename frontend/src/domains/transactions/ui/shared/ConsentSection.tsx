import { AlertTriangle, Check } from "lucide-react";
import { ModalSectionHeading } from "../../../../shared/ui";
import { ConsentCheckbox } from "./ConsentCheckbox";

export type ConsentItem<K extends string> = { key: K; label: string };

/**
 * The informed-consent block shared by the add-version and mint flows: a
 * section heading like the rest of the form, carrying how many items are
 * confirmed, over one card of whole-row consents. Each item is confirmed on its
 * own — there is deliberately no "agree to all".
 */
export function ConsentSection<K extends string>({
  title,
  items,
  consents,
  error,
  onToggle,
}: {
  title: string;
  items: ReadonlyArray<ConsentItem<K>>;
  consents: Record<K, boolean>;
  error: string | null;
  onToggle: (key: K) => void;
}) {
  const confirmed = items.filter((item) => consents[item.key]).length;
  const complete = confirmed === items.length;

  return (
    <div className="space-y-2.5">
      <ModalSectionHeading
        aside={
          <span
            className={`inline-flex items-center gap-1 tabular-nums ${complete ? "text-success" : ""}`}
          >
            {complete ? <Check className="w-3 h-3" strokeWidth={3} aria-hidden /> : null}
            {confirmed}/{items.length}
          </span>
        }
      >
        {title}
      </ModalSectionHeading>

      <div className="overflow-hidden rounded-xl border border-hairline bg-surface divide-y divide-hairline">
        {items.map((item) => (
          <ConsentCheckbox
            key={item.key}
            checked={consents[item.key]}
            onChange={() => onToggle(item.key)}
          >
            {item.label}
          </ConsentCheckbox>
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-xs font-semibold text-danger animate-fade-in"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
