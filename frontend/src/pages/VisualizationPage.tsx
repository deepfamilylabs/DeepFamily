import { useEffect, useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ApolloClient, InMemoryCache, ApolloProvider } from '@apollo/client'
import { SubgraphTree, fetchSubtreeStream } from '../components/Visualization'
import { useConfig } from '../context/ConfigContext'
import ModeSwitch from '../components/ModeSwitch'
import StatusBar from '../components/StatusBar'
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
    <div className="space-y-4 text-gray-900 dark:text-gray-100">
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 min-w-0 flex-shrink">{t('visualization.familyTree')}</h2>
        <ModeSwitch mode={mode as any} onChange={m => setMode(m)} labels={{ subgraph: t('visualization.modes.subgraph'), contract: t('visualization.modes.contract') }} />
      </div>
      <StatusBar
        mode={mode as any}
        sgStatus={sgStatus}
        sgMessage={sgMessage}
        contractMessage={contractMessage}
        t={t as any}
        onRefresh={triggerRefresh}
        loading={mode === 'contract' ? loadingContract : sgStatus === 'checking'}
      />
      <VisualizationConfigForm editing={editingConfig} setEditing={setEditingConfig} />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('visualization.ui.visualizationView')}</span>
          {mode === 'contract' && (() => {
            const createdDisplay = progress ? progress.created : (loadingContract ? '…' : 0)
            const depthDisplay = progress ? progress.depth : (loadingContract ? '…' : 0)
            return (
              <span className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 select-none inline-flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('visualization.ui.nodesLabelFull')}</span>
                  <span className="font-mono tabular-nums text-gray-800 dark:text-gray-100 w-[6ch] text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{createdDisplay}</span>
                </span>
                <span className="h-3 w-px bg-gray-300 dark:bg-gray-600" aria-hidden="true" />
                <span className="inline-flex items-center gap-1">
                  <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('visualization.ui.depthLabelFull')}</span>
                  <span className="font-mono tabular-nums text-gray-800 dark:text-gray-100 w-[4ch] text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{depthDisplay}</span>
                </span>
              </span>
            )
          })()}
          {mode === 'contract' && (
            <div className="flex items-center gap-6 text-xs flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 dark:text-gray-400 select-none">{t('visualization.ui.traversal')}</span>
                <div className="inline-flex rounded border border-gray-300 dark:border-gray-600 shadow-sm relative overflow-hidden">
                  <div className="relative group">
                    <button type="button" aria-label={t('visualization.ui.traversalDFS')} onClick={() => setTraversal('dfs')} className={`px-2 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:focus-visible:ring-indigo-400/60 ${traversal==='dfs' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>DFS</button>
                    <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 dark:bg-gray-950 text-white px-2 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity z-10">{t('visualization.ui.traversalDFS')}</div>
                  </div>
                  <div className="relative group border-l border-gray-300 dark:border-gray-600">
                    <button type="button" aria-label={t('visualization.ui.traversalBFS')} onClick={() => setTraversal('bfs')} className={`px-2 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:focus-visible:ring-indigo-400/60 ${traversal==='bfs' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>BFS</button>
                    <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 dark:bg-gray-950 text-white px-2 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity z-10">{t('visualization.ui.traversalBFS')}</div>
                  </div>
                </div>
              </div>
              <div className="relative group flex items-center gap-1 cursor-pointer select-none">
                <input type="checkbox" id="includeVersionDetailsToggle" className="rounded border-gray-300 dark:border-gray-600 cursor-pointer bg-white dark:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:focus-visible:ring-indigo-400/60" checked={includeVersionDetails} onChange={e => setIncludeVersionDetails(e.target.checked)} aria-describedby="includeVersionDetailsHint" />
                <label htmlFor="includeVersionDetailsToggle" className="text-gray-600 dark:text-gray-400 cursor-pointer">{t('visualization.ui.includeVersionDetails')}</label>
                <div id="includeVersionDetailsHint" className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 dark:bg-gray-950 text-white px-2 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">{t('visualization.ui.includeVersionDetailsDesc')}</div>
              </div>
            </div>
          )}
        </div>
        <ViewModeSwitch value={viewMode} onChange={m => setViewMode(m)} labels={{ tree: t('visualization.viewModes.tree'), dag: t('visualization.viewModes.dag'), force: t('visualization.viewModes.force'), virtual: t('visualization.viewModes.virtual') }} />
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
            <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
              <>
                <div className="text-gray-800 dark:text-gray-100">{sgMessage || t('visualization.status.subgraphUnavailable')}</div>
                <div className="text-xs text-gray-500 dark:text-gray-500">{t('visualization.status.developmentProxy')}</div>
                <div className="text-xs text-gray-500 dark:text-gray-500">{t('visualization.status.currentlySubgraphMode')}</div>
                <div className="flex gap-2">
                  <button onClick={() => setMode('contract')} className="px-3 py-1 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60 transition-colors">{t('visualization.status.switchToContract')}</button>
                  {proxyHint && (
                    <button onClick={() => { (window as any).dispatchEvent(new CustomEvent('ft:set-subgraph-proxy')) }} className="px-3 py-1 text-xs rounded-md bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60 dark:focus-visible:ring-gray-500/60 transition-colors">{t('visualization.status.switchToProxy')}</button>
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


