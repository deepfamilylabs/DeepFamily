import type { NodeId } from "../../../shared/model";

export interface FamilyTreeViewHandle {
  centerOnNode: (id: NodeId) => void;
}
