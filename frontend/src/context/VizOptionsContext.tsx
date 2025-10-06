import React, { createContext, useContext, useState, useEffect, useMemo } from 'react'

export interface VizOptionsContextValue {
  traversal: 'dfs' | 'bfs'
  includeVersionDetails: boolean
  deduplicateChildren: boolean
  setTraversal: (t: 'dfs' | 'bfs') => void
  setDeduplicateChildren: (value: boolean) => void
}

const VizOptionsContext = createContext<VizOptionsContextValue | null>(null)

const LS_KEYS = {
  traversal: 'df:traversal',
  deduplicateChildren: 'df:deduplicateChildren'
}

export function VizOptionsProvider({ children }: { children: React.ReactNode }) {
  const [traversal, setTraversal] = useState<'dfs' | 'bfs'>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem(LS_KEYS.traversal)
      if (v === 'dfs' || v === 'bfs') return v
    }
    return 'dfs'
  })

  const [deduplicateChildren, setDeduplicateChildren] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem(LS_KEYS.deduplicateChildren)
      if (v !== null) return v === 'true'
    }
    return true // default to showing highest-endorsed version only
  })

  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem(LS_KEYS.traversal, traversal) }, [traversal])
  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem(LS_KEYS.deduplicateChildren, String(deduplicateChildren)) }, [deduplicateChildren])

  const value = useMemo<VizOptionsContextValue>(() => ({
    traversal,
    includeVersionDetails: true,
    deduplicateChildren,
    setTraversal,
    setDeduplicateChildren
  }), [traversal, deduplicateChildren])

  return <VizOptionsContext.Provider value={value}>{children}</VizOptionsContext.Provider>
}

export function useVizOptions() {
  const ctx = useContext(VizOptionsContext)
  if (!ctx) throw new Error('useVizOptions must be used within VizOptionsProvider')
  return ctx
}
