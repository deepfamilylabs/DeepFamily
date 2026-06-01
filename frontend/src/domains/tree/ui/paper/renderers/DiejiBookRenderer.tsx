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
        className="mx-auto flex min-h-full max-w-[1320px] flex-col gap-7"
        style={{
          color: "var(--df-paper-ink)",
          fontFamily: PAPER_BODY_FONT_STACK,
        }}
      >
        <section
          className="border p-3 shadow-sm md:p-5"
          style={{
            ...PAPER_SHEET_STYLE,
            borderColor: "var(--df-paper-line)",
          }}
          data-testid="paper-dieji-chart"
        >
          <div
            className="mb-3 flex items-center justify-between gap-4 border-b pb-3"
            style={{ borderColor: "var(--df-paper-line-soft)" }}
          >
            <h2
              className="text-xl font-bold tracking-normal"
              style={{ fontFamily: PAPER_TITLE_FONT_STACK }}
            >
              {t("genealogyBook.styles.dieji", "Register")}
            </h2>
            <span className="text-sm font-bold" style={{ color: "var(--df-paper-red)" }}>
              {t("genealogyBook.recordCount", "{{count}} records", {
                count: generations.reduce((sum, generation) => sum + generation.people.length, 0),
              })}
            </span>
          </div>

          <div className="flex flex-col gap-5">
            <div
              className="h-[872px] min-w-[1180px] shrink-0 overflow-auto border px-5 py-6 md:px-10 md:py-8"
              style={{
                borderColor: "var(--df-paper-line)",
                background: "var(--df-paper-sheet)",
              }}
              data-testid="paper-dieji-page"
            >
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
                            style={{
                              color: "var(--df-paper-muted)",
                              fontFamily: PAPER_NOTE_FONT_STACK,
                            }}
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
        </section>
      </div>
    </div>
  );
}
