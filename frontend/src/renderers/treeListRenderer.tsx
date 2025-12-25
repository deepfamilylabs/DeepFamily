import React, { useCallback } from "react";
import {
  FixedSizeList as VirtualList,
  type FixedSizeList as VirtualListHandle,
  type ListChildComponentProps,
} from "react-window";
import type { NodeId } from "../types/graph";
import type { TreeRow } from "../utils/treeData";
import type { NodeUi } from "../utils/familyTreeNodeUi";
import TreeListRowRenderer from "./treeListRowRenderer";

export default function TreeListRenderer(props: {
  height: number | string;
  rowHeight: number;
  rows: TreeRow[];
  expanded: Set<NodeId>;
  toggle: (nodeId: NodeId) => void;
  selectedKey: NodeId | null;
  nodeUiById: Record<NodeId, NodeUi>;
  openNodeById: (id: NodeId) => void;
  openEndorseById: (id: NodeId) => void;
  listRef?: React.Ref<VirtualListHandle>;
}) {
  const {
    height,
    rowHeight,
    rows,
    expanded,
    toggle,
    selectedKey,
    nodeUiById,
    openNodeById,
    openEndorseById,
    listRef,
  } = props;

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      return (
        <TreeListRowRenderer
          index={index}
          style={style}
          rows={rows}
          expanded={expanded}
          toggle={toggle}
          rowHeight={rowHeight}
          selectedKey={selectedKey}
          nodeUiById={nodeUiById}
          openNodeById={openNodeById}
          openEndorseById={openEndorseById}
        />
      );
    },
    [expanded, nodeUiById, openEndorseById, openNodeById, rowHeight, rows, selectedKey, toggle],
  );

  return (
    <div className="w-full h-full transition-all duration-300 overflow-hidden">
      <div className="p-4 h-full overflow-x-auto">
        <VirtualList
          ref={listRef as any}
          height={typeof height === 'number' ? height - 32 : 600} // Fallback if string, but ideally we use AutoSizer
          itemCount={rows.length}
          itemSize={rowHeight}
          width={"100%"}
          className="w-full"
        >
          {Row}
        </VirtualList>
      </div>
    </div>
  );
}
