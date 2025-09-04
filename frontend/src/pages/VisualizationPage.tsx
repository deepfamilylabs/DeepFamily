import { useEffect, useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ApolloClient, InMemoryCache, ApolloProvider } from '@apollo/client'
import { SubgraphTree, fetchSubtreeStream } from '../components/Visualization'
import { useConfig } from '../context/ConfigContext'
import ModeSwitch from '../components/ModeSwitch'
import ViewModeSwitch from '../components/ViewModeSwitch'
import LoadingSkeleton from '../components/LoadingSkeleton'
import VisualizationConfigForm from '../components/VisualizationConfigForm'
import ViewContainer from '../components/ViewContainer'
import { useTreeData } from '../context/TreeDataContext'
import { getRuntimeVisualizationConfig } from '../config/visualization'
import { useVizOptions } from '../context/VizOptionsContext'

export default function VisualizationPage() {
  const { traversal, includeVersionDetails, setTraversal, setIncludeVersionDetails } = useVizOptions()
  const { mode, setMode } = useConfig()
  const [viewMode, setViewMode] = useState<'dag' | 'tree' | 'force' | 'virtual'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('df:viewMode')
      if (saved === 'dag' || saved === 'tree' || saved === 'force' || saved === 'virtual') return saved as any
    }
    return 'dag'
  })
  const [editingConfig, setEditingConfig] = useState(false)

  const { t } = useTranslation()
  const { subgraphUrl, rootHash, rootVersionIndex } = useConfig()
  const { root, loading: loadingContract, progress, contractMessage, refresh } = useTreeData()
  const { SUBGRAPH_TIMEOUT_MS, SUBGRAPH_RETRY_ATTEMPTS } = getRuntimeVisualizationConfig()
  const [sgStatus, setSgStatus] = useState<'checking' | 'ok' | 'root_missing' | 'error'>('checking')
  const [sgMessage, setSgMessage] = useState('')
  const [proxyHint, setProxyHint] = useState(false)
  const SHOW_DEBUG = (import.meta as any).env.VITE_SHOW_DEBUG === '1'

  const triggerRefresh = useCallback(() => refresh(), [refresh])
  const client = useMemo(() => new ApolloClient({ uri: subgraphUrl, cache: new InMemoryCache() }), [subgraphUrl])

  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem('df:viewMode', viewMode) }, [viewMode])

  useEffect(() => {
    if (mode !== 'subgraph') return
    let aborted = false
    setSgStatus('checking')
    setSgMessage('')
    ;(async () => {
      const maxAttempts = SUBGRAPH_RETRY_ATTEMPTS
      for (let attempt = 1; attempt <= maxAttempts && !aborted; attempt++) {
        try {
          const rootId = `${rootHash.toLowerCase()}-v-${rootVersionIndex}`
          const controller = new AbortController()
          const tm = setTimeout(() => controller.abort(), SUBGRAPH_TIMEOUT_MS)
          const res = await fetch(subgraphUrl, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: `query($id: ID!){ personVersion(id: $id){ id } }`, variables: { id: rootId } }),
            signal: controller.signal,
          }).finally(() => clearTimeout(tm))
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const json = await res.json()
          if (json.errors) throw new Error(t('visualization.status.graphqlError'))
          if (!json?.data?.personVersion) { if (!aborted) { setSgStatus('root_missing'); setSgMessage(t('visualization.status.rootNotFound')) } return }
          if (!aborted) setSgStatus('ok')
          return
        } catch (e: any) {
          if (aborted) return
          if (attempt === maxAttempts) {
            setSgStatus('error')
            let msg: string
            if (e?.name === 'AbortError') msg = t('visualization.status.subgraphTimeout')
            else if (!e?.message || /failed to fetch/i.test(e.message) || /network/i.test(e.message)) msg = t('visualization.status.subgraphConnectionFailed')
            else if (/HTTP \\d+/.test(e.message)) msg = `${t('visualization.status.subgraphConnectionFailed')} (${e.message})`
            else msg = e.message
            setSgMessage(msg)
            try {
              const proxyUrl = '/api/subgraph'
              if (subgraphUrl !== proxyUrl) {
                const res2 = await fetch(proxyUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{__typename}' }) })
                setProxyHint(res2.ok)
              } else setProxyHint(false)
            } catch { setProxyHint(false) }
          } else {
            await new Promise(r => setTimeout(r, 2 ** attempt * 300))
          }
        }
      }
    })()
    return () => { aborted = true }
  }, [mode, subgraphUrl, rootHash, rootVersionIndex, t, SUBGRAPH_TIMEOUT_MS, SUBGRAPH_RETRY_ATTEMPTS])

  return (
    <div className="space-y-6 text-gray-900 dark:text-gray-100 bg-gradient-to-br from-slate-50/30 via-transparent to-blue-50/20 dark:from-slate-900/50 dark:via-transparent dark:to-slate-800/30 min-h-screen px-4 pb-24 md:pb-6 rounded-t-3xl backdrop-blur-sm overflow-visible overflow-x-hidden">
      {SHOW_DEBUG && mode === 'contract' && (() => { try { const { errors } = useTreeData(); return errors.length ? (
        <div className="text-xs rounded border border-amber-300 dark:border-amber-600/60 bg-amber-50 dark:bg-amber-900/30 p-2 space-y-1">
          <div className="font-medium text-amber-700 dark:text-amber-300">Debug Errors ({errors.length})</div>
          {errors.slice(-5).map(e => (
            <div key={e.id} className="text-amber-800 dark:text-amber-200 break-all">
              <span className="font-semibold">[{e.context?.stage||'unknown'}]</span> {e.message}
            </div>
          ))}
        </div>
      ) : null } catch { return null } })()}
      <div className="bg-white/40 dark:bg-slate-800/40 backdrop-blur-sm rounded-2xl p-6 border border-slate-200/50 dark:border-slate-700/30 shadow-lg">
        {/* Header row: try single line on mobile; wrap only when necessary */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full">
          <h2 className="text-xl sm:text-2xl font-bold text-transparent bg-gradient-to-r from-slate-900 via-blue-700 to-purple-700 dark:from-slate-100 dark:via-blue-300 dark:to-purple-300 bg-clip-text min-w-0 flex-1 truncate" title={t('visualization.dataFrom')}>
            {t('visualization.dataFrom')}
          </h2>
          <div className="flex-none flex-shrink-0">
            <ModeSwitch mode={mode as any} onChange={m => setMode(m)} labels={{ subgraph: t('visualization.modes.subgraph'), contract: t('visualization.modes.contract') }} />
          </div>
        </div>
      </div>
      <div className="bg-white/40 dark:bg-slate-800/40 backdrop-blur-sm rounded-2xl border border-slate-200/50 dark:border-slate-700/30 shadow-lg overflow-hidden">
        <VisualizationConfigForm 
          editing={editingConfig} 
          setEditing={setEditingConfig}
          mode={mode as any}
          sgStatus={sgStatus}
          sgMessage={sgMessage}
          contractMessage={contractMessage}
          loading={mode === 'contract' ? loadingContract : sgStatus === 'checking'}
          onRefresh={triggerRefresh}
          t={t as any}
        />
      </div>
      <div className="bg-white/40 dark:bg-slate-800/40 backdrop-blur-sm rounded-2xl p-6 border border-slate-200/50 dark:border-slate-700/30 shadow-lg overflow-visible">
        <div className="space-y-4 overflow-visible">
          {/* First Row: Title and Stats */}
          <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3 sm:gap-2 w-full">
            <h3 className="text-lg font-bold text-transparent bg-gradient-to-r from-slate-900 via-blue-700 to-purple-700 dark:from-slate-100 dark:via-blue-300 dark:to-purple-300 bg-clip-text flex-shrink-0 min-w-0 break-words">
              {t('visualization.ui.visualizationView')}
            </h3>
            {mode === 'contract' && (() => {
              const createdDisplay = progress ? progress.created : (loadingContract ? '…' : 0)
              const depthDisplay = progress ? progress.depth : (loadingContract ? '…' : 0)
              return (
                <span className="text-xs px-2 py-1.5 rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 text-blue-700 dark:text-blue-300 border border-blue-200/50 dark:border-blue-600/30 select-none inline-flex items-center gap-2 backdrop-blur-sm shadow-sm flex-shrink-0 flex-wrap whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 truncate max-w-[9ch]">{t('visualization.ui.nodesLabelFull')}</span>
                    <span className="font-mono tabular-nums text-blue-800 dark:text-blue-100 w-[5ch] text-right font-bold min-w-[5ch]" style={{ fontVariantNumeric: 'tabular-nums' }}>{createdDisplay}</span>
                  </span>
                  <span className="h-3 w-px bg-blue-300 dark:bg-blue-600" aria-hidden="true" />
                  <span className="inline-flex items-center gap-1">
                    <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 truncate max-w-[9ch]">{t('visualization.ui.depthLabelFull')}</span>
                    <span className="font-mono tabular-nums text-blue-800 dark:text-blue-100 w-[3ch] text-right font-bold min-w-[3ch]" style={{ fontVariantNumeric: 'tabular-nums' }}>{depthDisplay}</span>
                  </span>
                </span>
              )
            })()}
          </div>
          
          {/* Second Row: Controls and Options */}
          <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-2 sm:gap-x-4 overflow-visible">
            {/* Left: Contract Controls (or empty space for alignment) */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs min-w-0 overflow-visible">
              {mode === 'contract' && (
                <>
                  <div className="flex items-center gap-1.5 flex-shrink-0 overflow-visible">
                    <span className="text-xs text-slate-600 dark:text-slate-400 select-none font-medium">{t('visualization.ui.traversal')}</span>
                    <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-600 shadow-sm bg-white dark:bg-slate-800 overflow-visible">
                      <div className="relative group">
                        <button type="button" aria-label={t('visualization.ui.traversalDFS')} onClick={() => setTraversal('dfs')} className={`px-2 py-1 text-xs transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60 font-medium rounded-l-md ${traversal==='dfs' ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>DFS</button>
                        <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-[9999]">{t('visualization.ui.traversalDFS')}</div>
                      </div>
                      <div className="relative group border-l border-slate-300 dark:border-slate-600">
                        <button type="button" aria-label={t('visualization.ui.traversalBFS')} onClick={() => setTraversal('bfs')} className={`px-2 py-1 text-xs transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60 font-medium rounded-r-md ${traversal==='bfs' ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>BFS</button>
                        <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-[9999]">{t('visualization.ui.traversalBFS')}</div>
                      </div>
                    </div>
                  </div>
                  <div className="relative group flex items-center gap-1 cursor-pointer select-none flex-shrink-0">
                    <input type="checkbox" id="includeVersionDetailsToggle" className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 cursor-pointer bg-white dark:bg-slate-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60 text-blue-600 dark:text-blue-400" checked={includeVersionDetails} onChange={e => setIncludeVersionDetails(e.target.checked)} aria-describedby="includeVersionDetailsHint" />
                    <label htmlFor="includeVersionDetailsToggle" className="text-xs text-slate-600 dark:text-slate-400 cursor-pointer font-medium">{t('visualization.ui.includeVersionDetails')}</label>
                    <div id="includeVersionDetailsHint" className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-[9999]">{t('visualization.ui.includeVersionDetailsDesc')}</div>
                  </div>
                </>
              )}
            </div>
            
            {/* Right: View Mode Switch */}
            <div className="flex flex-shrink-0">
              <ViewModeSwitch value={viewMode} onChange={m => setViewMode(m)} labels={{ tree: t('visualization.viewModes.tree'), dag: t('visualization.viewModes.dag'), force: t('visualization.viewModes.force'), virtual: t('visualization.viewModes.virtual') }} />
            </div>
          </div>
        </div>
      </div>
      <ViewContainer
        mode={mode}
        viewMode={viewMode as any}
        root={root}
        contractMessage={contractMessage}
        loading={mode === 'contract' ? loadingContract : sgStatus === 'checking'}
        subgraphBlock={(
          sgStatus === 'checking' ? <LoadingSkeleton /> : sgStatus === 'ok' ? (
            <ApolloProvider client={client}>
              <SubgraphTree rootPersonHash={rootHash} rootVersionIndex={rootVersionIndex} subgraphUrl={subgraphUrl} />
            </ApolloProvider>
          ) : (
            <div className="text-sm text-slate-700 dark:text-slate-300 space-y-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 p-4 rounded-xl border border-amber-200/50 dark:border-amber-600/30 backdrop-blur-sm">
              <>
                <div className="text-amber-800 dark:text-amber-100 font-semibold">{sgMessage || t('visualization.status.subgraphUnavailable')}</div>
                <div className="text-xs text-amber-600 dark:text-amber-400">{t('visualization.status.developmentProxy')}</div>
                <div className="text-xs text-amber-600 dark:text-amber-400">{t('visualization.status.currentlySubgraphMode')}</div>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setMode('contract')} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 transition-colors font-medium">{t('visualization.status.switchToContract')}</button>
                  {proxyHint && (
                    <button onClick={() => { (window as any).dispatchEvent(new CustomEvent('ft:set-subgraph-proxy')) }} className="px-3 py-1.5 text-xs rounded-md bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 transition-colors font-medium">{t('visualization.status.switchToProxy')}</button>
                  )}
                </div>
              </>
            </div>
          )
        )}
      />
    </div>
  )
}


