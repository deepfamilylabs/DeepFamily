/*
 * Theme boot.
 *
 * Runs before the app bundle so the first paint already carries the right
 * theme (no light flash on a dark-mode reload). Kept as a separate file
 * rather than inline because the production CSP is script-src 'self' with no
 * 'unsafe-inline'. Resolution order must match
 * src/app/context/ThemeContext.tsx: stored choice first, then the OS.
 */
(function () {
  try {
    var stored = localStorage.getItem("df-theme") || localStorage.getItem("theme");
    var dark =
      stored === "dark" ||
      (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    /* storage or matchMedia unavailable — stay on the default light theme */
  }
})();
