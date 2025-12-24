import React from 'react'
import type { FamilyTreeViewProps } from '../types/familyTreeViewProps'

export function noPropsForwardRef<THandle>(
  render: (ref: React.Ref<THandle>) => React.ReactNode
) {
  return React.forwardRef<THandle, FamilyTreeViewProps>((_props, ref) => render(ref))
}

