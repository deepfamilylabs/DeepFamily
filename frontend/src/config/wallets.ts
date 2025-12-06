import metamaskIcon from '../assets/metamask-icon.svg'
import fluentIcon from '../assets/fluent-icon.svg'

export interface WalletConfig {
  id: string
  name: string
  icon: string
  installUrl: string
  detect: (provider: any) => boolean
  // 样式配置
  colors: {
    gradient: string
    shadow: string
    hoverShadow: string
  }
}

export const SUPPORTED_WALLETS: WalletConfig[] = [
  {
    id: 'metamask',
    name: 'MetaMask',
    icon: metamaskIcon,
    installUrl: 'https://metamask.io/download/',
    detect: (provider) => provider?.isMetaMask && !provider?.isFluent && !provider?.isFluentWallet,
    colors: {
      gradient: 'from-[#E2761B] to-[#CD6116]',
      shadow: 'shadow-[#E2761B]/30',
      hoverShadow: 'hover:shadow-[#E2761B]/40'
    }
  },
  {
    id: 'fluent',
    name: 'Fluent Wallet',
    icon: fluentIcon,
    installUrl: 'https://fluentwallet.com/',
    detect: (provider) => provider?.isFluent || provider?.isFluentWallet,
    colors: {
      gradient: 'from-[#15B2A2] to-[#0E8A7D]',
      shadow: 'shadow-[#15B2A2]/30',
      hoverShadow: 'hover:shadow-[#15B2A2]/40'
    }
  }
]

export function getWalletConfig(walletId: string): WalletConfig | undefined {
  return SUPPORTED_WALLETS.find(w => w.id === walletId)
}
