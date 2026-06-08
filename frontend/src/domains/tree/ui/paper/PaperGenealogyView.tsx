import type { ReactElement } from "react";
import type { NodeData, NodeId } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import { PaperEmptyState } from "./PaperEmptyState";
import { PAPER_GENEALOGY_STYLE, type PaperGenealogyStyle } from "./paperData";
import { LineageBookRenderer } from "./renderers/LineageBookRenderer";
import { ModernBookRenderer } from "./renderers/ModernBookRenderer";
import { OuBookRenderer } from "./renderers/OuBookRenderer";
import { PagodaBookRenderer } from "./renderers/PagodaBookRenderer";
import { SuBookRenderer } from "./renderers/SuBookRenderer";
import { DiejiBookRenderer } from "./renderers/DiejiBookRenderer";
import { usePaperGenealogyViewModel } from "./usePaperGenealogyViewModel";

export interface PaperGenealogyViewProps {
  style: PaperGenealogyStyle;
  graph: TreeGraphData;
  rootId: NodeId | null;
  nodesData: Record<string, NodeData>;
  hasRoot: boolean;
  loading?: boolean;
  contractMessage?: string;
}

type PaperGenealogyViewModel = ReturnType<typeof usePaperGenealogyViewModel>;

const PAPER_BOOK_RENDERERS = {
  [PAPER_GENEALOGY_STYLE.OU]: (vm) => (
    <OuBookRenderer generations={vm.generations} t={vm.translate} />
  ),
  [PAPER_GENEALOGY_STYLE.SU]: (vm) => (
    <SuBookRenderer
      graph={vm.graph}
      rootId={vm.rootId}
      generations={vm.generations}
      t={vm.translate}
    />
  ),
  [PAPER_GENEALOGY_STYLE.DIEJI]: (vm) => (
    <DiejiBookRenderer generations={vm.generations} t={vm.translate} />
  ),
  [PAPER_GENEALOGY_STYLE.PAGODA]: (vm) => (
    <PagodaBookRenderer
      graph={vm.graph}
      rootId={vm.rootId}
      generations={vm.generations}
      t={vm.translate}
    />
  ),
  [PAPER_GENEALOGY_STYLE.LINEAGE]: (vm) => (
    <LineageBookRenderer
      graph={vm.graph}
      rootId={vm.rootId}
      generations={vm.generations}
      t={vm.translate}
    />
  ),
  [PAPER_GENEALOGY_STYLE.MODERN]: (vm) => (
    <ModernBookRenderer generations={vm.generations} t={vm.translate} />
  ),
} satisfies Record<PaperGenealogyStyle, (vm: PaperGenealogyViewModel) => ReactElement>;

export function PaperGenealogyView(props: PaperGenealogyViewProps) {
  const vm = usePaperGenealogyViewModel(props);

  if (vm.isEmpty) {
    return <PaperEmptyState loading={vm.loading} contractMessage={vm.contractMessage} />;
  }

  return (
    <div className="h-full w-full" data-testid="paper-genealogy-view" data-style={props.style}>
      {PAPER_BOOK_RENDERERS[props.style](vm)}
    </div>
  );
}

export default PaperGenealogyView;
