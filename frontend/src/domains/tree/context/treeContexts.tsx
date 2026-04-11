import React, { createContext, useContext } from "react";
import type { NodeData, NodeId } from "../../../types/graph";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../../../types/treeStore";
import type { TreeTxInvalidationInput } from "../services/treeInvalidation";
import type { TreeDebugStats, TreeProgress } from "./types";

export interface TreeGraphDataValue {
  rootId: NodeId | null;
  rootExists: boolean;
  reachableNodeIds: NodeId[];
  endorsementsReady: boolean;
  nodesData: Record<string, NodeData>;
  edgesUnion: EdgeStoreUnion;
  edgesStrict: EdgeStoreStrict;
}

export interface TreeStatusValue {
  loading: boolean;
  progress?: TreeProgress;
  contractMessage: string;
  refresh: () => void;
  invalidateTreeRootCache: () => void;
  errors: Array<unknown>;
  clearAllCaches: () => void;
}

export interface TreeNodeAccessValue {
  getStoryData: (tokenId: string, opts?: { nodeIdHint?: string }) => Promise<any>;
  preloadStoryData: (tokenId: string) => void;
  getNodeByTokenId: (tokenId: string) => Promise<NodeData | null>;
  getOwnerOf: (tokenId: string) => Promise<string | null>;
}

export interface TreeMutationsValue {
  setNodesData?: React.Dispatch<React.SetStateAction<Record<string, NodeData>>>;
  clearAllCaches: () => void;
  bumpEndorsementCount: (personHash: string, versionIndex: number, delta?: number) => void;
  invalidateByTx: (input?: TreeTxInvalidationInput | null) => void;
}

export interface TreeDebugValue {
  getDebugStats: () => TreeDebugStats;
}

const TreeGraphDataProviderContext = createContext<TreeGraphDataValue | null>(null);
const TreeStatusProviderContext = createContext<TreeStatusValue | null>(null);
const TreeNodeAccessProviderContext = createContext<TreeNodeAccessValue | null>(null);
const TreeMutationsProviderContext = createContext<TreeMutationsValue | null>(null);
const TreeDebugProviderContext = createContext<TreeDebugValue | null>(null);

export function TreeProviderContexts({
  graph,
  status,
  nodeAccess,
  mutations,
  debug,
  children,
}: {
  graph: TreeGraphDataValue;
  status: TreeStatusValue;
  nodeAccess: TreeNodeAccessValue;
  mutations: TreeMutationsValue;
  debug: TreeDebugValue;
  children: React.ReactNode;
}) {
  return (
    <TreeGraphDataProviderContext.Provider value={graph}>
      <TreeStatusProviderContext.Provider value={status}>
        <TreeNodeAccessProviderContext.Provider value={nodeAccess}>
          <TreeMutationsProviderContext.Provider value={mutations}>
            <TreeDebugProviderContext.Provider value={debug}>{children}</TreeDebugProviderContext.Provider>
          </TreeMutationsProviderContext.Provider>
        </TreeNodeAccessProviderContext.Provider>
      </TreeStatusProviderContext.Provider>
    </TreeGraphDataProviderContext.Provider>
  );
}

function useTreeProviderValue<T>(providerContext: React.Context<T | null>, hookName: string): T {
  const treeValue = useContext(providerContext);
  if (!treeValue) throw new Error(`${hookName} must be used within TreeViewProvider`);
  return treeValue;
}

export function useTreeGraphData() {
  return useTreeProviderValue(TreeGraphDataProviderContext, "useTreeGraphData");
}

export function useTreeStatus() {
  return useTreeProviderValue(TreeStatusProviderContext, "useTreeStatus");
}

export function useTreeNodeAccess() {
  return useTreeProviderValue(TreeNodeAccessProviderContext, "useTreeNodeAccess");
}

export function useTreeMutations() {
  return useTreeProviderValue(TreeMutationsProviderContext, "useTreeMutations");
}

export function useTreeDebugData() {
  return useTreeProviderValue(TreeDebugProviderContext, "useTreeDebugData");
}
