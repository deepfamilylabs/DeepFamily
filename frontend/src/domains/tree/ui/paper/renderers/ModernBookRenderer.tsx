import type { PaperGeneration, TranslateFn } from "../paperData";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_NOTE_FONT_STACK,
  PAPER_SHEET_STYLE,
  PAPER_TITLE_FONT_STACK,
  PAPER_VARS,
} from "../paperStyles";

export function ModernBookRenderer({
  generations,
  t,
}: {
  generations: PaperGeneration[];
  t: TranslateFn;
}) {
  return (
    <div className="h-full overflow-auto p-4 md:p-6" style={PAPER_VARS} data-testid="paper-modern">
      <div
        className="min-h-full min-w-max border p-5 shadow-sm"
        style={{
          ...PAPER_SHEET_STYLE,
          borderColor: "var(--df-paper-line)",
          color: "var(--df-paper-ink)",
          fontFamily: PAPER_BODY_FONT_STACK,
        }}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold tracking-normal">
            {t("genealogyBook.styles.modern", "Modern Ledger")}
          </h2>
          <span className="text-sm" style={{ color: "var(--df-paper-muted)" }}>
            {t("genealogyBook.realtime", "Realtime preview")}
          </span>
        </div>
        <div className="flex items-stretch gap-4">
          {generations.map((generation) => (
            <section
              key={generation.depth}
              className="w-72 shrink-0 border"
              style={{ borderColor: "var(--df-paper-line-soft)" }}
            >
              <div
                className="border-b px-3 py-2 text-sm font-bold"
                style={{
                  borderColor: "var(--df-paper-line-soft)",
                  background: "rgba(138, 106, 59, 0.08)",
                }}
              >
                {generation.label}
              </div>
              <div className="divide-y" style={{ borderColor: "var(--df-paper-line-soft)" }}>
                {generation.people.map((person) => (
                  <article key={person.id} className="px-3 py-3" data-testid={`paper-row-${person.id}`}>
                    <div className="flex items-center justify-between gap-3">
                      <strong className="min-w-0 truncate" style={{ fontFamily: PAPER_TITLE_FONT_STACK }}>
                        {person.ui.titleText}
                      </strong>
                      <span className="text-xs" style={{ color: "var(--df-paper-red)" }}>
                        {person.depth + 1}.{person.sequence}
                      </span>
                    </div>
                    <div
                      className="mt-1 text-xs leading-5"
                      style={{ color: "var(--df-paper-muted)", fontFamily: PAPER_NOTE_FONT_STACK }}
                    >
                      {person.classicalLines.slice(0, 4).join(" · ") || person.ui.shortHashText}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
