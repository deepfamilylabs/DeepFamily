import React from "react";
import { useColorTheme, type ColorTheme } from "../context";
import { Palette } from "lucide-react";

const THEMES: { id: ColorTheme; color: string; label: string }[] = [
  { id: "default", color: "#10b981", label: "Emerald" }, // emerald-500
  { id: "slate", color: "#64748b", label: "Slate" }, // slate-500
  { id: "red", color: "#ef4444", label: "Red" }, // red-500
  { id: "orange", color: "#f97316", label: "Orange" }, // orange-500
  { id: "amber", color: "#f59e0b", label: "Amber" }, // amber-500
  { id: "yellow", color: "#eab308", label: "Yellow" }, // yellow-500
  { id: "lime", color: "#84cc16", label: "Lime" }, // lime-500
  { id: "green", color: "#22c55e", label: "Green" }, // green-500
  { id: "emerald", color: "#10b981", label: "Emerald" }, // emerald-500
  { id: "teal", color: "#14b8a6", label: "Teal" }, // teal-500
  { id: "cyan", color: "#06b6d4", label: "Cyan" }, // cyan-500
  { id: "sky", color: "#0ea5e9", label: "Sky" }, // sky-500
  { id: "blue", color: "#3b82f6", label: "Blue" }, // blue-500
  { id: "indigo", color: "#6366f1", label: "Indigo" }, // indigo-500
  { id: "violet", color: "#8b5cf6", label: "Violet" }, // violet-500
  { id: "purple", color: "#a855f7", label: "Purple" }, // purple-500
  { id: "fuchsia", color: "#d946ef", label: "Fuchsia" }, // fuchsia-500
  { id: "pink", color: "#ec4899", label: "Pink" }, // pink-500
  { id: "rose", color: "#f43f5e", label: "Rose" }, // rose-500
];

export default function ColorPalette() {
  const { theme, setTheme } = useColorTheme();
  const [isOpen, setIsOpen] = React.useState(false);
  const paletteId = React.useId();

  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex h-8 items-center gap-2 rounded-xl border border-hairline bg-surface/95 px-2.5 shadow-sm backdrop-blur-sm transition-colors hover:border-hairline-strong md:h-[34px] md:px-3"
        title="Change Color Theme"
        aria-label="Change color theme"
        aria-expanded={isOpen}
        aria-controls={isOpen ? paletteId : undefined}
      >
        <Palette className="h-4 w-4 text-ink-muted" />
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: THEMES.find((t) => t.id === theme)?.color }}
          aria-hidden
        />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            id={paletteId}
            className="absolute left-0 top-full z-50 mt-2 grid w-64 grid-cols-5 gap-2 rounded-xl border border-hairline bg-surface p-2 shadow-xl shadow-ink/10"
            role="group"
            aria-label="Color themes"
          >
            {THEMES.filter((t) => t.id !== "default").map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTheme(t.id);
                  setIsOpen(false);
                }}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${
                  theme === t.id ? "ring-2 ring-offset-2 ring-slate-400 dark:ring-slate-500" : ""
                }`}
                style={{ backgroundColor: t.color }}
                title={t.label}
                aria-label={`Set color theme to ${t.label}`}
                aria-pressed={theme === t.id}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
