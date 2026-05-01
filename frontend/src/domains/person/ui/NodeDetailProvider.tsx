import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import NodeDetailModal from "./NodeDetailModal";
import {
  resolveNodeDetailTokenId,
  resolveSelectedNodeData,
  type NodeData,
  type NodeKeyMinimal,
  type StoryDataResult,
} from "../../../shared/model";
import type { ParsedNftDetails, ParsedVersionDetails } from "../api/personReadGateway";
import { usePersonDetails, useNFTDetails, useStoryData } from "../queries";

export type { NodeKeyMinimal } from "../../../shared/model";

interface NodeDetailValue {
  open: boolean;
  selected: NodeKeyMinimal | null;
  selectedNodeData: NodeData | null;
  loading: boolean;
  error: string | null;
  openNode: (k: NodeKeyMinimal) => void;
  close: () => void;
}

const NodeDetailProviderContext = createContext<NodeDetailValue | undefined>(undefined);

export interface NodeDetailProviderProps {
  children: React.ReactNode;
  nodesData: Record<string, NodeData>;
  getOwnerOf?: (tokenId: string) => Promise<string | null | undefined>;
  mergeNodeDetail: (
    selected: NodeKeyMinimal,
    details: {
      versionDetails?: ParsedVersionDetails | null;
      nftDetails?: { tokenId: string; parsed: ParsedNftDetails } | null;
      storyData?: StoryDataResult | null;
    },
  ) => void;
}

export function NodeDetailProvider({
  children,
  nodesData,
  getOwnerOf,
  mergeNodeDetail,
}: NodeDetailProviderProps) {
  const [selected, setSelected] = useState<NodeKeyMinimal | null>(null);

  const openNode = useCallback((k: NodeKeyMinimal) => {
    setSelected(k);
  }, []);
  const close = useCallback(() => {
    setSelected(null);
  }, []);

  const selectedNodeData = resolveSelectedNodeData(nodesData, selected);

  const versionDetails = usePersonDetails(
    selected?.personHash ?? null,
    selected?.versionIndex ?? null,
  );

  const effectiveTokenId = resolveNodeDetailTokenId(
    versionDetails.data?.tokenId,
    selectedNodeData?.tokenId,
  );

  const nftDetails = useNFTDetails(effectiveTokenId);
  const storyData = useStoryData(effectiveTokenId);

  useEffect(() => {
    if (!selected || !versionDetails.data) return;
    mergeNodeDetail(selected, { versionDetails: versionDetails.data });
  }, [selected, versionDetails.data, mergeNodeDetail]);

  useEffect(() => {
    if (!selected || !effectiveTokenId || !nftDetails.data) return;
    mergeNodeDetail(selected, {
      nftDetails: { tokenId: String(effectiveTokenId), parsed: nftDetails.data },
      storyData: storyData.data,
    });
  }, [selected, effectiveTokenId, nftDetails.data, storyData.data, mergeNodeDetail]);

  const loading = versionDetails.loading || nftDetails.loading || storyData.loading;
  const error = versionDetails.error || nftDetails.error || storyData.error;

  return (
    <NodeDetailProviderContext.Provider
      value={{ open: !!selected, selected, selectedNodeData, loading, error, openNode, close }}
    >
      {children}
      <NodeDetailModal
        open={!!selected}
        onClose={close}
        nodeData={selectedNodeData}
        fallback={{ hash: selected?.personHash || "", versionIndex: selected?.versionIndex }}
        loading={loading}
        error={error}
        getOwnerOf={getOwnerOf}
      />
    </NodeDetailProviderContext.Provider>
  );
}

export function useNodeDetail() {
  const nodeDetail = useContext(NodeDetailProviderContext);
  if (!nodeDetail) throw new Error("useNodeDetail must be used within NodeDetailProvider");
  return nodeDetail;
}
