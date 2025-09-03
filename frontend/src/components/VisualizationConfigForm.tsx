import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfig } from '../context/ConfigContext'
import { useDebounce } from '../hooks/useDebounce'

interface Props {
  editing: boolean
  setEditing: (v: boolean) => void
  // Status bar props
  mode: 'subgraph' | 'contract'
  sgStatus?: 'checking' | 'ok' | 'root_missing' | 'error'
  sgMessage?: string
  contractMessage?: string
  loading?: boolean
  onRefresh?: () => void
  t: any
}

export default function VisualizationConfigForm({ editing, setEditing, mode: statusMode, sgStatus, sgMessage, contractMessage, loading, onRefresh, t: statusT }: Props) {
  const { t } = useTranslation()
  const { rpcUrl, contractAddress, subgraphUrl, rootHash, rootVersionIndex, update, mode } = useConfig()
  const [localRpcUrl, setLocalRpcUrl] = useState(rpcUrl)
  const [localContractAddress, setLocalContractAddress] = useState(contractAddress)
  const [localSubgraphUrl, setLocalSubgraphUrl] = useState(subgraphUrl)
  const [localRootHash, setLocalRootHash] = useState(rootHash)
  const [localVersion, setLocalVersion] = useState(rootVersionIndex)
  const [errors, setErrors] = useState<{ rpc?: string; contract?: string; subgraph?: string; root?: string }>({})

  // sync external changes
  useEffect(() => {
    setLocalRpcUrl(rpcUrl)
    setLocalContractAddress(contractAddress)
    setLocalSubgraphUrl(subgraphUrl)
    setLocalRootHash(rootHash)
    setLocalVersion(rootVersionIndex)
  }, [rpcUrl, contractAddress, subgraphUrl, rootHash, rootVersionIndex])

  const hasDiff = (
    localRpcUrl !== rpcUrl ||
    localContractAddress !== contractAddress ||
    localSubgraphUrl !== subgraphUrl ||
    localRootHash !== rootHash
  )

  const applyConfigChanges = () => {
    if (!validateAll()) return
    update({
      rpcUrl: localRpcUrl,
      contractAddress: localContractAddress,
      subgraphUrl: localSubgraphUrl,
      rootHash: localRootHash,
    })
    setEditing(false)
  }

  const cancel = () => {
    setLocalRpcUrl(rpcUrl)
    setLocalContractAddress(contractAddress)
    setLocalSubgraphUrl(subgraphUrl)
    setLocalRootHash(rootHash)
    setEditing(false)
  }

  // debounce version apply on blur or enter
  const applyVersion = () => update({ rootVersionIndex: localVersion })

  // validation helpers
  const isAddress = (v: string) => /^0x[a-fA-F0-9]{40}$/.test(v.trim())
  const isHash32 = (v: string) => /^0x[a-fA-F0-9]{64}$/.test(v.trim())
  const isUrl = (v: string) => /^https?:\/\//i.test(v) || v.startsWith('/')
  const validateAll = () => {
    const next: typeof errors = {}
    if (!isUrl(localRpcUrl)) next.rpc = 'visualization.validation.rpc'
    if (!isAddress(localContractAddress)) next.contract = 'visualization.validation.contract'
    if (mode === 'subgraph' && !isUrl(localSubgraphUrl)) next.subgraph = 'visualization.validation.subgraph'
    if (!isHash32(localRootHash)) next.root = 'visualization.validation.root'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  useEffect(() => { if (editing) validateAll() }, [editing, localRpcUrl, localContractAddress, localSubgraphUrl, localRootHash, mode])

  // debounce version change (auto apply after 600ms idle)
  useDebounce(localVersion, 600, v => { if (v !== rootVersionIndex) applyVersion() })

  // Status badge logic
  const colorMap: Record<string, string> = {
    checking: 'bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 border-amber-300/60 dark:from-amber-900/40 dark:to-orange-900/30 dark:text-amber-300 dark:border-amber-600/40 shadow-sm backdrop-blur-sm',
    ok: 'bg-gradient-to-r from-emerald-100 to-green-100 text-emerald-700 border-emerald-300/60 dark:from-emerald-900/40 dark:to-green-900/30 dark:text-emerald-300 dark:border-emerald-600/40 shadow-sm backdrop-blur-sm',
    root_missing: 'bg-gradient-to-r from-rose-100 to-red-100 text-rose-700 border-rose-300/60 dark:from-rose-900/40 dark:to-red-900/30 dark:text-rose-300 dark:border-rose-600/40 shadow-sm backdrop-blur-sm',
    error: 'bg-gradient-to-r from-red-100 to-rose-100 text-red-700 border-red-300/60 dark:from-red-900/40 dark:to-rose-900/30 dark:text-red-300 dark:border-red-600/40 shadow-sm backdrop-blur-sm'
  }

  const getStatusBadge = () => {
    if (statusMode === 'subgraph' && sgStatus) {
      return (
        <span className={`inline-flex items-center px-2 py-1 rounded-md border text-xs font-semibold ${colorMap[sgStatus]}`}>
          {statusT ? statusT(`visualization.status.badge.${sgStatus}`) : sgStatus}
        </span>
      )
    }
    // Contract status inference
    if (loading) {
      return <span className="inline-flex items-center px-2 py-1 rounded-md border text-xs font-semibold bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 border-amber-300/60 dark:from-amber-900/40 dark:to-orange-900/30 dark:text-amber-300 dark:border-amber-600/40 shadow-sm backdrop-blur-sm">{statusT ? statusT('visualization.status.badge.checking') : 'Loading'}</span>
    }
    if (contractMessage) {
      return <span className="inline-flex items-center px-2 py-1 rounded-md border text-xs font-semibold bg-gradient-to-r from-red-100 to-rose-100 text-red-700 border-red-300/60 dark:from-red-900/40 dark:to-rose-900/30 dark:text-red-300 dark:border-red-600/40 shadow-sm backdrop-blur-sm">{statusT ? statusT('visualization.status.badge.error') : 'Error'}</span>
    }
    return <span className="inline-flex items-center px-2 py-1 rounded-md border text-xs font-semibold bg-gradient-to-r from-emerald-100 to-green-100 text-emerald-700 border-emerald-300/60 dark:from-emerald-900/40 dark:to-green-900/30 dark:text-emerald-300 dark:border-emerald-600/40 shadow-sm backdrop-blur-sm">{statusT ? statusT('visualization.status.badge.ok') : 'OK'}</span>
  }

  return (
    <div className="text-sm text-slate-600 dark:text-slate-300 p-6">
      <div className="flex items-center gap-4 mb-6">
        <span className="text-lg font-bold text-transparent bg-gradient-to-r from-slate-800 via-blue-600 to-purple-600 dark:from-slate-200 dark:via-blue-400 dark:to-purple-400 bg-clip-text">
          {mode === 'subgraph' ? t('visualization.ui.subgraphModeConfig') : t('visualization.ui.contractModeConfig')}
        </span>
        
        {/* Status Badge */}
        {getStatusBadge()}
        
        {/* Refresh Button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-slate-300/60 dark:border-slate-600/60 bg-white/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-slate-700/80 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md backdrop-blur-sm group flex-shrink-0"
            disabled={loading}
            title={statusT ? statusT('visualization.actions.refresh') : 'Refresh'}
          >
            <svg className={`w-3 h-3 ${loading ? 'animate-spin' : 'group-hover:rotate-180'} transition-transform duration-300`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        )}
        
        {/* Spacer */}
        <div className="flex-1"></div>
        
        {/* Edit/Save/Cancel Buttons */}
        {editing ? (
          <div className="flex gap-2">
            <button
              onClick={applyConfigChanges}
              disabled={!hasDiff}
              className={`px-3 py-1.5 text-xs rounded-lg transition-all duration-200 font-semibold ${hasDiff ? 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white shadow-md hover:shadow-lg' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'}`}
            >{t('settings.ui.save')}</button>
            <button onClick={cancel} className="px-3 py-1.5 text-xs rounded-lg bg-slate-600 dark:bg-slate-500 text-white hover:bg-slate-700 dark:hover:bg-slate-600 transition-all duration-200 shadow-md hover:shadow-lg font-semibold">{t('settings.ui.cancel')}</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-xs rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-md hover:shadow-lg font-semibold">{t('settings.ui.edit')}</button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">{t('visualization.config.rpc')}:</label>
            <input type="text" value={localRpcUrl} onChange={e => setLocalRpcUrl(e.target.value)} className={`w-full px-4 py-3 text-sm font-mono rounded-lg border bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 backdrop-blur-sm shadow-sm ${errors.rpc ? 'border-red-400 focus:border-red-500 focus:ring-red-500/60 dark:border-red-500' : 'border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-blue-500/60 dark:focus:border-blue-400 dark:focus:ring-blue-400/60 hover:border-blue-400 dark:hover:border-blue-500'}`} />
            {errors.rpc && <div className="text-red-500 dark:text-red-400 text-xs mt-1.5 font-medium">{t(errors.rpc, 'RPC format error')}</div>}
          </div>
          <div>
            <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">{t('visualization.config.contract')}:</label>
            <input type="text" value={localContractAddress} onChange={e => setLocalContractAddress(e.target.value)} className={`w-full px-4 py-3 text-sm font-mono rounded-lg border bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 backdrop-blur-sm shadow-sm ${errors.contract ? 'border-red-400 focus:border-red-500 focus:ring-red-500/60 dark:border-red-500' : 'border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-blue-500/60 dark:focus:border-blue-400 dark:focus:ring-blue-400/60 hover:border-blue-400 dark:hover:border-blue-500'}`} />
            {errors.contract && <div className="text-red-500 dark:text-red-400 text-xs mt-1.5 font-medium">{t(errors.contract, 'Contract address format error')}</div>}
          </div>
          {mode === 'subgraph' && (
            <div>
              <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">{t('visualization.config.subgraph')}:</label>
              <input type="text" value={localSubgraphUrl} onChange={e => setLocalSubgraphUrl(e.target.value)} className={`w-full px-4 py-3 text-sm font-mono rounded-lg border bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 backdrop-blur-sm shadow-sm ${errors.subgraph ? 'border-red-400 focus:border-red-500 focus:ring-red-500/60 dark:border-red-500' : 'border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-blue-500/60 dark:focus:border-blue-400 dark:focus:ring-blue-400/60 hover:border-blue-400 dark:hover:border-blue-500'}`} />
              {errors.subgraph && <div className="text-red-500 dark:text-red-400 text-xs mt-1.5 font-medium">{t(errors.subgraph, 'Subgraph format error')}</div>}
            </div>
          )}
          <div>
            <label className="block text-slate-700 dark:text-slate-300 mb-2 font-semibold">{t('visualization.config.root')}:</label>
            <input type="text" value={localRootHash} onChange={e => setLocalRootHash(e.target.value)} className={`w-full px-4 py-3 text-sm font-mono rounded-lg border bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 backdrop-blur-sm shadow-sm ${errors.root ? 'border-red-400 focus:border-red-500 focus:ring-red-500/60 dark:border-red-500' : 'border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-blue-500/60 dark:focus:border-blue-400 dark:focus:ring-blue-400/60 hover:border-blue-400 dark:hover:border-blue-500'}`} />
            {errors.root && <div className="text-red-500 dark:text-red-400 text-xs mt-1.5 font-medium">{t(errors.root, 'Root Hash format error')}</div>}
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-slate-700 dark:text-slate-300">
          <div className="bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-800/50 dark:to-blue-900/30 p-3 rounded-lg border border-slate-200/50 dark:border-slate-700/30">
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t('visualization.config.rpc')}: </span>
            <span className="font-mono text-blue-600 dark:text-blue-400 break-all">{rpcUrl}</span>
          </div>
          <div className="bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-800/50 dark:to-blue-900/30 p-3 rounded-lg border border-slate-200/50 dark:border-slate-700/30">
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t('visualization.config.contract')}: </span>
            <span className="font-mono text-blue-600 dark:text-blue-400 break-all">{contractAddress}</span>
          </div>
          {mode === 'subgraph' && subgraphUrl && (
            <div className="bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-800/50 dark:to-blue-900/30 p-3 rounded-lg border border-slate-200/50 dark:border-slate-700/30">
              <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t('visualization.config.subgraph')}: </span>
              <span className="font-mono text-blue-600 dark:text-blue-400 break-all">{subgraphUrl}</span>
            </div>
          )}
        </div>
      )}

      {/* Responsive version controls */}
      <div className="mt-6 pt-4 border-t border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-800/50 dark:to-blue-900/30 p-4 rounded-lg border border-slate-200/50 dark:border-slate-700/30 backdrop-blur-sm">
        <div className="mb-3">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('visualization.config.root')}: </span>
          <span className="font-mono text-blue-600 dark:text-blue-400 break-all text-sm">{rootHash}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-600 dark:text-slate-300 whitespace-nowrap text-sm font-semibold">{t('visualization.ui.versionNumber')}:</span>
          <div className="flex items-center gap-2">
            <button
              className="w-8 h-8 rounded-lg border text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/90 hover:bg-blue-50 dark:hover:bg-slate-700 shrink-0 transition-all duration-200 shadow-md hover:shadow-lg font-semibold flex items-center justify-center backdrop-blur-sm"
              onClick={() => setLocalVersion(v => Math.max(1, (v || 1) - 1))}
            >-</button>
            <input
              type="number"
              min={1}
              value={localVersion}
              onChange={e => setLocalVersion(Math.max(1, Number(e.target.value)))}
              onBlur={applyVersion}
              onKeyDown={e => { if (e.key === 'Enter') applyVersion() }}
              className="w-20 h-8 text-sm rounded-lg border border-slate-300 dark:border-slate-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500/60 dark:focus:ring-blue-400/60 px-3 bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all duration-200 shadow-sm backdrop-blur-sm font-semibold text-center"
            />
            <button
              className="w-8 h-8 rounded-lg border text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 bg-white/90 dark:bg-slate-800/90 hover:bg-blue-50 dark:hover:bg-slate-700 shrink-0 transition-all duration-200 shadow-sm hover:shadow-md font-semibold flex items-center justify-center backdrop-blur-sm"
              onClick={() => setLocalVersion(v => (v || 1) + 1)}
            >+</button>
          </div>
        </div>
      </div>
    </div>
  )
}
