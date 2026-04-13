import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useTreeGraphData, useTreeMutations } from "../../tree/context";
import NodeDetailModal from "./NodeDetailModal";
import { type NodeData } from "../../../shared/model";
import { usePersonDetails, useNFTDetails, useStoryData } from "../queries";
import {
  resolveNodeDetailTokenId,
  resolveSelectedNodeData,
  type NodeKeyMinimal,
} from "../model/nodeDetailSync";

export type { NodeKeyMinimal } from "../model/nodeDetailSync";

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

export function NodeDetailProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<NodeKeyMinimal | null>(null);
  const { nodesData } = useTreeGraphData();
  const { mergeNodeDetail } = useTreeMutations();

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
      />
    </NodeDetailProviderContext.Provider>
  );
}

export function useNodeDetail() {
  const nodeDetail = useContext(NodeDetailProviderContext);
  if (!nodeDetail) throw new Error("useNodeDetail must be used within NodeDetailProvider");
  return nodeDetail;
}
