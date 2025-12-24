import type { NodeData, NodeId } from "../types/graph";
import { birthDateString, isMinted, parseNodeId, shortHash } from "../types/graph";

export type NodeUi = {
  id: NodeId;
  personHash: string;
  versionIndex: number;

  minted: boolean;
  shortHashText: string;
  titleText: string;
  versionText: string;
  versionTextWithTotal: string;

  tagText?: string;
  endorsementCount?: number;
  totalVersions?: number;
  fullName?: string;
  gender?: number;
  birthPlace?: string;
  birthDateText?: string;
};

export function getNodeUi(id: NodeId, nodesData: Record<string, NodeData>): NodeUi {
  const parsed = parseNodeId(id);
  const nd = nodesData?.[id];
  const minted = isMinted(nd);
  const shortHashText = shortHash(parsed.personHash);
  const fullName = nd?.fullName;
  const titleText = minted && fullName ? fullName : shortHashText;
  const versionText = `v${parsed.versionIndex}`;
  const totalVersions = nd?.totalVersions;
  const versionTextWithTotal =
    typeof totalVersions === "number" && totalVersions > 1
      ? `T${totalVersions}:v${parsed.versionIndex}`
      : versionText;

  return {
    id,
    personHash: parsed.personHash,
    versionIndex: parsed.versionIndex,
    minted,
    shortHashText,
    titleText,
    versionText,
    versionTextWithTotal,
    tagText: nd?.tag,
    endorsementCount: nd?.endorsementCount,
    totalVersions,
    fullName,
    gender: nd?.gender,
    birthPlace: nd?.birthPlace,
    birthDateText: minted ? birthDateString(nd) : undefined,
  };
}
