import React, { createContext, useContext } from "react";

export type TreeNodeTarget = {
  personHash: string;
  versionIndex: number;
};

export type TreeEndorseTarget = TreeNodeTarget & {
  fullName?: string;
  endorsementCount?: number;
};

export interface TreeInteractionValue {
  selectedNode: TreeNodeTarget | null;
  openNode: (target: TreeNodeTarget) => void;
  openEndorse: (target: TreeEndorseTarget) => void;
  copyHash: (personHash: string) => void;
}

const TreeInteractionContext = createContext<TreeInteractionValue | null>(null);

export function TreeInteractionProvider({
  value,
  children,
}: {
  value: TreeInteractionValue;
  children: React.ReactNode;
}) {
  return (
    <TreeInteractionContext.Provider value={value}>{children}</TreeInteractionContext.Provider>
  );
}

export function useTreeInteraction() {
  const interaction = useContext(TreeInteractionContext);
  if (!interaction) {
    throw new Error("useTreeInteraction must be used within TreeInteractionProvider");
  }
  return interaction;
}
