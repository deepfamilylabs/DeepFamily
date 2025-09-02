export const VISUALIZATION_CONFIG = {
  SUBGRAPH_TIMEOUT_MS: 6000,
  SUBGRAPH_RETRY_ATTEMPTS: 3,
  ENDORSEMENT_STATS_BATCH: 40,
  DEFAULT_MAX_DEPTH: 30,
  DEFAULT_PAGE_SIZE: 25,
  DEFAULT_PARALLEL: 6,
  DEFAULT_HARD_NODE_LIMIT: 20000,
}

export type VisualizationConfig = typeof VISUALIZATION_CONFIG

// Utility to override via window (for power users / debugging)
export function getRuntimeVisualizationConfig(): VisualizationConfig {
  if (typeof window === 'undefined') return VISUALIZATION_CONFIG
  const w: any = window
  if (!w.__DF_VIS_CONF__) return VISUALIZATION_CONFIG
  return { ...VISUALIZATION_CONFIG, ...w.__DF_VIS_CONF__ }
}
