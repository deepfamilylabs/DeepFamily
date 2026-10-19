import { forwardRef, useImperativeHandle, useRef } from "react";

export type ShieldedRecoveryMaterialHandle = {
  /** Writes the Worker's material straight into the DOM; it never enters React state. */
  show: (material: string) => void;
  clear: () => void;
};

const MNEMONIC_WORDS = 24;
const MASK = "••••••";

/**
 * The exported funds backup: 24 numbered words or one Shielded Key. Every slot
 * stays masked until the Worker's material is written in, and empties again on clear.
 */
export const ShieldedRecoveryMaterialView = forwardRef<
  ShieldedRecoveryMaterialHandle,
  { format: "mnemonic" | "shieldedKey"; labelledBy: string }
>(function ShieldedRecoveryMaterialView({ format, labelledBy }, ref) {
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  const block = useRef<HTMLParagraphElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      show(material) {
        const parts = material.trim().split(/\s+/);
        const grid = format === "mnemonic" && parts.length === MNEMONIC_WORDS;
        for (const [index, node] of words.current.entries()) {
          if (node) node.textContent = grid ? parts[index] : "";
        }
        if (block.current) block.current.textContent = grid ? "" : material;
      },
      clear() {
        for (const node of words.current) if (node) node.textContent = "";
        if (block.current) block.current.textContent = "";
      },
    }),
    [format],
  );

  if (format === "shieldedKey") {
    return (
      <div
        role="group"
        aria-labelledby={labelledBy}
        className="rounded-[14px] border border-hairline bg-surface-alt p-3.5"
      >
        <p
          ref={block}
          className="peer break-all font-mono text-[13px] leading-relaxed text-ink empty:hidden"
        />
        <p
          aria-hidden="true"
          className="hidden break-all font-mono text-[13px] leading-relaxed tracking-[0.08em] text-ink-subtle peer-empty:block"
        >
          {MASK.repeat(8)}
        </p>
      </div>
    );
  }
  return (
    <div role="group" aria-labelledby={labelledBy} className="space-y-2">
      <ol className="grid grid-cols-2 gap-1.5 rounded-[14px] border border-hairline bg-surface-alt p-3 sm:grid-cols-3">
        {Array.from({ length: MNEMONIC_WORDS }, (_, index) => (
          <li
            key={index}
            className="flex min-h-[34px] min-w-0 items-center gap-2 rounded-lg border border-hairline/70 bg-surface px-2.5"
          >
            <span className="w-[18px] shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
              {index + 1}
            </span>
            <span
              ref={(node) => {
                words.current[index] = node;
              }}
              className="peer min-w-0 truncate font-mono text-[13px] text-ink empty:hidden"
            />
            <span
              aria-hidden="true"
              className="hidden font-mono text-[13px] tracking-[0.08em] text-ink-subtle peer-empty:inline"
            >
              {MASK}
            </span>
          </li>
        ))}
      </ol>
      {/* Material that does not split into the expected words is shown whole, never truncated. */}
      <p
        ref={block}
        className="break-all font-mono text-[13px] leading-relaxed text-ink empty:hidden"
      />
    </div>
  );
});
