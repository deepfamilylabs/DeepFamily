import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import EndorseCompactModal from "./EndorseCompactModal";
import { useTreeMutations } from "../../tree/context";

export type EndorseTarget = {
  personHash: string;
  versionIndex: number;
  fullName?: string;
  endorsementCount?: number;
};

type EndorseModalValue = {
  openEndorse: (t: EndorseTarget) => void;
  closeEndorse: () => void;
};

const EndorseModalProviderContext = createContext<EndorseModalValue | null>(null);

export function EndorseModalProvider({ children }: { children: React.ReactNode }) {
  const { bumpEndorsementCount } = useTreeMutations();
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

  const value = useMemo<EndorseModalValue>(
    () => ({ openEndorse, closeEndorse }),
    [openEndorse, closeEndorse],
  );

  return (
    <EndorseModalProviderContext.Provider value={value}>
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
    </EndorseModalProviderContext.Provider>
  );
}

export function useEndorseModal() {
  const endorseModal = useContext(EndorseModalProviderContext);
  if (!endorseModal) {
    throw new Error("useEndorseModal must be used within EndorseModalProvider");
  }
  return endorseModal;
}
