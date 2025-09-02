import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfig } from '../context/ConfigContext'
import { useDebounce } from '../hooks/useDebounce'

interface Props {
  editing: boolean
  setEditing: (v: boolean) => void
}

export default function VisualizationConfigForm({ editing, setEditing }: Props) {
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

  return (
    <div className="text-xs text-gray-600 dark:text-gray-300">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {mode === 'subgraph' ? t('visualization.ui.subgraphModeConfig') : t('visualization.ui.contractModeConfig')}
        </span>
        {editing ? (
          <div className="flex gap-1">
            <button
              onClick={applyConfigChanges}
              disabled={!hasDiff}
              className={`px-2 py-1 text-xs rounded transition-colors ${hasDiff ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'}`}
            >{t('settings.ui.save')}</button>
            <button onClick={cancel} className="px-2 py-1 text-xs rounded bg-gray-600 dark:bg-gray-500 text-white hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors">{t('settings.ui.cancel')}</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors">{t('settings.ui.edit')}</button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <div>
            <label className="block text-gray-500 dark:text-gray-400 mb-1">{t('visualization.config.rpc')}:</label>
            <input type="text" value={localRpcUrl} onChange={e => setLocalRpcUrl(e.target.value)} className={`w-full px-2 py-1 text-xs font-mono rounded border bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-colors ${errors.rpc ? 'border-red-400 focus:border-red-500 focus:ring-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/40'}`} />
            {errors.rpc && <div className="text-red-500 dark:text-red-400 text-[10px] mt-0.5">{t(errors.rpc, 'RPC format error')}</div>}
          </div>
          <div>
            <label className="block text-gray-500 dark:text-gray-400 mb-1">{t('visualization.config.contract')}:</label>
            <input type="text" value={localContractAddress} onChange={e => setLocalContractAddress(e.target.value)} className={`w-full px-2 py-1 text-xs font-mono rounded border bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-colors ${errors.contract ? 'border-red-400 focus:border-red-500 focus:ring-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/40'}`} />
            {errors.contract && <div className="text-red-500 dark:text-red-400 text-[10px] mt-0.5">{t(errors.contract, 'Contract address format error')}</div>}
          </div>
          {mode === 'subgraph' && (
            <div>
              <label className="block text-gray-500 dark:text-gray-400 mb-1">{t('visualization.config.subgraph')}:</label>
              <input type="text" value={localSubgraphUrl} onChange={e => setLocalSubgraphUrl(e.target.value)} className={`w-full px-2 py-1 text-xs font-mono rounded border bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-colors ${errors.subgraph ? 'border-red-400 focus:border-red-500 focus:ring-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/40'}`} />
              {errors.subgraph && <div className="text-red-500 dark:text-red-400 text-[10px] mt-0.5">{t(errors.subgraph, 'Subgraph format error')}</div>}
            </div>
          )}
          <div>
            <label className="block text-gray-500 dark:text-gray-400 mb-1">{t('visualization.config.root')}:</label>
            <input type="text" value={localRootHash} onChange={e => setLocalRootHash(e.target.value)} className={`w-full px-2 py-1 text-xs font-mono rounded border bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-colors ${errors.root ? 'border-red-400 focus:border-red-500 focus:ring-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/40'}`} />
            {errors.root && <div className="text-red-500 dark:text-red-400 text-[10px] mt-0.5">{t(errors.root, 'Root Hash format error')}</div>}
          </div>
        </div>
      ) : (
        <div className="space-y-1 text-gray-700 dark:text-gray-300">
          <div>{t('visualization.config.rpc')}: <span className="font-mono text-blue-600 dark:text-blue-400">{rpcUrl}</span></div>
          <div>{t('visualization.config.contract')}: <span className="font-mono text-blue-600 dark:text-blue-400">{contractAddress}</span></div>
          {mode === 'subgraph' && subgraphUrl && (<div>{t('visualization.config.subgraph')}: <span className="font-mono text-blue-600 dark:text-blue-400">{subgraphUrl}</span></div>)}
        </div>
      )}

      {/* Responsive version controls */}
      <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="basis-full sm:basis-auto text-xs text-gray-700 dark:text-gray-300">
          {t('visualization.config.root')}: <span className="font-mono text-blue-600 dark:text-blue-400 break-all">{rootHash}</span>
        </span>
        <div className="flex items-center gap-2 flex-none">
          <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">{t('visualization.ui.versionNumber')}:</span>
          <div className="flex items-center gap-1">
            <button
              className="px-2 py-0.5 rounded border text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 shrink-0 transition-colors"
              onClick={() => setLocalVersion(v => Math.max(1, (v || 1) - 1))}
            >-</button>
            <input
              type="number"
              min={1}
              value={localVersion}
              onChange={e => setLocalVersion(Math.max(1, Number(e.target.value)))}
              onBlur={applyVersion}
              onKeyDown={e => { if (e.key === 'Enter') applyVersion() }}
              className="w-16 h-6 text-xs rounded-md border border-gray-300 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-blue-500 dark:focus:ring-blue-400 px-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
            />
            <button
              className="px-2 py-0.5 rounded border text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 shrink-0 transition-colors"
              onClick={() => setLocalVersion(v => (v || 1) + 1)}
            >+</button>
          </div>
        </div>
      </div>
    </div>
  )
}
