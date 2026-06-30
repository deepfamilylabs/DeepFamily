import { useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { NodeData, NodeId } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import { buildPaperGenerations, type PaperGeneration, type TranslateFn } from "./paperData";

export interface UsePaperGenealogyViewModelParams {
  graph: TreeGraphData;
  rootId: NodeId | null;
  nodesData: Record<string, NodeData>;
  spouseLinks?: Map<NodeId, NodeId[]>;
  hasRoot: boolean;
  loading?: boolean;
  contractMessage?: string;
  spineTitleOverride?: string;
  paperVars?: CSSProperties;
  hallName?: string;
  fontScale?: number;
  coverEnabled?: boolean;
  coverInscription?: string;
}

export interface PaperGenealogyViewModel {
  graph: TreeGraphData;
  rootId: NodeId | null;
  generations: PaperGeneration[];
  translate: TranslateFn;
  isEmpty: boolean;
  loading?: boolean;
  contractMessage?: string;
  spineTitleOverride?: string;
  paperVars?: CSSProperties;
  hallName?: string;
  fontScale?: number;
  coverEnabled?: boolean;
  coverInscription?: string;
}

export function usePaperGenealogyViewModel(
  params: UsePaperGenealogyViewModelParams,
): PaperGenealogyViewModel {
  const {
    graph,
    rootId,
    nodesData,
    spouseLinks,
    hasRoot,
    loading,
    contractMessage,
    spineTitleOverride,
    paperVars,
    hallName,
    fontScale,
    coverEnabled,
    coverInscription,
  } = params;
  const { t } = useTranslation();
  const translate = useCallback<TranslateFn>(
    (key, fallback, options) =>
      t(key, {
        defaultValue: fallback,
        ...(options || {}),
      }),
    [t],
  );
  const generations = useMemo(
    () => buildPaperGenerations({ graph, nodesData, spouseLinks, t: translate }),
    [graph, nodesData, spouseLinks, translate],
  );

  return {
    graph,
    rootId,
    generations,
    translate,
    isEmpty: !hasRoot || generations.length === 0,
    loading,
    contractMessage,
    spineTitleOverride,
    paperVars,
    hallName,
    fontScale,
    coverEnabled,
    coverInscription,
  };
}
