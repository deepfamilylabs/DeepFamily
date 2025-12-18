const DEFAULT_IPFS_GATEWAY_BASE_URLS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
] as const

const parseList = (value: string | undefined): string[] => {
  if (!value) return []
  return value
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

const normalizeGatewayBaseUrl = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    // Validate URL and normalize trailing slash.
    const url = new URL(trimmed)
    const lowerPath = url.pathname.toLowerCase()
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/ipfs/'
    } else if (lowerPath.endsWith('/ipfs')) {
      url.pathname = `${url.pathname}/`
    } else if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`
    }
    return url.toString()
  } catch {
    return null
  }
}

const fromEnv = (() => {
  const env = (import.meta as any).env as Record<string, string | undefined>
  const raw = env?.VITE_IPFS_GATEWAY_BASE_URLS
  const list = parseList(raw)
  const normalized = list.map(normalizeGatewayBaseUrl).filter((v): v is string => Boolean(v))
  return normalized
})()

export const IPFS_GATEWAY_BASE_URLS: readonly string[] =
  fromEnv.length > 0 ? fromEnv : DEFAULT_IPFS_GATEWAY_BASE_URLS
