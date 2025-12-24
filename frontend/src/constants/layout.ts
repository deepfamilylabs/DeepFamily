// Layout constants for consistent UI sizing
import React from "react";

export const LAYOUT = {
  // FamilyTree view dimensions - responsive heights
  FAMILLY_TREE_HEIGHT_MOBILE: 520,
  FAMILLY_TREE_HEIGHT_DESKTOP: 680,

  // TreeLayout view (SVG cards)
  TREE_NODE_WIDTH: 112,
  TREE_NODE_HEIGHT: 160,
  TREE_GAP_X: 24,
  TREE_GAP_Y: 220,
  TREE_MARGIN_X: 24,
  TREE_MARGIN_Y: 0,

  // Dag view (SVG)
  DAG_NODE_WIDTH: 200,
  DAG_NODE_HEIGHT: 120,
  DAG_MAX_NODE_WIDTH: 168,

  // Force view (d3-force SVG)
  FORCE_DRAW_NODE_R: 12,
  FORCE_COLLIDE_NODE_R: 15,
  FORCE_VIEWBOX_WIDTH: 800,
  FORCE_MINIMAP_WIDTH: 120,
  FORCE_MINIMAP_HEIGHT: 90,

  // Virtualized list
  ROW_HEIGHT: 40,
} as const;

export type FamilyTreeLayout = { [K in keyof typeof LAYOUT]: number };
export type FamilyTreeLayoutOverrides = Partial<FamilyTreeLayout>;

// Utility function to get responsive familyTree height
export const getFamilyTreeHeight = (
  layout: Pick<
    FamilyTreeLayout,
    "FAMILLY_TREE_HEIGHT_MOBILE" | "FAMILLY_TREE_HEIGHT_DESKTOP"
  > = LAYOUT,
) => {
  if (typeof window === "undefined") return layout.FAMILLY_TREE_HEIGHT_DESKTOP;
  return window.innerWidth < 768
    ? layout.FAMILLY_TREE_HEIGHT_MOBILE
    : layout.FAMILLY_TREE_HEIGHT_DESKTOP;
};

// React hook for responsive familyTree height
export const useFamilyTreeHeight = (
  layout: Pick<
    FamilyTreeLayout,
    "FAMILLY_TREE_HEIGHT_MOBILE" | "FAMILLY_TREE_HEIGHT_DESKTOP"
  > = LAYOUT,
) => {
  const [height, setHeight] = React.useState(() => getFamilyTreeHeight(layout));

  React.useEffect(() => {
    const updateHeight = () => setHeight(getFamilyTreeHeight(layout));
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [layout]);

  return height;
};
