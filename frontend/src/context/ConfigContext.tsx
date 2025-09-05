import React, { createContext, useContext, useMemo, useState } from 'react'

type ConfigValues = {
  rpcUrl: string
  contractAddress: string
  rootHash: string
  rootVersionIndex: number
}

export type AppConfig = ConfigValues & {
  update: (partial: Partial<ConfigValues>) => void
  reset: () => void
  defaults: ConfigValues
}

const STORAGE_KEY = 'ft:config'
const ConfigContext = createContext<AppConfig | null>(null)

function getEnvDefaults(): ConfigValues {
  return {
    rpcUrl: (import.meta as any).env.VITE_RPC_URL,
    contractAddress: (import.meta as any).env.VITE_CONTRACT_ADDRESS,
    rootHash: (import.meta as any).env.VITE_ROOT_PERSON_HASH,
    rootVersionIndex: Number((import.meta as any).env.VITE_ROOT_VERSION_INDEX),
  }
}

function loadStoredConfig(): Partial<ConfigValues> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as Partial<ConfigValues> : null
  } catch {
    return null
  }
}

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const defaults = useMemo(() => getEnvDefaults(), [])
  const [state, setState] = useState<ConfigValues>(() => ({
    ...defaults,
    ...(loadStoredConfig() || {}),
  }))

  const update = (partial: Partial<ConfigValues>) => {
    setState(prev => {
      const next = { ...prev, ...partial }
      try {
        const { rpcUrl, contractAddress, rootHash, rootVersionIndex } = next
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ rpcUrl, contractAddress, rootHash, rootVersionIndex }))
      } catch {}
      return next
    })
  }

  const reset = () => {
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
    setState(getEnvDefaults())
  }

  const value = useMemo<AppConfig>(() => ({
    ...state,
    update,
    reset,
    defaults,
  }), [state, defaults])

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig() {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider')
  return ctx
}


