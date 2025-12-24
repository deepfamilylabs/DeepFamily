import type { NodeId } from "./graph";

export interface FamilyTreeViewHandle {
  centerOnNode: (id: NodeId) => void;
}
