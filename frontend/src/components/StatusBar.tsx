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
  checking: 'bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 border-amber-300/60 dark:from-amber-900/40 dark:to-orange-900/30 dark:text-amber-300 dark:border-amber-600/40 shadow-sm backdrop-blur-sm',
  ok: 'bg-gradient-to-r from-emerald-100 to-green-100 text-emerald-700 border-emerald-300/60 dark:from-emerald-900/40 dark:to-green-900/30 dark:text-emerald-300 dark:border-emerald-600/40 shadow-sm backdrop-blur-sm',
  root_missing: 'bg-gradient-to-r from-rose-100 to-red-100 text-rose-700 border-rose-300/60 dark:from-rose-900/40 dark:to-red-900/30 dark:text-rose-300 dark:border-rose-600/40 shadow-sm backdrop-blur-sm',
  error: 'bg-gradient-to-r from-red-100 to-rose-100 text-red-700 border-red-300/60 dark:from-red-900/40 dark:to-rose-900/30 dark:text-red-300 dark:border-red-600/40 shadow-sm backdrop-blur-sm'
}

export default function StatusBar({ mode, sgStatus, sgMessage, contractMessage, t, onRefresh, loading }: StatusBarProps) {
  const badge = () => {
    if (mode === 'subgraph') {
      return (
        <span className={`inline-flex items-center px-3 py-1.5 rounded-lg border text-xs font-semibold ${colorMap[sgStatus]}`}>
          {t(`visualization.status.badge.${sgStatus}`)}
        </span>
      )
    }
    // simple contract status inference
    if (loading) {
      return <span className="inline-flex items-center px-3 py-1.5 rounded-lg border text-xs font-semibold bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 border-amber-300/60 dark:from-amber-900/40 dark:to-orange-900/30 dark:text-amber-300 dark:border-amber-600/40 shadow-sm backdrop-blur-sm">{t('visualization.status.badge.checking')}</span>
    }
    if (contractMessage) {
      return <span className="inline-flex items-center px-3 py-1.5 rounded-lg border text-xs font-semibold bg-gradient-to-r from-red-100 to-rose-100 text-red-700 border-red-300/60 dark:from-red-900/40 dark:to-rose-900/30 dark:text-red-300 dark:border-red-600/40 shadow-sm backdrop-blur-sm">{t('visualization.status.badge.error')}</span>
    }
    return <span className="inline-flex items-center px-3 py-1.5 rounded-lg border text-xs font-semibold bg-gradient-to-r from-emerald-100 to-green-100 text-emerald-700 border-emerald-300/60 dark:from-emerald-900/40 dark:to-green-900/30 dark:text-emerald-300 dark:border-emerald-600/40 shadow-sm backdrop-blur-sm">{t('visualization.status.badge.ok')}</span>
  }

  const detailText = () => {
    if (mode === 'subgraph') {
      if (sgStatus === 'ok') return t('visualization.status.subgraphOk')
      return sgMessage || t('visualization.status.subgraphUnavailable')
    }
    return contractMessage || t('visualization.status.contractOk')
  }

  return (
    <div className="flex items-center justify-between gap-3 text-sm p-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {badge()}
        <div className="text-slate-700 dark:text-slate-300 truncate flex-1 font-medium">{detailText()}</div>
      </div>
      <button
        onClick={onRefresh}
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-300/60 dark:border-slate-600/60 bg-white/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-slate-700/80 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md backdrop-blur-sm group flex-shrink-0"
        disabled={loading}
        title={t('visualization.actions.refresh')}
      >
        <svg className={`w-4 h-4 ${loading ? 'animate-spin' : 'group-hover:rotate-180'} transition-transform duration-300`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
      </button>
    </div>
  )
}
