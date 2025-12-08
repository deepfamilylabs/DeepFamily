import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, RefreshCw, Check, ChevronRight, Zap, FlaskConical, HardDrive } from 'lucide-react'

interface NetworkOption {
  chainId: number
  nameKey: string
  defaultName: string
  tagKey: string
  defaultTag: string
  type: 'mainnet' | 'testnet' | 'local'
}

const NETWORK_OPTIONS: NetworkOption[] = [
  {
    chainId: 1030,
    nameKey: 'wallet.networks.confluxEspace',
    defaultName: 'Conflux eSpace',
    tagKey: 'wallet.mainnet',
    defaultTag: 'Mainnet',
    type: 'mainnet'
  },
  {
    chainId: 71,
    nameKey: 'wallet.networks.confluxEspaceTestnet',
    defaultName: 'Conflux eSpace Testnet',
    tagKey: 'wallet.testnet',
    defaultTag: 'Testnet',
    type: 'testnet'
  },
  {
    chainId: 31337,
    nameKey: 'wallet.networks.localDev',
    defaultName: 'Localhost',
    tagKey: 'wallet.localhost',
    defaultTag: 'Local Dev',
    type: 'local'
  }
]

interface NetworkSelectionModalProps {
  isOpen: boolean
  onSelect: (chainId: number) => Promise<boolean>
  onClose: () => void
  currentChainId?: number
}

export default function NetworkSelectionModal({
  isOpen,
  onSelect,
  onClose,
  currentChainId
}: NetworkSelectionModalProps) {
  const { t } = useTranslation()
  const [isSwitching, setIsSwitching] = useState(false)
  const [switchingTo, setSwitchingTo] = useState<number | null>(null)

  if (!isOpen) return null

  const handleSelect = async (chainId: number) => {
    if (chainId === currentChainId) return
    
    setIsSwitching(true)
    setSwitchingTo(chainId)
    try {
      const success = await onSelect(chainId)
      if (success) {
        onClose()
      }
    } finally {
      setIsSwitching(false)
      setSwitchingTo(null)
    }
  }

  const getNetworkConfig = (type: NetworkOption['type']) => {
    switch (type) {
      case 'mainnet':
        return {
          icon: <Zap className="w-5 h-5" />,
          gradient: 'from-emerald-400 via-teal-500 to-cyan-500',
          lightGradient: 'from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30',
          border: 'border-emerald-200 dark:border-emerald-700/50',
          activeBorder: 'ring-2 ring-emerald-500/50 border-emerald-400 dark:border-emerald-500',
          tag: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white',
          tagInactive: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400',
          dot: 'bg-emerald-500',
          shadow: 'shadow-emerald-500/25',
          hoverBg: 'hover:bg-emerald-50/80 dark:hover:bg-emerald-900/20'
        }
      case 'testnet':
        return {
          icon: <FlaskConical className="w-5 h-5" />,
          gradient: 'from-violet-400 via-purple-500 to-fuchsia-500',
          lightGradient: 'from-violet-50 to-purple-50 dark:from-violet-900/30 dark:to-purple-900/30',
          border: 'border-violet-200 dark:border-violet-700/50',
          activeBorder: 'ring-2 ring-violet-500/50 border-violet-400 dark:border-violet-500',
          tag: 'bg-gradient-to-r from-violet-500 to-purple-500 text-white',
          tagInactive: 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400',
          dot: 'bg-violet-500',
          shadow: 'shadow-violet-500/25',
          hoverBg: 'hover:bg-violet-50/80 dark:hover:bg-violet-900/20'
        }
      case 'local':
        return {
          icon: <HardDrive className="w-5 h-5" />,
          gradient: 'from-slate-400 via-gray-500 to-zinc-500',
          lightGradient: 'from-slate-50 to-gray-50 dark:from-slate-900/30 dark:to-gray-900/30',
          border: 'border-slate-200 dark:border-slate-700/50',
          activeBorder: 'ring-2 ring-slate-500/50 border-slate-400 dark:border-slate-500',
          tag: 'bg-gradient-to-r from-slate-500 to-gray-500 text-white',
          tagInactive: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
          dot: 'bg-slate-500',
          shadow: 'shadow-slate-500/25',
          hoverBg: 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
        }
    }
  }

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200/80 dark:border-gray-700/80">
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-800/50 dark:via-gray-900 dark:to-gray-800/50">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 dark:from-blue-500/10 dark:to-indigo-500/10 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-purple-500/5 to-pink-500/5 dark:from-purple-500/10 dark:to-pink-500/10 rounded-full translate-y-1/2 -translate-x-1/2 pointer-events-none" />
          
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            aria-label={t('common.close', 'Close')}
          >
            <X className="w-4 h-4" />
          </button>
          
          <div className="relative flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              {/* Pulse effect */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 animate-ping opacity-20" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {t('wallet.switchNetwork', 'Switch Network')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {t('wallet.selectNetworkDesc', 'Select a network to connect')}
              </p>
            </div>
          </div>
        </div>

        {/* Network Options */}
        <div className="p-4 space-y-3">
          {NETWORK_OPTIONS.map((network) => {
            const isActive = currentChainId === network.chainId
            const isLoading = switchingTo === network.chainId
            const config = getNetworkConfig(network.type)
            
            return (
              <button
                key={network.chainId}
                onClick={() => handleSelect(network.chainId)}
                disabled={isSwitching || isActive}
                className={`
                  w-full flex items-center gap-4 p-4 rounded-xl
                  border transition-all duration-200 group
                  ${isActive 
                    ? `${config.activeBorder} bg-gradient-to-r ${config.lightGradient}` 
                    : `${config.border} bg-white dark:bg-gray-800/50 ${config.hoverBg} hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-lg`
                  }
                  disabled:cursor-not-allowed
                `}
              >
                {/* Network Icon */}
                <div className="relative flex-shrink-0">
                  <div className={`
                    w-12 h-12 rounded-xl flex items-center justify-center
                    bg-gradient-to-br ${config.gradient}
                    shadow-lg ${config.shadow}
                  `}>
                    <span className="text-white">
                      {config.icon}
                    </span>
                  </div>
                  {/* Status dot */}
                  <div className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-900 ${config.dot}`}>
                    {isActive && (
                      <div className={`absolute inset-0 rounded-full ${config.dot} animate-ping opacity-75`} />
                    )}
                  </div>
                </div>

                {/* Network Info */}
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-gray-900 dark:text-white truncate">
                      {t(network.nameKey, network.defaultName)}
                    </span>
                    <span className={`
                      text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider flex-shrink-0
                      ${isActive ? config.tag : config.tagInactive}
                    `}>
                      {t(network.tagKey, network.defaultTag)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                      {t('wallet.networkId', 'ID: {{chainId}}', { chainId: network.chainId })}
                    </span>
                    {isActive && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        {t('wallet.connected', 'Connected')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Indicator */}
                <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                  {isLoading ? (
                    <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
                  ) : isActive ? (
                    <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${config.gradient} flex items-center justify-center shadow-md ${config.shadow}`}>
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 group-hover:translate-x-0.5 transition-all" />
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gradient-to-r from-gray-50 via-gray-100/50 to-gray-50 dark:from-gray-800/50 dark:via-gray-800 dark:to-gray-800/50 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center flex items-center justify-center gap-2">
            <span className="w-1 h-1 rounded-full bg-blue-500" />
            {t('wallet.networkWillBeAdded', 'Network will be added automatically if not present')}
            <span className="w-1 h-1 rounded-full bg-blue-500" />
          </p>
        </div>
      </div>
    </div>
  )
}
