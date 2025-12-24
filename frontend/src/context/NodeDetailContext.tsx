import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useTreeData } from "./TreeDataContext";
import NodeDetailModal from "../components/NodeDetailModal";
import { NodeData, makeNodeId } from "../types/graph";
import { ethers } from "ethers";
import DeepFamily from "../abi/DeepFamily.json";
import { useConfig } from "./ConfigContext";
import { makeProvider } from "../utils/provider";
import { createDeepFamilyApi } from "../utils/deepFamilyApi";
import { QueryCache } from "../utils/queryCache";

export interface NodeKeyMinimal {
  personHash: string;
  versionIndex: number;
}

const env: any = (import.meta as any).env || {};
const VERSION_DETAILS_TTL_MS = Number(env.VITE_DF_VD_TTL_MS || 300_000);
const NFT_DETAILS_TTL_MS = Number(env.VITE_DF_NFT_TTL_MS || 86_400_000);
const STORY_TTL_MS = Number(env.VITE_DF_STORY_TTL_MS || 300_000);
const isStale = (fetchedAt?: number, ttlMs?: number) => {
  if (!Number.isFinite(fetchedAt)) return true;
  const ttl = Number(ttlMs ?? 0);
  if (ttl <= 0) return false;
  return Date.now() - Number(fetchedAt) > ttl;
};

interface NodeDetailState {
  open: boolean;
  selected: NodeKeyMinimal | null;
  selectedNodeData: NodeData | null;
  loading: boolean;
  error: string | null;
  openNode: (k: NodeKeyMinimal) => void;
  close: () => void;
}

const Ctx = createContext<NodeDetailState | undefined>(undefined);

export function NodeDetailProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<NodeKeyMinimal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { nodesData, setNodesData, getStoryData } = useTreeData() as any;
  const { rpcUrl, contractAddress, chainId } = useConfig();
  const queryCacheRef = useRef(new QueryCache());

  const openNode = useCallback((k: NodeKeyMinimal) => {
    setSelected(k);
  }, []);
  const close = useCallback(() => {
    setSelected(null);
  }, []);

  const selectedNodeData = selected
    ? nodesData?.[makeNodeId(selected.personHash, selected.versionIndex)] || null
    : null;

  useEffect(() => {
    if (!selected) {
      setError(null);
      setLoading(false);
      return;
    }
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    if (!rpcUrl || !contractAddress || !setNodesData) return;
    let cancelled = false;
    const run = async () => {
      const id = makeNodeId(selected.personHash, selected.versionIndex);
      const nd = nodesData?.[id];
      const needVersion =
        !nd ||
        nd.addedBy === undefined ||
        nd.fatherHash === undefined ||
        nd.metadataCID === undefined;
      const provider = makeProvider(rpcUrl, chainId);
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider);
      const api = createDeepFamilyApi(contract, queryCacheRef.current);
      try {
        setLoading(true);
        setError(null);
        let tokenId: string | undefined = nd?.tokenId;
        if (needVersion) {
          const ret = await api.getVersionDetails(selected.personHash, selected.versionIndex, {
            ttlMs: VERSION_DETAILS_TTL_MS,
          });
          tokenId = ret.tokenId;
          const versionFields = ret.version;
          const endorsementCount = ret.endorsementCount;
          if (!cancelled)
            setNodesData((prev: any) =>
              prev[id]
                ? {
                    ...prev,
                    [id]: {
                      ...prev[id],
                      fatherHash: versionFields.fatherHash,
                      motherHash: versionFields.motherHash,
                      fatherVersionIndex: versionFields.fatherVersionIndex ?? 0,
                      motherVersionIndex: versionFields.motherVersionIndex ?? 0,
                      addedBy: versionFields.addedBy,
                      timestamp: versionFields.timestamp,
                      tag: versionFields.tag || prev[id].tag,
                      metadataCID: versionFields.metadataCID,
                      endorsementCount,
                      tokenId,
                    },
                  }
                : prev,
            );
        }
        const ndAfter = () => nodesData?.[id];
        await Promise.resolve();
        const ndCur = ndAfter();
        const effectiveTokenId = tokenId || ndCur?.tokenId;
        const needNFT =
          effectiveTokenId &&
          effectiveTokenId !== "0" &&
          (!ndCur ||
            ndCur.fullName === undefined ||
            ndCur.nftTokenURI === undefined ||
            ndCur.story === undefined);
        if (needNFT) {
          const nftRet = await api.getNFTDetails(effectiveTokenId, { ttlMs: NFT_DETAILS_TTL_MS });
          const versionFields = nftRet.version;
          const coreFields = nftRet.core;
          const endorsementCount2 = nftRet.endorsementCount;
          const nftTokenURI = nftRet.nftTokenURI;

          let storyMetadata = ndCur?.storyMetadata ?? null;
          let storyChunks = Array.isArray(ndCur?.storyChunks) ? (ndCur?.storyChunks as any) : null;
          let storyFetchedAt = ndCur?.storyFetchedAt;
          const needStory = !!(
            effectiveTokenId &&
            effectiveTokenId !== "0" &&
            (!storyMetadata || !Array.isArray(storyChunks) || isStale(storyFetchedAt, STORY_TTL_MS))
          );
          if (needStory && typeof getStoryData === "function") {
            try {
              const storyRet = await getStoryData(String(effectiveTokenId), { nodeIdHint: id });
              if (storyRet?.metadata && Array.isArray(storyRet?.chunks)) {
                storyMetadata = storyRet.metadata;
                storyChunks = storyRet.chunks;
              }
              if (Number.isFinite(storyRet?.fetchedAt) && Number(storyRet.fetchedAt) > 0) {
                storyFetchedAt = Number(storyRet.fetchedAt);
              }
            } catch (e) {
              console.warn("Failed to fetch story chunks:", e);
            }
          }

          if (!cancelled)
            setNodesData((prev: any) =>
              prev[id]
                ? {
                    ...prev,
                    [id]: {
                      ...prev[id],
                      fatherHash: versionFields.fatherHash,
                      motherHash: versionFields.motherHash,
                      fatherVersionIndex: versionFields.fatherVersionIndex ?? 0,
                      motherVersionIndex: versionFields.motherVersionIndex ?? 0,
                      addedBy: versionFields.addedBy,
                      timestamp: versionFields.timestamp,
                      tag: versionFields.tag || prev[id].tag,
                      metadataCID: versionFields.metadataCID,
                      endorsementCount: endorsementCount2 ?? prev[id].endorsementCount,
                      tokenId: effectiveTokenId,
                      fullName: coreFields.fullName,
                      gender: coreFields.gender,
                      birthYear: coreFields.birthYear,
                      birthMonth: coreFields.birthMonth,
                      birthDay: coreFields.birthDay,
                      birthPlace: coreFields.birthPlace,
                      isBirthBC: coreFields.isBirthBC,
                      deathYear: coreFields.deathYear,
                      deathMonth: coreFields.deathMonth,
                      deathDay: coreFields.deathDay,
                      deathPlace: coreFields.deathPlace,
                      isDeathBC: coreFields.isDeathBC,
                      story: coreFields.story,
                      nftTokenURI,
                      storyMetadata,
                      storyChunks,
                      storyFetchedAt,
                    },
                  }
                : prev,
            );
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rpcUrl, contractAddress, chainId]);
  return (
    <Ctx.Provider
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
    </Ctx.Provider>
  );
}

export function useNodeDetail() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNodeDetail must be used within NodeDetailProvider");
  return ctx;
}
