import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

type ActivePathContextValue = {
  activePath: string;
  setActivePath: (path: string) => void;
};

const ActivePathContext = createContext<ActivePathContextValue | null>(null);

export function ActivePathProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [activePath, setActivePathState] = useState(() => location.pathname);

  useEffect(() => {
    setActivePathState(location.pathname);
  }, [location.pathname]);

  const setActivePath = useCallback((path: string) => {
    setActivePathState(path);
  }, []);

  const value = useMemo(() => ({ activePath, setActivePath }), [activePath, setActivePath]);

  return <ActivePathContext.Provider value={value}>{children}</ActivePathContext.Provider>;
}

export function useActivePath() {
  const value = useContext(ActivePathContext);
  if (!value) throw new Error("useActivePath must be used within ActivePathProvider");
  return value;
}

