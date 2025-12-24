import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import EndorseCompactModal from "../components/modals/EndorseCompactModal";
import { useTreeData } from "./TreeDataContext";

export type EndorseTarget = {
  personHash: string;
  versionIndex: number;
  fullName?: string;
  endorsementCount?: number;
};

type EndorseModalContextValue = {
  openEndorse: (t: EndorseTarget) => void;
  closeEndorse: () => void;
};

const Ctx = createContext<EndorseModalContextValue | null>(null);

export function EndorseModalProvider({ children }: { children: React.ReactNode }) {
  const { bumpEndorsementCount } = useTreeData();
  const [target, setTarget] = useState<EndorseTarget | null>(null);

  const openEndorse = useCallback((t: EndorseTarget) => {
    setTarget({
      personHash: t.personHash,
      versionIndex: Number(t.versionIndex),
      fullName: t.fullName,
      endorsementCount: t.endorsementCount,
    });
  }, []);

  const closeEndorse = useCallback(() => setTarget(null), []);

  const value = useMemo<EndorseModalContextValue>(
    () => ({ openEndorse, closeEndorse }),
    [openEndorse, closeEndorse],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <EndorseCompactModal
        isOpen={!!target}
        onClose={closeEndorse}
        personHash={target?.personHash || ""}
        versionIndex={target?.versionIndex || 1}
        versionData={{
          fullName: target?.fullName,
          endorsementCount: target?.endorsementCount,
        }}
        onSuccess={() => {
          if (!target) return;
          bumpEndorsementCount?.(target.personHash, target.versionIndex, 1);
        }}
      />
    </Ctx.Provider>
  );
}

export function useEndorseModal() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useEndorseModal must be used within EndorseModalProvider");
  return ctx;
}
