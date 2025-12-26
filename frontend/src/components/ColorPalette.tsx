import React from "react";
import { useColorTheme, ColorTheme } from "../context/ColorThemeContext";
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

  return (
    <div className="relative group">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-full bg-white dark:bg-slate-800 shadow-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 flex items-center gap-2"
        title="Change Color Theme"
      >
        <Palette className="w-5 h-5 text-slate-600 dark:text-slate-300" />
        <div 
          className="w-3 h-3 rounded-full" 
          style={{ backgroundColor: THEMES.find(t => t.id === theme)?.color }}
        />
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-2 p-2 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-50 grid grid-cols-5 gap-2 w-64">
            {THEMES.filter(t => t.id !== 'default').map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTheme(t.id);
                  setIsOpen(false);
                }}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${
                  theme === t.id ? "ring-2 ring-offset-2 ring-slate-400 dark:ring-slate-500" : ""
                }`}
                style={{ backgroundColor: t.color }}
                title={t.label}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
