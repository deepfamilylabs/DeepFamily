import { useEffect, useState } from "react";

const DEFAULT_DESKTOP_QUERY = "(min-width: 768px)";

function getMatches(query: string) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

export function useResponsiveModalMode(query = DEFAULT_DESKTOP_QUERY) {
  const [matches, setMatches] = useState<boolean>(() => getMatches(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setMatches(event.matches);
    };

    handleChange(mediaQuery);

    try {
      mediaQuery.addEventListener("change", handleChange as EventListener);
      return () => mediaQuery.removeEventListener("change", handleChange as EventListener);
    } catch {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [query]);

  return matches;
}
