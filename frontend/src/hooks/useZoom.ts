import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

export interface ZoomTransformState { x: number; y: number; k: number }
export interface UseZoomOptions {
  min?: number
  max?: number
  step?: number
  initialScale?: number
  /** Transition ms when programmatically changing scale */
  duration?: number
}

export interface UseZoomReturn<TSVG extends SVGSVGElement = SVGSVGElement, TG extends SVGGElement = SVGGElement> {
  transform: ZoomTransformState
  zoomIn: () => void
  zoomOut: () => void
  setZoom: (k: number) => void
  kMin: number
  kMax: number
  kToNorm: (k: number) => number
  normToK: (n: number) => number
  centerOn: (gx: number, gy: number, containerWidth: number, containerHeight: number) => void
  svgRef: React.RefObject<TSVG>
  innerRef: React.RefObject<TG>
}

/**
 * Reusable d3 zoom hook.
 * - Provides transform state (x,y,k)
 * - Exposes helpers for incremental zoom & programmatic centering
 * - Uses logarithmic mapping helpers for UI sliders
 */
export function useZoom(options: UseZoomOptions = {}): UseZoomReturn {
  const { min = 0.3, max = 60, step = 1.2, initialScale = 1, duration = 120 } = options
  const svgRef = useRef<SVGSVGElement | null>(null)
  const innerRef = useRef<SVGGElement | null>(null)
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [transform, setTransform] = useState<ZoomTransformState>({ x: 0, y: 0, k: initialScale })

  useEffect(() => {
    if (!svgRef.current || !innerRef.current) return
    const svg = d3.select(svgRef.current)
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([min, max])
      .on('zoom', (event: any) => {
        const t: d3.ZoomTransform = event.transform
        if (innerRef.current) d3.select(innerRef.current).attr('transform', `translate(${t.x},${t.y}) scale(${t.k})`)
        setTransform({ x: t.x, y: t.y, k: t.k })
      })
    zoomBehaviorRef.current = zoom
    svg.call(zoom as any)
    return () => { svg.on('.zoom', null) }
  }, [min, max])

  const setZoom = useCallback((kTarget: number) => {
    if (!zoomBehaviorRef.current || !svgRef.current) return
    const kClamped = Math.min(max, Math.max(min, kTarget))
    d3.select(svgRef.current).transition().duration(duration).call(zoomBehaviorRef.current.scaleTo as any, kClamped)
  }, [min, max, duration])

  const zoomIn = useCallback(() => setZoom(transform.k * step), [setZoom, transform.k, step])
  const zoomOut = useCallback(() => setZoom(transform.k / step), [setZoom, transform.k, step])

  const kToNorm = useCallback((k: number) => (Math.log(k) - Math.log(min)) / (Math.log(max) - Math.log(min)), [min, max])
  const normToK = useCallback((n: number) => Math.exp(Math.log(min) + n * (Math.log(max) - Math.log(min))), [min, max])

  /** Center viewport on graph coordinate (gx,gy) while preserving current scale */
  const centerOn = useCallback((gx: number, gy: number, containerWidth: number, containerHeight: number) => {
    if (!zoomBehaviorRef.current || !svgRef.current) return
    const k = transform.k
    const targetX = -gx * k + containerWidth / 2
    const targetY = -gy * k + containerHeight / 2
    const newT = d3.zoomIdentity.translate(targetX, targetY).scale(k)
    d3.select(svgRef.current).transition().duration(200).call(zoomBehaviorRef.current.transform as any, newT)
  }, [transform.k])

  return { svgRef, innerRef, transform, zoomIn, zoomOut, setZoom, kMin: min, kMax: max, kToNorm, normToK, centerOn }
}

export default useZoom
