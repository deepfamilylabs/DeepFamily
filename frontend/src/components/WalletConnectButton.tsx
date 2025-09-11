import { useWallet } from '../context/WalletContext'
import { useTranslation } from 'react-i18next'
import { Wallet, LogOut, AlertCircle } from 'lucide-react'

interface WalletConnectButtonProps {
  className?: string
  showBalance?: boolean
}

export default function WalletConnectButton({ 
  className = '', 
  showBalance = true 
}: WalletConnectButtonProps) {
  const { 
    address, 
    balance, 
    isConnecting, 
    chainId, 
    connect, 
    disconnect 
  } = useWallet()
  
  const { t } = useTranslation()

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const formatBalance = (bal: string) => {
    const num = parseFloat(bal)
    if (num < 0.001) return '< 0.001 ETH'
    return `${num.toFixed(3)} ETH`
  }

  if (!address) {
    return (
      <button
        onClick={connect}
        disabled={isConnecting}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
      >
        {isConnecting ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span className="text-sm font-medium">{t('wallet.connecting', 'Connecting...')}</span>
          </>
        ) : (
          <>
            <Wallet className="w-4 h-4" />
            <span className="text-sm font-medium">{t('wallet.connect', 'Connect Wallet')}</span>
          </>
        )}
      </button>
    )
  }

  // Wrong network indicator
  const isWrongNetwork = chainId && ![1, 5, 11155111, 17000].includes(chainId) // Mainnet, Goerli, Sepolia, Holesky

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {isWrongNetwork && (
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
          <AlertCircle className="w-3 h-3" />
          <span className="text-xs">{t('wallet.wrongNetwork', 'Wrong Network')}</span>
        </div>
      )}
      
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700">
        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
        
        <div className="flex flex-col items-start gap-0.5">
          <div className="flex items-center gap-1">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 font-mono">
              {formatAddress(address)}
            </span>
          </div>
          
          {showBalance && balance && (
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {formatBalance(balance)}
            </span>
          )}
        </div>
        
        <button
          onClick={disconnect}
          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          title={t('wallet.disconnect', 'Disconnect')}
        >
          <LogOut className="w-3 h-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" />
        </button>
      </div>
    </div>
  )
}