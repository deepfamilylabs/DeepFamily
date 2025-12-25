import React, { createContext, useContext, useState, ReactNode } from 'react';

interface SidebarContextType {
  isMobileOpen: boolean;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  activeSection: string | null;
  toggleSection: (section: string) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const toggleMobileSidebar = () => setIsMobileOpen(prev => !prev);
  const closeMobileSidebar = () => setIsMobileOpen(false);
  
  const toggleSection = (section: string) => {
    setActiveSection(prev => prev === section ? null : section);
    // If on mobile and opening a section, ensure sidebar is open (though it should be already)
    // If on desktop, opening a section expands the sidebar (handled by layout/component)
  };

  return (
    <SidebarContext.Provider value={{ 
      isMobileOpen, 
      toggleMobileSidebar, 
      closeMobileSidebar,
      activeSection,
      toggleSection
    }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
