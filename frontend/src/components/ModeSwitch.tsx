import { useLayoutEffect, useRef, useState, useEffect, useCallback } from 'react'

type Mode = 'subgraph' | 'contract'

interface ModeSwitchProps {
  mode: Mode
  onChange: (m: Mode) => void
  labels: { subgraph: string; contract: string }
  disabled?: boolean
}

export default function ModeSwitch({ mode, onChange, labels, disabled }: ModeSwitchProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const btnRefs = useRef<HTMLButtonElement[]>([])
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 })
  const [animate, setAnimate] = useState(true)

  const measure = useCallback(() => {
    const idx = mode === 'subgraph' ? 0 : 1
    const btn = btnRefs.current[idx]
    const container = containerRef.current
    if (!btn || !container) return
    const left = btn.offsetLeft
    const width = btn.offsetWidth
    setIndicator(prev => (prev.left !== left || prev.width !== width ? { left, width } : prev))
  }, [mode])

  useLayoutEffect(() => {
    setAnimate(true)
    measure()
  }, [mode, measure])

  useLayoutEffect(() => {
    setAnimate(false)
    measure()
    const id = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(id)
  }, [labels.subgraph, labels.contract, measure])

  useEffect(() => {
    const ro = new ResizeObserver(() => { setAnimate(false); measure(); const id = requestAnimationFrame(() => setAnimate(true)); return () => cancelAnimationFrame(id) })
    if (containerRef.current) ro.observe(containerRef.current)
    btnRefs.current.forEach(b => b && ro.observe(b))
    const onResize = () => { setAnimate(false); measure(); const id = requestAnimationFrame(() => setAnimate(true)); }
    window.addEventListener('resize', onResize)
    return () => { ro.disconnect(); window.removeEventListener('resize', onResize) }
  }, [measure])

  return (
    <div
      ref={containerRef}
      className="relative inline-flex h-9 select-none rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-xs font-medium overflow-hidden shadow-sm"
      style={{ lineHeight: '1' }}
    >
      <div
        className={`absolute rounded-md bg-indigo-600 ${animate ? 'transition-all duration-200 ease-out' : ''} z-0`}
        style={{ top: 2, bottom: 2, left: indicator.left, width: indicator.width }}
      />
      <button
        ref={el => { if (el) btnRefs.current[0] = el }}
        type="button"
        disabled={disabled || mode === 'subgraph'}
        onClick={() => onChange('subgraph')}
        className={`relative z-10 inline-flex items-center justify-center gap-1 px-3 h-full transition-colors duration-150 whitespace-nowrap ${mode === 'subgraph' ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100'}`}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="5" r="2" />
          <circle cx="19" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
          <path d="M7 11l3-3m4 0 3 3m-10 2 3 3m4 0 3-3" />
        </svg>
        <span>{labels.subgraph}</span>
      </button>
      <button
        ref={el => { if (el) btnRefs.current[1] = el }}
        type="button"
        disabled={disabled || mode === 'contract'}
        onClick={() => onChange('contract')}
        className={`relative z-10 inline-flex items-center justify-center gap-1 px-3 h-full transition-colors duration-150 whitespace-nowrap ${mode === 'contract' ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100'}`}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 3h5l5 5v13a1 1 0 0 1 -1 1H8a1 1 0 0 1 -1-1V4a1 1 0 0 1 1-1z" />
          <path d="M13 3v5h5" />
          <circle cx="12" cy="16" r="2.2" />
          <path d="M10.8 18.8 10 21l2-0.6 2 0.6 -0.8-2.2" />
        </svg>
        <span>{labels.contract}</span>
      </button>
    </div>
  )
}
