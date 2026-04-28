import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";

interface ThemedSelectProps {
  value: number;
  onChange: (value: number) => void;
  options: { value: number; label: string }[];
  className?: string;
}

export function ThemedSelect({ value, onChange, options, className = "" }: ThemedSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const current = options.find((option) => option.value === value)?.label ?? "";
  const selectedIndex = options.findIndex((option) => option.value === value);
  const activeOptionId =
    open && options[activeIndex] ? `${listboxId}-option-${options[activeIndex].value}` : undefined;

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const moveActive = (delta: number) => {
    if (options.length === 0) return;
    setActiveIndex((index) => (index + delta + options.length) % options.length);
  };

  const handleRootBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedElement = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!event.currentTarget.contains(nextFocusedElement)) {
      setOpen(false);
    }
  };

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          return;
        }
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.length - 1);
          return;
        }
        moveActive(-1);
        break;
      case "Home":
        if (!open) return;
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        if (!open) return;
        event.preventDefault();
        setActiveIndex(Math.max(0, options.length - 1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          return;
        }
        selectOption(activeIndex);
        break;
      case "Escape":
        if (!open) return;
        event.preventDefault();
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} onBlur={handleRootBlur} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleButtonKeyDown}
        className="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-left text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500/30 dark:focus:ring-orange-400/30 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition flex items-center justify-between"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
      >
        <span className="truncate">{current}</span>
        <ChevronDown size={16} className="text-gray-500 dark:text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
          <ul id={listboxId} role="listbox" className="max-h-60 overflow-auto">
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-option-${option.value}`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  selectOption(index);
                }}
                className={`px-3 py-2 text-xs cursor-pointer select-none transition-colors ${
                  option.value === value
                    ? "bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
                    : index === activeIndex
                      ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-50"
                    : "text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                {option.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
