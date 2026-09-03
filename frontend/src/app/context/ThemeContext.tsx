import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Theme = "light" | "dark";

/**
 * Theme state for the whole app.
 *
 * The class is applied by public/theme-boot.js before React mounts,
 * so the first paint already carries the right theme. This provider only has
 * to stay in sync with it — keep the storage keys and the resolution order
 * (stored value, then system preference) identical in both places.
 */
const STORAGE_KEY = "df-theme";
const LEGACY_STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
}

function getSystemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  // `color-scheme` rides along with the class in index.css.
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? getSystemTheme());
  // Only an explicit choice pins the theme; until then we keep following the OS.
  const [isPinned, setIsPinned] = useState<boolean>(() => readStoredTheme() !== null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (isPinned) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(DARK_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setThemeState(event.matches ? "dark" : "light");
    };

    try {
      mediaQuery.addEventListener("change", handleChange as EventListener);
      return () => mediaQuery.removeEventListener("change", handleChange as EventListener);
    } catch {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [isPinned]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setIsPinned(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      // Older builds wrote both keys; df-theme is the only one we read back now.
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* storage unavailable (private mode, blocked cookies) — theme stays for this session */
    }
  }, []);

  const value = useMemo<ThemeContextType>(
    () => ({
      theme,
      isDark: theme === "dark",
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
