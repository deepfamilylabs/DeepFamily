import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";

interface SidebarContextType {
  isMobileOpen: boolean;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  /** Which sidebar panel is open, on either breakpoint. Null means none. */
  activeSection: string | null;
  toggleSection: (section: string) => void;
  closeSection: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  // Stable identities: consumers put these in effect dependency lists.
  const toggleMobileSidebar = useCallback(() => setIsMobileOpen((prev) => !prev), []);
  const closeMobileSidebar = useCallback(() => setIsMobileOpen(false), []);
  const closeSection = useCallback(() => setActiveSection(null), []);
  const toggleSection = useCallback(
    (section: string) => setActiveSection((prev) => (prev === section ? null : section)),
    [],
  );

  const value = useMemo<SidebarContextType>(
    () => ({
      isMobileOpen,
      toggleMobileSidebar,
      closeMobileSidebar,
      activeSection,
      toggleSection,
      closeSection,
    }),
    [isMobileOpen, toggleMobileSidebar, closeMobileSidebar, activeSection, toggleSection, closeSection],
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
