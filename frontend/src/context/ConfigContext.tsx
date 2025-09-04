import React, { createContext, useContext, useMemo, useState } from 'react'

type Mode = 'subgraph' | 'contract'

type ConfigValues = {
  rpcUrl: string
  subgraphUrl: string
  contractAddress: string
  rootHash: string
  rootVersionIndex: number
  mode: Mode
}

export type AppConfig = ConfigValues & {
  setMode: (m: Mode) => void
  update: (partial: Partial<ConfigValues>) => void
  reset: () => void
  defaults: ConfigValues
}

const STORAGE_KEY = 'ft:config'
const ConfigContext = createContext<AppConfig | null>(null)

function getEnvDefaults(): ConfigValues {
  return {
    rpcUrl: (import.meta as any).env.VITE_RPC_URL || 'https://evmtestnet.confluxrpc.com',
    subgraphUrl: (import.meta as any).env.VITE_SUBGRAPH_URL || 'http://localhost:8000/subgraphs/name/deepfamily/familytree',
    contractAddress: (import.meta as any).env.VITE_CONTRACT_ADDRESS || '0x17199519B81c83641DC74700b079ABe6D9F99CD8',
    rootHash: (import.meta as any).env.VITE_ROOT_PERSON_HASH || '0x998bd09b669a42a18dace4dd87e3d754dbb7ec0b838e1e06a5a8dbddda90b1f5',
    rootVersionIndex: Number((import.meta as any).env.VITE_ROOT_VERSION_INDEX || 1),
    mode: 'contract',
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
        const { rpcUrl, subgraphUrl, contractAddress, rootHash, rootVersionIndex, mode } = next
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ rpcUrl, subgraphUrl, contractAddress, rootHash, rootVersionIndex, mode }))
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
    setMode: (m: Mode) => update({ mode: m }),
    update,
    reset,
    defaults,
  }), [state, defaults])

  React.useEffect(() => {
    const handler = () => update({ subgraphUrl: '/api/subgraph' })
    window.addEventListener('ft:set-subgraph-proxy' as any, handler)
    return () => window.removeEventListener('ft:set-subgraph-proxy' as any, handler)
  }, [])

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig() {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider')
  return ctx
}


