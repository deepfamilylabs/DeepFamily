import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, HelpCircle } from 'lucide-react'
import WalletTroubleshooting from './WalletTroubleshooting'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: ErrorInfo
  showTroubleshooting: boolean
}

class WalletErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { 
      hasError: false,
      showTroubleshooting: false
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Wallet Error Boundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined })
    // Reload the page to reset the wallet state
    window.location.reload()
  }

  handleShowTroubleshooting = () => {
    this.setState({ showTroubleshooting: true })
  }

  handleCloseTroubleshooting = () => {
    this.setState({ showTroubleshooting: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <>
          <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
              <div className="mb-4">
                <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                  Wallet Connection Error
                </h2>
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  There was an issue with your wallet connection. This might be due to:
                </p>
                <ul className="text-sm text-gray-500 dark:text-gray-400 text-left space-y-1 mb-6">
                  <li>• Multiple wallet extensions conflicting</li>
                  <li>• Wallet extension needs to be updated</li>
                  <li>• Network connectivity issues</li>
                  <li>• Browser cache issues</li>
                </ul>
              </div>
              
              <div className="space-y-3">
                <button
                  onClick={this.handleRetry}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry Connection
                </button>
                
                <button
                  onClick={this.handleShowTroubleshooting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <HelpCircle className="w-4 h-4" />
                  Troubleshooting Guide
                </button>
                
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  <details>
                    <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
                      Technical Details
                    </summary>
                    <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-700 rounded text-left">
                      <p className="font-mono text-xs">
                        {this.state.error?.message}
                      </p>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </div>
          
          <WalletTroubleshooting
            isOpen={this.state.showTroubleshooting}
            onClose={this.handleCloseTroubleshooting}
          />
        </>
      )
    }

    return this.props.children
  }
}

export default WalletErrorBoundary
