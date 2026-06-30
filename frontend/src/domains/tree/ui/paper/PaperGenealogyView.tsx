import type { CSSProperties, ReactElement } from "react";
import type { NodeData, NodeId } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import { PaperEmptyState } from "./PaperEmptyState";
import { PAPER_GENEALOGY_STYLE, type PaperGenealogyStyle } from "./paperData";
import type { PaperBackCoverMode, PaperCoverStyleId } from "./paperAppearance";
import { LineageBookRenderer } from "./renderers/LineageBookRenderer";
import { ModernBookRenderer } from "./renderers/ModernBookRenderer";
import { OuBookRenderer } from "./renderers/OuBookRenderer";
import { PaperCover } from "./renderers/PaperCover";
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
  // Whole-sheet preview zoom multiplier; applied on each renderer's content layer. Omitted → 1.
  fontScale?: number;
  // Book-edge margin (in spread px) shown around each leaf in the preview AND added to the exported
  // PDF, so the setting is WYSIWYG. Published as a CSS var that a [data-paper-spread] rule consumes,
  // which keeps it out of each spread's offset size (export measures that) and out of the raster
  // (html-to-image ignores element margins); the exporter re-adds the same margin in the PDF.
  exportMarginPx?: number;
  // When true, a cover spread (封面对开页: cover + matching back cover) opens the book (preview + PDF).
  coverEnabled?: boolean;
  // Optional custom inscription (落款/副标题) shown on the cover; blank renders nothing.
  coverInscription?: string;
  coverStyleId?: PaperCoverStyleId;
  backCoverMode?: PaperBackCoverMode;
  showCoverSpine?: boolean;
}

type PaperGenealogyViewModel = ReturnType<typeof usePaperGenealogyViewModel>;

// Build the cover spread (封面对开页) for a renderer's leading slot. One double page carrying the
// cover and its matching back cover, laid out like a body spread for printable imposition. Returns
// null when disabled so the book starts directly at its first genealogy spread. The cover derives
// the same title the spine uses; the renderer passes the post-pagination volume count (it varies
// per style) for the title slip's 全X卷 line.
function buildCoverSlot(vm: PaperGenealogyViewModel, volumeCount: number) {
  if (!vm.coverEnabled) return null;
  return (
    <PaperCover
      generations={vm.generations}
      spineTitleOverride={vm.spineTitleOverride}
      hallName={vm.hallName}
      inscription={vm.coverInscription}
      volumeCount={volumeCount}
      coverStyleId={vm.coverStyleId}
      backCoverMode={vm.backCoverMode}
      showCoverSpine={vm.showCoverSpine}
      t={vm.translate}
    />
  );
}

const PAPER_BOOK_RENDERERS = {
  [PAPER_GENEALOGY_STYLE.OU]: (vm) => (
    <OuBookRenderer
      generations={vm.generations}
      t={vm.translate}
      spineTitleOverride={vm.spineTitleOverride}
      paperVars={vm.paperVars}
      hallName={vm.hallName}
      fontScale={vm.fontScale}
      coverSlot={(volumeCount) => buildCoverSlot(vm, volumeCount)}
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
      fontScale={vm.fontScale}
      coverSlot={(volumeCount) => buildCoverSlot(vm, volumeCount)}
    />
  ),
  [PAPER_GENEALOGY_STYLE.DIEJI]: (vm) => (
    <DiejiBookRenderer
      generations={vm.generations}
      t={vm.translate}
      spineTitleOverride={vm.spineTitleOverride}
      paperVars={vm.paperVars}
      hallName={vm.hallName}
      fontScale={vm.fontScale}
      coverSlot={(volumeCount) => buildCoverSlot(vm, volumeCount)}
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
      fontScale={vm.fontScale}
      coverSlot={(volumeCount) => buildCoverSlot(vm, volumeCount)}
    />
  ),
  [PAPER_GENEALOGY_STYLE.MODERN]: (vm) => (
    <ModernBookRenderer
      generations={vm.generations}
      t={vm.translate}
      spineTitleOverride={vm.spineTitleOverride}
      paperVars={vm.paperVars}
      hallName={vm.hallName}
      fontScale={vm.fontScale}
      coverSlot={(volumeCount) => buildCoverSlot(vm, volumeCount)}
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
    <div
      className="h-full min-h-0 min-w-0 w-full"
      data-testid="paper-genealogy-view"
      data-style={props.style}
      style={{ "--df-paper-leaf-margin": `${props.exportMarginPx ?? 0}px` } as CSSProperties}
    >
      {PAPER_BOOK_RENDERERS[props.style](vm)}
    </div>
  );
}

export default PaperGenealogyView;
