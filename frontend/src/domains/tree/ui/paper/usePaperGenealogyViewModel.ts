import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { NodeData, NodeId } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import { buildPaperGenerations, type PaperGeneration, type TranslateFn } from "./paperData";

export interface UsePaperGenealogyViewModelParams {
  graph: TreeGraphData;
  rootId: NodeId | null;
  nodesData: Record<string, NodeData>;
  hasRoot: boolean;
  loading?: boolean;
  contractMessage?: string;
}

export interface PaperGenealogyViewModel {
  graph: TreeGraphData;
  rootId: NodeId | null;
  generations: PaperGeneration[];
  translate: TranslateFn;
  isEmpty: boolean;
  loading?: boolean;
  contractMessage?: string;
}

export function usePaperGenealogyViewModel(
  params: UsePaperGenealogyViewModelParams,
): PaperGenealogyViewModel {
  const { graph, rootId, nodesData, hasRoot, loading, contractMessage } = params;
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
    () => buildPaperGenerations({ graph, nodesData, t: translate }),
    [graph, nodesData, translate],
  );

  return {
    graph,
    rootId,
    generations,
    translate,
    isEmpty: !hasRoot || generations.length === 0,
    loading,
    contractMessage,
  };
}
