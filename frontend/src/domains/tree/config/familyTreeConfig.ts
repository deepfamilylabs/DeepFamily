export const FAMILY_TREE_CONFIG = {
  DEFAULT_HARD_NODE_LIMIT: Number(
    ((import.meta as any).env || {}).VITE_DF_HARD_NODE_LIMIT || 20000,
  ),
};

export type FamilyTreeConfig = typeof FAMILY_TREE_CONFIG;

// Utility to override via window (for power users / debugging)
export function getRuntimeFamilyTreeConfig(): FamilyTreeConfig {
  if (typeof window === "undefined") return FAMILY_TREE_CONFIG;
  const w: any = window;
  if (!w.__DF_VIS_CONF__) return FAMILY_TREE_CONFIG;
  return { ...FAMILY_TREE_CONFIG, ...w.__DF_VIS_CONF__ };
}
