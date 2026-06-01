import type { NodeData, NodeId } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import { PaperEmptyState } from "./PaperEmptyState";
import type { PaperGenealogyStyle } from "./paperData";
import { LineageBookRenderer } from "./renderers/LineageBookRenderer";
import { ModernBookRenderer } from "./renderers/ModernBookRenderer";
import { OuBookRenderer } from "./renderers/OuBookRenderer";
import { PagodaBookRenderer } from "./renderers/PagodaBookRenderer";
import { SuBookRenderer } from "./renderers/SuBookRenderer";
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

export function PaperGenealogyView(props: PaperGenealogyViewProps) {
  const vm = usePaperGenealogyViewModel(props);

  if (vm.isEmpty) {
    return <PaperEmptyState loading={vm.loading} contractMessage={vm.contractMessage} />;
  }

  return (
    <div className="h-full w-full" data-testid="paper-genealogy-view" data-style={props.style}>
      {props.style === "ou" ? (
        <OuBookRenderer generations={vm.generations} t={vm.translate} />
      ) : props.style === "su" ? (
        <SuBookRenderer generations={vm.generations} t={vm.translate} />
      ) : props.style === "pagoda" ? (
        <PagodaBookRenderer
          graph={vm.graph}
          rootId={vm.rootId}
          generations={vm.generations}
          t={vm.translate}
        />
      ) : props.style === "lineage" ? (
        <LineageBookRenderer
          graph={vm.graph}
          rootId={vm.rootId}
          generations={vm.generations}
          t={vm.translate}
        />
      ) : props.style === "modern" ? (
        <ModernBookRenderer generations={vm.generations} t={vm.translate} />
      ) : null}
    </div>
  );
}

export default PaperGenealogyView;
