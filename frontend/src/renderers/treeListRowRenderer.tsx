import React from "react";
import type { ListChildComponentProps } from "react-window";
import type { NodeId } from "../types/graph";
import { getGenderColor } from "../constants/genderColors";
import { getFamilyTreeNodeTheme } from "../utils/familyTreeTheme";
import type { TreeRow } from "../utils/treeData";
import type { NodeUi } from "../utils/familyTreeNodeUi";

export default function TreeListRowRenderer(
  props: Omit<ListChildComponentProps<any>, "data"> & {
    rows: TreeRow[];
    expanded: Set<NodeId>;
    toggle: (nodeId: NodeId) => void;
    rowHeight: number;
    selectedKey: NodeId | null;
    nodeUiById: Record<NodeId, NodeUi>;
    openNodeById: (id: NodeId) => void;
    openEndorseById: (id: NodeId) => void;
    themeName?: string;
  },
) {
  const {
    index,
    style,
    rows,
    expanded,
    toggle,
    rowHeight,
    selectedKey,
    nodeUiById,
    openNodeById,
    openEndorseById,
    themeName,
  } = props;
  const row = rows[index];
  const { nodeId, depth, isLast, hasChildren } = row;
  const isOpen = expanded.has(nodeId);
  const ui = nodeUiById[nodeId];
  const endorse = ui.endorsementCount;
  const mintedFlag = ui.minted;
  const gender = ui.gender as number | undefined;
  const isSel = selectedKey === nodeId;

  const theme = getFamilyTreeNodeTheme({ minted: mintedFlag, selected: isSel, themeName });

  const ancestorGuides: boolean[] = [];
  if (depth > 0) {
    let currentDepth = depth - 1;
    for (let i = index - 1; i >= 0 && currentDepth >= 0; i--) {
      const r = rows[i];
      if (r.depth === currentDepth) {
        ancestorGuides[currentDepth] = !r.isLast;
        currentDepth--;
      }
    }
  }

  const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement)?.closest?.('[data-endorse-btn="true"]')) return;
    openNodeById(nodeId);
  };

  const openEndorseModal = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openEndorseById(nodeId);
  };

  return (
    <div
      style={{ ...style }}
      className={`group font-mono text-[12px] flex items-stretch relative ${isSel ? "bg-amber-100 dark:bg-amber-900/40" : ""} hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors cursor-pointer`}
      onClick={handleRowClick}
    >
      <div className="absolute inset-y-0 left-0 flex pointer-events-none">
        {ancestorGuides.map((show, i) =>
          show ? (
            <div key={i} className="w-4 flex-shrink-0 relative">
              <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-slate-300 dark:bg-slate-600" />
            </div>
          ) : (
            <div key={i} className="w-4" />
          ),
        )}
      </div>

      <div
        style={{ paddingLeft: depth * 16 }}
        className="flex items-center gap-1 pl-1 pr-2 min-w-[140px] relative"
        title={ui.personHash}
      >
        <div className="flex items-center">
          {depth > 0 && (
            <div className="relative w-4" style={{ height: rowHeight }}>
              <div className="absolute left-1/2 -translate-x-1/2 top-0 w-px h-1/2 bg-slate-300 dark:bg-slate-600" />
              {!isLast && (
                <div className="absolute left-1/2 -translate-x-1/2 top-1/2 bottom-0 w-px bg-slate-300 dark:bg-slate-600" />
              )}
              <div className="absolute top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 h-px w-1/2 bg-slate-300 dark:bg-slate-600" />
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              hasChildren && toggle(nodeId);
            }}
            className={`mr-1 ${hasChildren ? "w-5 h-5 text-[10px]" : "w-5 h-5 text-lg leading-none"} grid place-items-center rounded border ${hasChildren ? "bg-white dark:bg-gray-800 hover:bg-slate-100 dark:hover:bg-gray-700 border-slate-300 dark:border-gray-600 text-slate-700 dark:text-slate-300" : "border-transparent text-slate-400 dark:text-slate-500 cursor-default"}`}
          >
            {hasChildren ? (isOpen ? "−" : "+") : "•"}
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap min-w-max">
          <span className={theme.shortHashText.html}>{ui.shortHashText}</span>
          <span className={theme.versionText.html}>{ui.versionTextWithTotal}</span>
          {endorse !== undefined && (
            <button
              type="button"
              data-endorse-btn="true"
              onClick={openEndorseModal}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${mintedFlag ? "hover:bg-emerald-50 dark:hover:bg-emerald-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500" : "hover:bg-slate-100 dark:hover:bg-slate-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"}`}
              title="Endorsements"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                aria-hidden="true"
                className="flex-shrink-0"
              >
                <path
                  d="M10 1.5l2.6 5.3 5.9.9-4.3 4.2 1 5.9L10 15l-5.2 2.8 1-5.9-4.3-4.2 5.9-.9L10 1.5z"
                  className={theme.endorseStarClass}
                />
              </svg>
              <span
                className={`font-mono text-[12px] ${theme.endorseCountText.html}`}
              >
                {endorse}
              </span>
            </button>
          )}
          {mintedFlag && (
            <>
              <span className={`text-[10px] px-1 rounded ${theme.tagBadgeBgClass.replace("fill-", "bg-")} ${theme.tagBadgeText.html} border border-emerald-300 dark:border-emerald-700/40`}>
                NFT
              </span>
              <span
                className={`ml-1 inline-block w-2 h-2 rounded-full ${getGenderColor(gender, "BG")} ring-1 ring-white dark:ring-slate-900`}
              />
            </>
          )}
          {ui.fullName && (
            <span
              className="text-slate-700 dark:text-slate-200 text-[12px] truncate max-w-[180px]"
              title={ui.fullName}
            >
              {ui.fullName}
            </span>
          )}
          {ui.tagText && (
            <span
              className={`text-xs ${theme.tagBadgeText.html} ${theme.tagBadgeBgClass.replace("fill-", "bg-")} border border-blue-200 dark:border-blue-700/40 px-1 rounded`}
              title={ui.tagText}
            >
              {ui.tagText}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
