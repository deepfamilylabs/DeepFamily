import React from "react";
import type { ZoomTransformState } from "../hooks/useZoom";
import type { MiniMapNode, UseMiniMapOptions } from "../hooks/useMiniMap";
import useMiniMap from "../hooks/useMiniMap";
import { MiniMap, ZoomControls } from "./ZoomControls";

type GraphViewportProps = {
  containerRef: React.RefObject<HTMLDivElement>;
  height: number | string;

  containerClassName: string;
  svgClassName: string;
  viewBox: string;
  svgRef: React.RefObject<SVGSVGElement>;

  transform: ZoomTransformState;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoom: (k: number) => void;
  kToNorm: (k: number) => number;
  normToK: (n: number) => number;
  centerOn: (gx: number, gy: number, containerWidth: number, containerHeight: number) => void;

  miniMapNodes: MiniMapNode[];
  miniMapOptions?: UseMiniMapOptions;
  miniMapUpdateRef?: React.MutableRefObject<(() => void) | undefined>;
  zoomControlsClassName?: string;
  zoomControlsTrackHeight?: number;
  miniMapWrapperClassName?: string;

  children: React.ReactNode;
};

export default function GraphViewport({
  containerRef,
  height,
  containerClassName,
  svgClassName,
  viewBox,
  svgRef,
  transform,
  zoomIn,
  zoomOut,
  setZoom,
  kToNorm,
  normToK,
  centerOn,
  miniMapNodes,
  miniMapOptions,
  miniMapUpdateRef,
  zoomControlsClassName = "absolute bottom-48 left-3 z-10 md:bottom-[158px]",
  zoomControlsTrackHeight = 140,
  miniMapWrapperClassName = "absolute bottom-20 left-3 z-10 scale-75 md:scale-100 origin-bottom-left md:bottom-3",
  children,
}: GraphViewportProps) {
  const { miniSvgRef, viewportRef, dims, update } = useMiniMap(
    { width: 120, height: 90, ...(miniMapOptions || {}) },
    {
      nodes: miniMapNodes,
      transform,
      container: containerRef.current,
      onCenter: (gx, gy) => {
        const box = containerRef.current?.getBoundingClientRect();
        if (!box) return;
        centerOn(gx, gy, box.width, box.height);
      },
    },
  );
  if (miniMapUpdateRef) miniMapUpdateRef.current = update;

  return (
    <div ref={containerRef} className={containerClassName} style={{ height }}>
      <ZoomControls
        className={zoomControlsClassName}
        trackHeight={zoomControlsTrackHeight}
        k={transform.k}
        kToNorm={kToNorm}
        normToK={normToK}
        onSetZoom={setZoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
      />
      <div className={miniMapWrapperClassName}>
        <MiniMap width={dims.w} height={dims.h} miniSvgRef={miniSvgRef} viewportRef={viewportRef} />
      </div>
      <svg ref={svgRef} width="100%" height="100%" viewBox={viewBox} className={svgClassName}>
        {children}
      </svg>
    </div>
  );
}
