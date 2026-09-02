import React, { useCallback, useEffect, useRef } from "react";

export interface ZoomControlsProps {
  k: number;
  kToNorm: (k: number) => number;
  normToK: (n: number) => number;
  onSetZoom: (k: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  className?: string;
  trackHeight?: number;
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({
  k,
  kToNorm,
  normToK,
  onSetZoom,
  onZoomIn,
  onZoomOut,
  className = "",
  trackHeight = 130,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const handlePointerPos = useCallback(
    (clientY: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      let y = clientY - rect.top;
      y = Math.max(0, Math.min(rect.height, y));
      const norm = 1 - y / rect.height;
      onSetZoom(normToK(norm));
    },
    [normToK, onSetZoom],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (draggingRef.current) {
        e.preventDefault();
        handlePointerPos(e.clientY);
      }
    },
    [handlePointerPos],
  );
  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      e.preventDefault();
      draggingRef.current = false;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    },
    [onPointerMove],
  );
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      handlePointerPos(e.clientY);
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp, { passive: false });
    },
    [handlePointerPos, onPointerMove, onPointerUp],
  );
  useEffect(
    () => () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  const buttonClassName =
    "flex h-11 w-11 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink active:scale-95 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 touch-manipulation select-none md:h-8 md:w-8";

  return (
    <div
      className={`inline-flex select-none flex-col items-center gap-1 rounded-xl border border-hairline bg-surface/95 p-1 shadow-sm backdrop-blur-sm md:gap-1.5 md:p-1.5 ${className}`}
    >
      <button
        onClick={onZoomIn}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
        aria-label="Zoom in"
        title="Zoom in"
        className={buttonClassName}
      >
        <svg
          className="h-[17px] w-[17px] md:h-[15px] md:w-[15px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </button>

      {/* Pinch is the zoom gesture on touch, so the rail is a pointer-sized affordance only. */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onMouseDown={(e) => {
          // Fallback for environments where pointer events might not work
          const pointerEvent = new PointerEvent("pointerdown", {
            clientX: e.clientX,
            clientY: e.clientY,
            button: e.button,
            buttons: e.buttons,
          });
          onPointerDown(pointerEvent as any);
        }}
        onTouchStart={(e) => {
          if (e.touches.length > 0) {
            const touch = e.touches[0];
            const pointerEvent = new PointerEvent("pointerdown", {
              clientX: touch.clientX,
              clientY: touch.clientY,
            });
            onPointerDown(pointerEvent as any);
          }
        }}
        className="relative hidden w-5 touch-none select-none md:block"
        style={{ height: trackHeight }}
      >
        <div className="absolute bottom-1.5 left-1/2 top-1.5 w-1 -translate-x-1/2 rounded-full bg-hairline">
          <div
            className="absolute bottom-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-primary"
            style={{ top: `${(1 - kToNorm(k)) * 100}%` }}
          />
          <div
            className="absolute left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full bg-primary shadow-xs ring-2 ring-surface transition-transform hover:scale-110 active:cursor-grabbing"
            style={{ top: `${(1 - kToNorm(k)) * 100}%` }}
          />
        </div>
      </div>

      <button
        onClick={onZoomOut}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
        aria-label="Zoom out"
        title="Zoom out"
        className={buttonClassName}
      >
        <svg
          className="h-[17px] w-[17px] md:h-[15px] md:w-[15px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M5 12h14" />
        </svg>
      </button>

      <span className="h-px w-5 bg-hairline" aria-hidden />

      <button
        onClick={() => onSetZoom(1)}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
        aria-label="Reset zoom"
        title="Reset zoom"
        className={buttonClassName}
      >
        <svg
          className="h-[17px] w-[17px] md:h-[15px] md:w-[15px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M16 3h3a2 2 0 0 1 2 2v3" />
          <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>
    </div>
  );
};

export interface MiniMapProps {
  width: number;
  height: number;
  miniSvgRef: React.RefObject<SVGSVGElement>;
  viewportRef: React.RefObject<SVGRectElement>;
  onClick?: (e: React.MouseEvent<SVGSVGElement>) => void;
  className?: string;
  children?: React.ReactNode;
}

export const MiniMap: React.FC<MiniMapProps> = ({
  width,
  height,
  miniSvgRef,
  viewportRef,
  onClick,
  className = "",
  children,
}) => {
  return (
    <div
      className={`select-none rounded-xl border border-hairline bg-surface/95 p-2 shadow-sm backdrop-blur-sm ${className}`}
    >
      <svg
        ref={miniSvgRef}
        width={width}
        height={height}
        onClick={onClick}
        className="cursor-pointer"
      >
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          rx={6}
          ry={6}
          className="fill-surface-alt"
        />
        <g className="nodes" />
        <rect
          ref={viewportRef}
          x={0}
          y={0}
          width={20}
          height={20}
          fill="none"
          strokeWidth={2}
          rx={4}
          ry={4}
          className="stroke-primary"
        />
        {children}
      </svg>
    </div>
  );
};

export default ZoomControls;
