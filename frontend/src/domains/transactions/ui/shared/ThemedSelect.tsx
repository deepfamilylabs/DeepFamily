import { useEffect, useId, useRef, useState, type FocusEvent } from "react";
import { ChevronDown } from "lucide-react";
import { useListboxA11y } from "../../../../shared/ui/useListboxA11y";

interface ThemedSelectProps {
  value: number;
  onChange: (value: number) => void;
  options: { value: number; label: string; meta?: string }[];
  className?: string;
  disabled?: boolean;
  /** Shown when the value matches no option, e.g. before anything is chosen. */
  placeholder?: string;
  /** Match the neighbouring field token: "sm" for MODAL_FIELD_SM, "md" for MODAL_FIELD. */
  size?: "sm" | "md";
}

const SIZE_CLASS: Record<"sm" | "md", string> = {
  sm: "h-10 px-3 text-xs",
  md: "h-11 px-3.5 text-sm",
};

export function ThemedSelect({
  value,
  onChange,
  options,
  className = "",
  disabled = false,
  placeholder = "",
  size = "sm",
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const current = selected?.label ?? placeholder;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const {
    activeIndex,
    activeOptionId,
    getOptionId,
    handleButtonKeyDown,
    selectOption,
    setActiveIndex,
  } = useListboxA11y({
    open,
    options,
    selectedIndex,
    listboxId,
    getOptionKey: (option) => option.value,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
    onSelect: (option) => {
      onChange(option.value);
      setOpen(false);
    },
    buttonRef,
    focusButtonOnSelect: true,
  });

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, []);

  const handleRootBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedElement = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!event.currentTarget.contains(nextFocusedElement)) {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} onBlur={handleRootBlur} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleButtonKeyDown}
        className={`w-full ${SIZE_CLASS[size]} rounded-lg border border-hairline-strong bg-surface text-left focus:outline-hidden focus:ring-3 focus:ring-primary/15 transition flex items-center justify-between ${
          disabled
            ? "cursor-not-allowed opacity-60 text-ink-subtle"
            : "text-ink hover:bg-surface-alt/60"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
      >
        <span className={`truncate ${selected ? "" : "text-ink-subtle"}`}>{current}</span>
        <ChevronDown size={16} className="text-ink-muted" />
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-hairline bg-surface shadow-lg overflow-hidden">
          <ul id={listboxId} role="listbox" className="max-h-60 overflow-auto">
            {options.map((option, index) => (
              <li
                key={option.value}
                id={getOptionId(option, index)}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  selectOption(index);
                }}
                className={`px-3 py-2 cursor-pointer select-none transition-colors ${
                size === "md" ? "text-sm" : "text-xs"
              } ${
                  option.value === value
                    ? "bg-primary/10 text-orange-700 dark:text-orange-300"
                    : index === activeIndex
                      ? "bg-surface-muted text-ink"
                    : "text-ink hover:bg-surface-muted"
                }`}
              >
                <span className="block truncate">{option.label}</span>
                {option.meta && (
                  <span className="block truncate text-[11px] text-ink-subtle">{option.meta}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
