import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { CheckCircle, XCircle, Info, AlertTriangle } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info' | 'warning'

type Toast = {
  id: number
  message: string
  type: ToastType
}

type ToastContextType = {
  show: (message: string, durationMs?: number) => void
  success: (message: string, durationMs?: number) => void
  error: (message: string, durationMs?: number) => void
  info: (message: string, durationMs?: number) => void
  warning: (message: string, durationMs?: number) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

const TOAST_STYLES: Record<ToastType, {
  container: string
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
}> = {
  success: {
    container: 'border-green-200 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-100',
    icon: CheckCircle,
    iconColor: 'text-green-600 dark:text-green-400'
  },
  error: {
    container: 'border-red-200 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-100',
    icon: XCircle,
    iconColor: 'text-red-600 dark:text-red-400'
  },
  info: {
    container: 'border-blue-200 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-100',
    icon: Info,
    iconColor: 'text-blue-600 dark:text-blue-400'
  },
  warning: {
    container: 'border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-100',
    icon: AlertTriangle,
    iconColor: 'text-yellow-600 dark:text-yellow-400'
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: ToastType, durationMs: number = 1800) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts(t => [...t, { id, message, type }])
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), durationMs)
  }, [])

  const show = useCallback((message: string, durationMs: number = 1800) => {
    showToast(message, 'info', durationMs)
  }, [showToast])

  const success = useCallback((message: string, durationMs: number = 2500) => {
    showToast(message, 'success', durationMs)
  }, [showToast])

  const error = useCallback((message: string, durationMs: number = 3500) => {
    showToast(message, 'error', durationMs)
  }, [showToast])

  const info = useCallback((message: string, durationMs: number = 1800) => {
    showToast(message, 'info', durationMs)
  }, [showToast])

  const warning = useCallback((message: string, durationMs: number = 2500) => {
    showToast(message, 'warning', durationMs)
  }, [showToast])

  const value = useMemo<ToastContextType>(
    () => ({ show, success, error, info, warning }),
    [show, success, error, info, warning]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* portal-like container */}
      <div className="fixed inset-x-0 bottom-4 z-[2000] flex justify-center pointer-events-none">
        <div className="space-y-2">
          {toasts.map(toast => {
            const style = TOAST_STYLES[toast.type]
            const Icon = style.icon
            return (
              <div
                key={toast.id}
                className={`pointer-events-auto mx-auto max-w-md rounded-md border shadow-lg px-3 py-2 text-sm flex items-center gap-2 ${style.container}`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${style.iconColor}`} />
                <span className="flex-1">{toast.message}</span>
              </div>
            )
          })}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}


