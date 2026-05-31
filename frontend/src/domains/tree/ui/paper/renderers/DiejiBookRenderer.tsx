import type { PaperGeneration } from "../paperData";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_NOTE_FONT_STACK,
  PAPER_SHEET_STYLE,
  PAPER_TITLE_FONT_STACK,
  PAPER_VARS,
} from "../paperStyles";
import type { TranslateFn } from "../paperData";

export function DiejiBookRenderer({
  generations,
  t,
}: {
  generations: PaperGeneration[];
  t: TranslateFn;
}) {
  return (
    <div className="h-full overflow-auto p-4 md:p-6" style={PAPER_VARS} data-testid="paper-dieji">
      <div
        className="mx-auto min-h-full max-w-6xl border px-5 py-6 shadow-sm md:px-10 md:py-8"
        style={{
          ...PAPER_SHEET_STYLE,
          borderColor: "var(--df-paper-line)",
          color: "var(--df-paper-ink)",
          fontFamily: PAPER_BODY_FONT_STACK,
        }}
      >
        <div className="mb-6 flex items-end justify-between gap-4 border-b pb-3" style={{ borderColor: "var(--df-paper-line-soft)" }}>
          <h2
            className="text-2xl font-bold tracking-normal"
            style={{ fontFamily: PAPER_TITLE_FONT_STACK }}
          >
            {t("genealogyBook.styles.dieji", "Register")}
          </h2>
          <span className="text-sm" style={{ color: "var(--df-paper-muted)" }}>
            {t("genealogyBook.recordCount", "{{count}} records", {
              count: generations.reduce((sum, generation) => sum + generation.people.length, 0),
            })}
          </span>
        </div>
        <div className="space-y-7">
          {generations.map((generation) => (
            <section key={generation.depth}>
              <h3
                className="mb-3 border-l-4 pl-3 text-lg font-bold tracking-normal"
                style={{ borderColor: "var(--df-paper-red)" }}
              >
                {generation.label}
              </h3>
              <div className="divide-y" style={{ borderColor: "var(--df-paper-line-soft)" }}>
                {generation.people.map((person) => (
                  <article
                    key={person.id}
                    className="grid gap-2 py-3 md:grid-cols-[9rem_1fr]"
                    data-testid={`paper-row-${person.id}`}
                  >
                    <div className="font-bold" style={{ fontFamily: PAPER_TITLE_FONT_STACK }}>
                      {person.depth + 1}.{person.sequence} {person.ui.titleText}
                    </div>
                    <p
                      className="text-sm leading-7"
                      style={{ color: "var(--df-paper-muted)", fontFamily: PAPER_NOTE_FONT_STACK }}
                    >
                      {person.classicalLines.join(" · ") || person.ui.shortHashText}
                    </p>
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
