import React from 'react'
import { AlertTriangle, RefreshCw, Download, Settings, CheckCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface WalletTroubleshootingProps {
  isOpen: boolean
  onClose: () => void
}

export default function WalletTroubleshooting({ isOpen, onClose }: WalletTroubleshootingProps) {
  const { t } = useTranslation()

  if (!isOpen) return null

  const steps = [
    {
      icon: CheckCircle,
      title: 'Check Wallet Installation',
      description: 'Make sure you have MetaMask or Conflux Portal installed',
      action: 'Install Wallet',
      link: 'https://metamask.io/download/'
    },
    {
      icon: Settings,
      title: 'Disable Conflicting Extensions',
      description: 'If you have multiple wallet extensions, try disabling all except one',
      action: 'Open Extensions',
      onClick: () => {
        if (window.location.protocol === 'chrome:') return
        window.open('chrome://extensions/', '_blank')
      }
    },
    {
      icon: RefreshCw,
      title: 'Clear Browser Data',
      description: 'Clear browser cache and local storage to reset wallet state',
      action: 'Clear & Reload',
      onClick: () => {
        // Clear wallet-related localStorage
        Object.keys(localStorage).forEach(key => {
          if (key.includes('wallet') || key.includes('metamask') || key.includes('conflux')) {
            localStorage.removeItem(key)
          }
        })
        window.location.reload()
      }
    },
    {
      icon: AlertTriangle,
      title: 'Reset Wallet Connection',
      description: 'If problems persist, try resetting your wallet connection in the extension',
      action: 'Debug Info',
      onClick: () => {
        const debug = (window as any).walletDebug
        if (debug) {
          console.log('Wallet conflicts:', debug.detectConflicts())
          alert('Check browser console for debug information')
        }
      }
    }
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Wallet Connection Troubleshooting
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
              <div>
                <h3 className="font-medium text-yellow-800 dark:text-yellow-200">
                  Common Issues
                </h3>
                <ul className="text-sm text-yellow-700 dark:text-yellow-300 mt-2 space-y-1">
                  <li>• Multiple wallet extensions causing conflicts</li>
                  <li>• SSL/HTTPS protocol errors in development</li>
                  <li>• Cached wallet state from previous sessions</li>
                  <li>• Wallet extension needs updating</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Troubleshooting Steps
            </h3>
            
            {steps.map((step, index) => {
              const Icon = step.icon
              return (
                <div key={index} className="flex items-start gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                      <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-1">
                      {step.title}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      {step.description}
                    </p>
                    
                    {(step.link || step.onClick) && (
                      <button
                        onClick={step.onClick || (() => window.open(step.link, '_blank'))}
                        className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                      >
                        {step.action}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
            <h3 className="font-medium text-blue-800 dark:text-blue-200 mb-2">
              Still Having Issues?
            </h3>
            <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
              If the problem persists, try using a different browser or incognito mode. 
              Make sure you're using the latest version of your wallet extension.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => window.open('https://support.metamask.io/', '_blank')}
                className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                MetaMask Support
              </button>
              <button
                onClick={() => window.location.reload()}
                className="text-sm px-3 py-1 border border-blue-600 text-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
