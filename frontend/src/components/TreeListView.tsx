import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FixedSizeList as VirtualListHandle } from "react-window";
import { type NodeId } from "../types/graph";
import type { TreeRow } from "../utils/treeData";
import { useFamilyTreeViewModel } from "../hooks/useFamilyTreeViewModel";
import TreeListRenderer from "../renderers/treeListRenderer";
import { useFamilyTreeViewConfig } from "../context/FamilyTreeViewConfigContext";
import { noPropsForwardRef } from "../utils/noPropsForwardRef";
import type { FamilyTreeViewHandle } from "../types/familyTreeViewHandle";

const TreeListView = noPropsForwardRef<FamilyTreeViewHandle>((ref) => {
  const { layout, height } = useFamilyTreeViewConfig();
  const rowHeight = layout.ROW_HEIGHT;
  const vm = useFamilyTreeViewModel();
  const { rootId } = vm;
  const { treeListRows } = vm.selectors;
  const { openNodeById, openEndorseById } = vm.actions;
  const selectedKey = vm.selectedId;
  const [expanded, setExpanded] = useState<Set<NodeId>>(() => new Set(rootId ? [rootId] : []));
  const listRef = useRef<VirtualListHandle | null>(null);

  useEffect(() => {
    setExpanded(new Set(rootId ? [rootId] : []));
  }, [rootId]);

  const rows = useMemo<TreeRow[]>(() => {
    if (!rootId) return [];
    return treeListRows(expanded);
  }, [expanded, rootId, treeListRows]);

  const toggle = useCallback((nodeId: NodeId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  if (!rootId) return null;

  useImperativeHandle(
    ref,
    () => ({
      centerOnNode: (id: NodeId) => {
        const index = rows.findIndex((r) => r.nodeId === id);
        if (index < 0) return;
        listRef.current?.scrollToItem?.(index, "center");
      },
    }),
    [rows],
  );

  return (
    <TreeListRenderer
      height={height}
      rowHeight={rowHeight}
      rows={rows}
      expanded={expanded}
      toggle={toggle}
      selectedKey={selectedKey}
      nodeUiById={vm.nodeUiById}
      openNodeById={openNodeById}
      openEndorseById={openEndorseById}
      listRef={listRef}
    />
  );
});

export default TreeListView;
