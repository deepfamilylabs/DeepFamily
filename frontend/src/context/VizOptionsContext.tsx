import React, { createContext, useContext, useState, useEffect, useMemo } from 'react'

export interface VizOptionsContextValue {
  traversal: 'dfs' | 'bfs'
  deduplicateChildren: boolean
  childrenMode: 'union' | 'strict'
  strictIncludeUnversionedChildren: boolean
  setTraversal: (t: 'dfs' | 'bfs') => void
  setDeduplicateChildren: (value: boolean) => void
  setChildrenMode: (value: 'union' | 'strict') => void
  setStrictIncludeUnversionedChildren: (value: boolean) => void
}

const VizOptionsContext = createContext<VizOptionsContextValue | null>(null)

const LS_KEYS = {
  traversal: 'df:traversal',
  deduplicateChildren: 'df:deduplicateChildren',
  childrenMode: 'df:childrenMode',
  strictIncludeUnversionedChildren: 'df:strictIncludeUnversionedChildren'
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

  const [childrenMode, setChildrenMode] = useState<'union' | 'strict'>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem(LS_KEYS.childrenMode)
      if (v === 'union' || v === 'strict') return v
    }
    return 'union'
  })

  const [strictIncludeUnversionedChildren, setStrictIncludeUnversionedChildren] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem(LS_KEYS.strictIncludeUnversionedChildren)
      if (v !== null) return v === 'true'
    }
    return true
  })

  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem(LS_KEYS.traversal, traversal) }, [traversal])
  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem(LS_KEYS.deduplicateChildren, String(deduplicateChildren)) }, [deduplicateChildren])
  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem(LS_KEYS.childrenMode, childrenMode) }, [childrenMode])
  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem(LS_KEYS.strictIncludeUnversionedChildren, String(strictIncludeUnversionedChildren)) }, [strictIncludeUnversionedChildren])

  const value = useMemo<VizOptionsContextValue>(() => ({
    traversal,
    deduplicateChildren,
    childrenMode,
    strictIncludeUnversionedChildren,
    setTraversal,
    setDeduplicateChildren,
    setChildrenMode,
    setStrictIncludeUnversionedChildren
  }), [traversal, deduplicateChildren, childrenMode, strictIncludeUnversionedChildren])

  return <VizOptionsContext.Provider value={value}>{children}</VizOptionsContext.Provider>
}

export function useVizOptions() {
  const ctx = useContext(VizOptionsContext)
  if (!ctx) throw new Error('useVizOptions must be used within VizOptionsProvider')
  return ctx
}
