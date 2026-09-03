import { ChevronDown, Rows3 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationOption, PeoplePageT } from "../model/peoplePageModel";
import { isContiguousGenerationRun } from "../model/peoplePageModel";

interface GenerationFilterProps {
  t: PeoplePageT;
  options: GenerationOption[];
  selected: number[];
  onToggle: (generation: number) => void;
  onSelectRange: (from: number, to: number) => void;
  onClear: () => void;
}

const BAR_MAX_HEIGHT = 44;
const BAR_MIN_HEIGHT = 3;

/**
 * The one place to pick a generation. The button says so in words — the page
 * had nowhere visible to ask for "the third and fourth generation" — and the
 * panel behind it carries the head count per generation, takes a single
 * generation on click and a run of them on a drag across the row.
 */
export default function GenerationFilter({
  t,
  options,
  selected,
  onToggle,
  onSelectRange,
  onClear,
}: GenerationFilterProps) {
  const [open, setOpen] = useState(false);
  const [dragAnchor, setDragAnchor] = useState<number | null>(null);
  const [dragHover, setDragHover] = useState<number | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  // A drag can end anywhere, so the run is committed from the window rather
  // than from whichever cell happens to be under the pointer.
  useEffect(() => {
    if (dragAnchor === null) return;

    const finish = () => {
      if (dragHover !== null && dragHover !== dragAnchor) {
        onSelectRange(dragAnchor, dragHover);
        suppressClickRef.current = true;
      }
      setDragAnchor(null);
      setDragHover(null);
    };

    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [dragAnchor, dragHover, onSelectRange]);

  const handleClick = useCallback(
    (generation: number) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      onToggle(generation);
    },
    [onToggle],
  );

  if (options.length === 0) return null;

  const selectedCount = selected.length;
  const sorted = [...selected].sort((a, b) => a - b);
  const isRun = isContiguousGenerationRun(sorted);
  const maxCount = options.reduce((max, option) => Math.max(max, option.count), 0);
  const selectedPeople = options.reduce(
    (total, option) => (selected.includes(option.generation) ? total + option.count : total),
    0,
  );

  const dragLow = dragAnchor !== null && dragHover !== null ? Math.min(dragAnchor, dragHover) : null;
  const dragHigh = dragAnchor !== null && dragHover !== null ? Math.max(dragAnchor, dragHover) : null;
  const isPreviewed = (generation: number) =>
    dragLow !== null && dragHigh !== null && generation >= dragLow && generation <= dragHigh;

  const rangeLabel = t("people.generationRangeLabel", "Generation {{from}} – {{to}}", {
    from: sorted[0],
    to: sorted[sorted.length - 1],
  });
  const singleLabel = t("people.generationLabel", "Generation {{number}}", { number: sorted[0] });
  const summary =
    selectedCount === 0
      ? t("people.generationAll", "All generations")
      : isRun
        ? rangeLabel
        : selectedCount === 1
          ? singleLabel
          : t("people.generationPeople", "{{count}} people", { count: selectedPeople });

  const buttonLabel =
    selectedCount > 0 && isRun ? rangeLabel : t("people.generations", "Generations");

  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-colors ${
          selectedCount > 0
            ? "bg-primary/10 text-primary border border-primary/25"
            : "text-ink-muted border border-dashed border-hairline-strong hover:text-ink hover:border-ink-subtle"
        }`}
      >
        <Rows3 className="w-3.5 h-3.5" />
        <span>{buttonLabel}</span>
        {selectedCount > 0 && !isRun && (
          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-white text-[10.5px] font-bold tabular-nums">
            {selectedCount}
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("people.generations", "Generations")}
          className="absolute right-0 top-full mt-2 z-50 w-85 rounded-2xl border border-hairline bg-surface p-3.5 shadow-xl shadow-ink/10"
        >
          <div className="flex items-baseline justify-between mb-2.5">
            <span className="text-[11px] font-semibold tracking-wide text-ink-subtle">
              {t("people.generations", "Generations")}
            </span>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="text-[11px] font-medium text-primary hover:text-primary-hover transition-colors"
              >
                {t("people.generationClear", "Clear")}
              </button>
            )}
          </div>

          <div className="flex items-baseline gap-1.5 mb-3">
            <span className="text-[13px] font-semibold text-ink">{summary}</span>
            {selectedCount > 0 && (
              <span className="text-xs text-ink-muted tabular-nums">
                · {t("people.generationPeople", "{{count}} people", { count: selectedPeople })}
              </span>
            )}
          </div>

          <div className="overflow-x-auto -mx-1 px-1 pb-0.5">
            <div className="flex items-end gap-1.5">
              {options.map((option) => {
                const isSelected = selected.includes(option.generation);
                const isActive = isSelected || isPreviewed(option.generation);
                return (
                  <button
                    key={option.generation}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={t("people.generationLabel", "Generation {{number}}", {
                      number: option.generation,
                    })}
                    onPointerDown={() => {
                      setDragAnchor(option.generation);
                      setDragHover(option.generation);
                    }}
                    onPointerEnter={() => {
                      if (dragAnchor !== null) setDragHover(option.generation);
                    }}
                    onClick={() => handleClick(option.generation)}
                    className="group w-[27px] shrink-0 flex flex-col items-center gap-1.5 cursor-pointer select-none"
                  >
                    <span aria-hidden="true" className="flex items-end w-full h-[46px]">
                      <span
                        style={{
                          height: `${Math.max(
                            BAR_MIN_HEIGHT,
                            Math.round((option.count / (maxCount || 1)) * BAR_MAX_HEIGHT),
                          )}px`,
                        }}
                        className={`block w-full rounded-t transition-colors ${
                          isActive ? "bg-primary" : "bg-surface-muted group-hover:bg-hairline-strong"
                        }`}
                      />
                    </span>
                    <span
                      className={`flex items-center justify-center w-full h-6 rounded-lg text-xs font-semibold tabular-nums border transition-colors ${
                        isActive
                          ? "bg-primary border-primary text-white"
                          : "bg-surface-alt border-hairline text-ink-muted group-hover:text-ink group-hover:border-hairline-strong"
                      }`}
                    >
                      {option.generation}
                    </span>
                    <span className="text-[10px] text-ink-subtle tabular-nums">{option.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-hairline text-[11px] leading-relaxed text-ink-subtle">
            {t("people.generationHint", "Click a generation, or drag across the row to take a range.")}
          </div>
        </div>
      )}
    </div>
  );
}
