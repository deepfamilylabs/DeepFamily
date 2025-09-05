// Layout constants for consistent UI sizing
import React from 'react'

export const LAYOUT = {
  // Visualization view dimensions - responsive heights
  VISUALIZATION_HEIGHT_MOBILE: 580,
  VISUALIZATION_HEIGHT_DESKTOP: 680,
  
  // Node dimensions
  NODE_HEIGHT: 44,
  NODE_WIDTH: 100,
  
  // Virtualized list
  ROW_HEIGHT: 40,
  
  // Spacing
  PADDING_TOP: 16,
} as const

// Utility function to get responsive visualization height
export const getVisualizationHeight = () => {
  if (typeof window === 'undefined') return LAYOUT.VISUALIZATION_HEIGHT_DESKTOP
  return window.innerWidth < 768 ? LAYOUT.VISUALIZATION_HEIGHT_MOBILE : LAYOUT.VISUALIZATION_HEIGHT_DESKTOP
}

// React hook for responsive visualization height
export const useVisualizationHeight = () => {
  const [height, setHeight] = React.useState(getVisualizationHeight)
  
  React.useEffect(() => {
    const updateHeight = () => setHeight(getVisualizationHeight())
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])
  
  return height
}
