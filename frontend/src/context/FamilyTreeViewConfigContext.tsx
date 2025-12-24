import React, { createContext, useContext, useMemo } from 'react'
import { LAYOUT, type FamilyTreeLayout, type FamilyTreeLayoutOverrides, useFamilyTreeHeight } from '../constants/layout'

export type FamilyTreeViewConfig = {
  layout: FamilyTreeLayout
  height: number
}

const Ctx = createContext<FamilyTreeViewConfig | null>(null)

export function FamilyTreeViewConfigProvider(props: {
  overrides?: FamilyTreeLayoutOverrides
  children: React.ReactNode
}) {
  const { overrides, children } = props
  const layout = useMemo<FamilyTreeLayout>(() => ({ ...LAYOUT, ...(overrides || {}) }), [overrides])
  const height = useFamilyTreeHeight(layout)
  const value = useMemo(() => ({ layout, height }), [layout, height])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFamilyTreeViewConfig(): FamilyTreeViewConfig {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('FamilyTreeViewConfigProvider is missing')
  return ctx
}

