import React, { createContext, useContext, useMemo } from 'react'
import { LAYOUT, type FamilyTreeLayout, type FamilyTreeLayoutOverrides, getFamilyTreeHeight, useFamilyTreeHeight } from '../constants/layout'

export type FamilyTreeViewConfig = {
  layout: FamilyTreeLayout
  height: number
}

const DEFAULT_LAYOUT: FamilyTreeLayout = { ...LAYOUT }
const DEFAULT_CONFIG: FamilyTreeViewConfig = {
  layout: DEFAULT_LAYOUT,
  height: getFamilyTreeHeight(DEFAULT_LAYOUT)
}

const Ctx = createContext<FamilyTreeViewConfig>(DEFAULT_CONFIG)

export function FamilyTreeViewConfigProvider(props: {
  overrides?: FamilyTreeLayoutOverrides
  children: React.ReactNode
}) {
  const { overrides, children } = props
  const layout = useMemo<FamilyTreeLayout>(() => ({ ...DEFAULT_LAYOUT, ...(overrides || {}) }), [overrides])
  const height = useFamilyTreeHeight(layout)
  const value = useMemo(() => ({ layout, height }), [layout, height])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFamilyTreeViewConfig(): FamilyTreeViewConfig {
  return useContext(Ctx)
}
