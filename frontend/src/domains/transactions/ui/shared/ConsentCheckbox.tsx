import { Check } from "lucide-react";
import type { ReactNode } from "react";

interface ConsentCheckboxProps {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}

/**
 * One consent, as a whole-row target: the sentence is what is being agreed to,
 * and a small box beside small text was all there was to hit on a phone. A
 * checked row keeps a faint tint, so whatever is still open stands out. The
 * accessible name stays the sentence alone.
 *
 * `checked:bg-none` drops the forms plugin's own check image, which would sit
 * under this one in a colour the dark theme cannot adjust.
 */
export function ConsentCheckbox({ checked, onChange, children }: ConsentCheckboxProps) {
  return (
    <label
      className={`flex items-start gap-3 px-3.5 py-3 cursor-pointer select-none transition-colors ${
        checked ? "bg-primary/6 dark:bg-primary/10" : "hover:bg-surface-alt"
      }`}
    >
      <span className="relative flex shrink-0 items-center justify-center w-[18px] h-[18px] mt-px">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-hairline-strong bg-surface transition-colors checked:border-primary checked:bg-primary checked:bg-none focus:outline-hidden focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        />
        <Check
          aria-hidden
          strokeWidth={3}
          className="pointer-events-none absolute w-3 h-3 text-white dark:text-orange-950 opacity-0 transition-opacity peer-checked:opacity-100"
        />
      </span>
      <span className="text-[13px] leading-relaxed text-ink">{children}</span>
    </label>
  );
}
