import React, { useCallback, useEffect, useRef } from 'react'

export interface ZoomControlsProps {
  k: number
  kToNorm: (k: number) => number
  normToK: (n: number) => number
  onSetZoom: (k: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  className?: string
  trackHeight?: number
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({ k, kToNorm, normToK, onSetZoom, onZoomIn, onZoomOut, className = '', trackHeight = 220 }) => {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  const handlePointerPos = useCallback((clientY: number) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    let y = clientY - rect.top
    y = Math.max(0, Math.min(rect.height, y))
    const norm = 1 - y / rect.height
    onSetZoom(normToK(norm))
  }, [normToK, onSetZoom])

  const onPointerMove = useCallback((e: PointerEvent) => { if (draggingRef.current) handlePointerPos(e.clientY) }, [handlePointerPos])
  const onPointerUp = useCallback(() => { draggingRef.current = false; window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp) }, [onPointerMove])
  const onPointerDown = useCallback((e: React.PointerEvent) => { draggingRef.current = true; handlePointerPos(e.clientY); window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onPointerUp) }, [handlePointerPos, onPointerMove, onPointerUp])
  useEffect(() => () => { window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp) }, [onPointerMove, onPointerUp])

  return (
    <div className={`flex flex-col items-center gap-3 select-none ${className}`}>
      <button onClick={onZoomIn} className="w-9 h-9 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 shadow border border-slate-300 dark:border-gray-600 hover:bg-slate-50 dark:hover:bg-gray-700 active:scale-95 transition text-slate-700 dark:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:focus-visible:ring-indigo-400/50">+</button>
      <div ref={trackRef} onPointerDown={onPointerDown} className="relative w-6" style={{ height: trackHeight }}>
        <div className="absolute left-1/2 -translate-x-1/2 top-1.5 bottom-1.5 w-1 rounded-full bg-gradient-to-b from-slate-200 via-slate-300 to-slate-200 dark:from-gray-600 dark:via-gray-500 dark:to-gray-600 shadow-inner">
          <div className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-blue-500 shadow ring-2 ring-white dark:ring-gray-900 hover:scale-110 transition" style={{ top: `${(1 - kToNorm(k)) * 100}%`, transform: 'translate(-50%, -50%)' }} />
          <div className="absolute left-1/2 -translate-x-1/2 w-1 bg-blue-400/60 dark:bg-blue-500/50" style={{ top: `${(1 - kToNorm(k)) * 100}%`, bottom: 0, borderRadius: '999px' }} />
        </div>
      </div>
      <button onClick={onZoomOut} className="w-9 h-9 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 shadow border border-slate-300 dark:border-gray-600 hover:bg-slate-50 dark:hover:bg-gray-700 active:scale-95 transition text-slate-700 dark:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:focus-visible:ring-indigo-400/50">-</button>
    </div>
  )
}

export interface MiniMapProps {
  width: number
  height: number
  miniSvgRef: React.RefObject<SVGSVGElement>
  viewportRef: React.RefObject<SVGRectElement>
  onClick?: (e: React.MouseEvent<SVGSVGElement>) => void
  className?: string
  children?: React.ReactNode
}

export const MiniMap: React.FC<MiniMapProps> = ({ width, height, miniSvgRef, viewportRef, onClick, className = '', children }) => {
  return (
    <div className={`bg-white/80 dark:bg-gray-800/70 backdrop-blur rounded-md shadow border border-slate-300 dark:border-gray-600 p-1 select-none ${className}`}>      
      <svg ref={miniSvgRef} width={width} height={height} onClick={onClick} className="cursor-pointer">
        <rect x={0} y={0} width={width} height={height} rx={4} ry={4} fill="#f1f5f9" stroke="#cbd5e1" className="dark:fill-gray-700 dark:stroke-gray-500" />
        <g className="nodes" />
        <rect ref={viewportRef} x={0} y={0} width={20} height={20} fill="none" stroke="#2563eb" strokeWidth={1.5} className="dark:stroke-blue-400" />
        {children}
      </svg>
    </div>
  )
}

export default ZoomControls
