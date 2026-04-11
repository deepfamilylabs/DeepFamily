export interface TreeProgress {
  created: number;
  visited: number;
  depth: number;
}

export interface TreeDebugStats {
  inflightCount: number;
  edgeCacheHits: { strict: number; union: number };
  edgeCacheMisses: { strict: number; union: number };
  lastEdgeFetchAt: { strict?: number; union?: number };
  totalVersionsCacheHits: number;
  totalVersionsCacheMisses: number;
  lastTotalVersionsFetchAt?: number;
}
