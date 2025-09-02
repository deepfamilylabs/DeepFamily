interface StatusBarProps {
  mode: 'subgraph' | 'contract'
  sgStatus: 'checking' | 'ok' | 'root_missing' | 'error'
  sgMessage?: string
  contractMessage?: string
  t: any
  onRefresh: () => void
  loading: boolean
}

const colorMap: Record<string, string> = {
  checking: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/40',
  ok: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700/40',
  root_missing: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700/40',
  error: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700/40'
}

export default function StatusBar({ mode, sgStatus, sgMessage, contractMessage, t, onRefresh, loading }: StatusBarProps) {
  const badge = () => {
    if (mode === 'subgraph') {
      return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${colorMap[sgStatus]}`}>
          {t(`visualization.status.badge.${sgStatus}`)}
        </span>
      )
    }
    // simple contract status inference
    if (loading) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/40">{t('visualization.status.badge.checking')}</span>
    }
    if (contractMessage) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700/40">{t('visualization.status.badge.error')}</span>
    }
    return <span className="inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700/40">{t('visualization.status.badge.ok')}</span>
  }

  const detailText = () => {
    if (mode === 'subgraph') {
      if (sgStatus === 'ok') return t('visualization.status.subgraphOk')
      return sgMessage || t('visualization.status.subgraphUnavailable')
    }
    return contractMessage || t('visualization.status.contractOk')
  }

  return (
    <div className="flex items-center gap-3 text-xs">
      {badge()}
      <div className="text-gray-600 dark:text-gray-400 line-clamp-1 max-w-[420px] flex-1">{detailText()}</div>
      <button
        onClick={onRefresh}
        className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:focus-visible:ring-indigo-400/60 disabled:opacity-60 transition-colors"
        disabled={loading}
      >
        <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
        <span>{t('visualization.actions.refresh')}</span>
      </button>
    </div>
  )
}
