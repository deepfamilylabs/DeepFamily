import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";

interface SidebarContextType {
  isMobileOpen: boolean;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  /**
   * Which settings panel is expanded, on either breakpoint. Null means none.
   * Distinct from the nav section the rail highlights — that comes from the
   * route (see navSections).
   */
  activePanel: string | null;
  togglePanel: (panel: string) => void;
  closePanel: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);

  // Stable identities: consumers put these in effect dependency lists.
  const toggleMobileSidebar = useCallback(() => setIsMobileOpen((prev) => !prev), []);
  const closeMobileSidebar = useCallback(() => setIsMobileOpen(false), []);
  const closePanel = useCallback(() => setActivePanel(null), []);
  const togglePanel = useCallback(
    (panel: string) => setActivePanel((prev) => (prev === panel ? null : panel)),
    [],
  );

  const value = useMemo<SidebarContextType>(
    () => ({
      isMobileOpen,
      toggleMobileSidebar,
      closeMobileSidebar,
      activePanel,
      togglePanel,
      closePanel,
    }),
    [isMobileOpen, toggleMobileSidebar, closeMobileSidebar, activePanel, togglePanel, closePanel],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
