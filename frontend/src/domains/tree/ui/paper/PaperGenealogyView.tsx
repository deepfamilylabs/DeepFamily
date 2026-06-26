import type { CSSProperties, ReactElement } from "react";
import type { NodeData, NodeId } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import { PaperEmptyState } from "./PaperEmptyState";
import { PAPER_GENEALOGY_STYLE, type PaperGenealogyStyle } from "./paperData";
import { LineageBookRenderer } from "./renderers/LineageBookRenderer";
import { ModernBookRenderer } from "./renderers/ModernBookRenderer";
import { OuBookRenderer } from "./renderers/OuBookRenderer";
import { SuBookRenderer } from "./renderers/SuBookRenderer";
import { DiejiBookRenderer } from "./renderers/DiejiBookRenderer";
import { usePaperGenealogyViewModel } from "./usePaperGenealogyViewModel";

export interface PaperGenealogyViewProps {
  style: PaperGenealogyStyle;
  graph: TreeGraphData;
  rootId: NodeId | null;
  nodesData: Record<string, NodeData>;
  spouseLinks?: Map<NodeId, NodeId[]>;
  hasRoot: boolean;
  loading?: boolean;
  contractMessage?: string;
  // User-provided spine title; when blank, each renderer falls back to its auto-generated title.
  spineTitleOverride?: string;
  // Composed --df-paper-* variables for the active appearance (color theme / font / texture). When
  // omitted, renderers fall back to the default PAPER_VARS.
  paperVars?: CSSProperties;
  // User-provided hall name (堂号); when blank, the spine uses the default i18n hall name.
  hallName?: string;
}

type PaperGenealogyViewModel = ReturnType<typeof usePaperGenealogyViewModel>;

const PAPER_BOOK_RENDERERS = {
  [PAPER_GENEALOGY_STYLE.OU]: (vm) => (
    <OuBookRenderer
      generations={vm.generations}
      t={vm.translate}
      spineTitleOverride={vm.spineTitleOverride}
      paperVars={vm.paperVars}
      hallName={vm.hallName}
    />
  ),
  [PAPER_GENEALOGY_STYLE.SU]: (vm) => (
    <SuBookRenderer
      graph={vm.graph}
      rootId={vm.rootId}
      generations={vm.generations}
      t={vm.translate}
      spineTitleOverride={vm.spineTitleOverride}
      paperVars={vm.paperVars}
      hallName={vm.hallName}
    />
  ),
  [PAPER_GENEALOGY_STYLE.DIEJI]: (vm) => (
    <DiejiBookRenderer
      generations={vm.generations}
      t={vm.translate}
      spineTitleOverride={vm.spineTitleOverride}
      paperVars={vm.paperVars}
      hallName={vm.hallName}
    />
  ),
  [PAPER_GENEALOGY_STYLE.LINEAGE]: (vm) => (
    <LineageBookRenderer
      graph={vm.graph}
      rootId={vm.rootId}
      generations={vm.generations}
      t={vm.translate}
      spineTitleOverride={vm.spineTitleOverride}
      paperVars={vm.paperVars}
      hallName={vm.hallName}
    />
  ),
  [PAPER_GENEALOGY_STYLE.MODERN]: (vm) => (
    <ModernBookRenderer
      generations={vm.generations}
      t={vm.translate}
      spineTitleOverride={vm.spineTitleOverride}
      paperVars={vm.paperVars}
      hallName={vm.hallName}
    />
  ),
} satisfies Record<PaperGenealogyStyle, (vm: PaperGenealogyViewModel) => ReactElement>;

export function PaperGenealogyView(props: PaperGenealogyViewProps) {
  const vm = usePaperGenealogyViewModel(props);

  if (vm.isEmpty) {
    return (
      <PaperEmptyState
        loading={vm.loading}
        contractMessage={vm.contractMessage}
        paperVars={vm.paperVars}
      />
    );
  }

  return (
    <div className="h-full w-full" data-testid="paper-genealogy-view" data-style={props.style}>
      {PAPER_BOOK_RENDERERS[props.style](vm)}
    </div>
  );
}

export default PaperGenealogyView;
