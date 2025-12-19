import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { NETWORK_PRESETS } from './src/config/networks'
import { IPFS_GATEWAY_BASE_URLS } from './src/config/ipfs'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const CSP_REPORT_PATH = '/__csp-report'
const CSP_HEADER = 'Content-Security-Policy'
const CSP_HEADER_REPORT_ONLY = 'Content-Security-Policy-Report-Only'

const uniq = <T,>(items: T[]): T[] => Array.from(new Set(items))

const parseExtraSources = (value: string | undefined): string[] => {
  if (!value) return []
  return value
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean)
}

const parseList = (value: string | undefined): string[] => {
  if (!value) return []
  return value
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

const urlToOrigin = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

const cspReportPlugin = (opts: { reportFile?: string }): Plugin => {
  const reportFile = opts.reportFile
  const handler = (req: any, res: any) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }

    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      raw += chunk
      if (raw.length > 64 * 1024) raw = raw.slice(0, 64 * 1024)
    })

    req.on('end', () => {
      try {
        const data = JSON.parse(raw || '{}')
        const reports = Array.isArray(data) ? data : [data]
        const safe = reports.map((r: any) => {
          const reportBody = r?.['csp-report'] ?? r?.body ?? r ?? {}
          const blocked = typeof reportBody?.['blocked-uri'] === 'string' ? reportBody['blocked-uri'] : undefined
          const violated = typeof reportBody?.['violated-directive'] === 'string' ? reportBody['violated-directive'] : undefined
          const effective = typeof reportBody?.['effective-directive'] === 'string' ? reportBody['effective-directive'] : undefined
          const doc = typeof reportBody?.['document-uri'] === 'string' ? reportBody['document-uri'] : undefined
          const ref = typeof reportBody?.referrer === 'string' ? reportBody.referrer : undefined
          const sourceFile = typeof reportBody?.['source-file'] === 'string' ? reportBody['source-file'] : undefined
          const line = typeof reportBody?.['line-number'] === 'number' ? reportBody['line-number'] : undefined
          const col = typeof reportBody?.['column-number'] === 'number' ? reportBody['column-number'] : undefined
          const sample = typeof reportBody?.['script-sample'] === 'string' ? reportBody['script-sample'] : undefined
          return { violated, effective, blocked, document: doc, referrer: ref, sourceFile, line, col, sample }
        })
        console.warn('[csp-report]', safe)
        if (reportFile) {
          for (const entry of safe) {
            fs.appendFileSync(reportFile, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`, 'utf8')
          }
        }
      } catch {
        console.warn('[csp-report] invalid JSON')
      } finally {
        res.statusCode = 204
        res.end()
      }
    })
  }

  return {
    name: 'deepfamily:csp-report-endpoint',
    configureServer(server) {
      server.middlewares.use(CSP_REPORT_PATH, handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(CSP_REPORT_PATH, handler)
    }
  }
}

const presetRpcOrigins = uniq(
  NETWORK_PRESETS
    .map(p => urlToOrigin(p.rpcUrl))
    .filter((v): v is string => Boolean(v))
)

const buildCsp = (opts: {
  dev: boolean
  connectSrc: string[]
  imgSrc: string[]
  styleAttrNone: boolean
}): string => {
  const { dev, connectSrc, imgSrc, styleAttrNone } = opts
  const scriptSrc = dev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' 'report-sample'"
    : "script-src 'self' 'wasm-unsafe-eval' 'report-sample'"

  const styleSrc = dev
    ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
    : "style-src 'self' https://fonts.googleapis.com"

  const styleSrcAttr =
    !dev && styleAttrNone
      ? "style-src-attr 'none'"
      : "style-src-attr 'unsafe-inline'"

  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
    scriptSrc,
    "script-src-attr 'none'",
    // Needed for: /zk/* fetch, IPFS gateway fetch, and user-configured RPC URLs.
    // Strict by default; extend at build-time via `DEEP_CSP_CONNECT_SRC`.
    `connect-src ${connectSrc.join(' ')}`,
    // IPFS/metadata often uses data/blob URLs locally.
    `img-src ${imgSrc.join(' ')}`,
    // Dev server injects inline <style> tags; production build should not need this.
    styleSrc,
    // React uses inline style attributes widely; allow by default, but support auditing with `DEEP_CSP_STYLE_ATTR_NONE=1`.
    styleSrcAttr,
    "font-src 'self' data: https://fonts.gstatic.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ')
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const getEnv = (key: string): string | undefined => env[key] ?? process.env[key]
  const flag = (key: string, defaultValue: boolean): boolean => {
    const value = getEnv(key)
    if (value == null) return defaultValue
    return value !== '0' && value !== 'false'
  }

  const ipfsGatewayBases = (() => {
    const fromEnv = parseList(getEnv('VITE_IPFS_GATEWAY_BASE_URLS'))
    return fromEnv.length > 0 ? fromEnv : [...IPFS_GATEWAY_BASE_URLS]
  })()

  const ipfsGatewayOrigins = uniq(
    ipfsGatewayBases
      .map(urlToOrigin)
      .filter((v): v is string => Boolean(v))
  )

  const includeNetworkPresets = flag('DEEP_CSP_INCLUDE_NETWORK_PRESETS', true)
  const includeIpfsGateways = flag('DEEP_CSP_INCLUDE_IPFS_GATEWAYS', true)

  const rpcOrigin = urlToOrigin(getEnv('VITE_RPC_URL') || '')

  const connectSrcBase = [
    "'self'",
    ...(rpcOrigin ? [rpcOrigin] : []),
    ...(includeNetworkPresets ? presetRpcOrigins : []),
    ...(includeIpfsGateways ? ipfsGatewayOrigins : []),
    ...parseExtraSources(getEnv('DEEP_CSP_CONNECT_SRC')),
  ]

  // Dev needs websocket for Vite HMR; preview/prod should avoid allowing websocket by default.
  const connectSrcDev = uniq([
    ...connectSrcBase,
    'ws://localhost:5173',
    'ws://127.0.0.1:5173',
    // Back-compat for local Hardhat defaults when `VITE_RPC_URL` isn't set.
    ...(rpcOrigin ? [] : ['http://127.0.0.1:8545', 'http://localhost:8545']),
  ])

  const connectSrcNonDev = uniq(connectSrcBase)

  const imgSrc = uniq([
    "'self'",
    'data:',
    'blob:',
    ...(includeIpfsGateways ? ipfsGatewayOrigins : []),
    ...parseExtraSources(getEnv('DEEP_CSP_IMG_SRC'))
  ])

  const styleAttrNone = getEnv('DEEP_CSP_STYLE_ATTR_NONE') === '1'
  const cspDev = buildCsp({ dev: true, connectSrc: connectSrcDev, imgSrc, styleAttrNone })
  const cspNonDev = buildCsp({ dev: false, connectSrc: connectSrcNonDev, imgSrc, styleAttrNone })
  const csp = command === 'serve' ? cspDev : cspNonDev

  // Non-dev should default to enforcing CSP; opt out via `DEEP_CSP_ENFORCE=0` / `false`.
  const enforceNonDevCsp = flag('DEEP_CSP_ENFORCE', true)
  const previewCspHeaderName = enforceNonDevCsp
    ? CSP_HEADER
    : CSP_HEADER_REPORT_ONLY

  const reportFile = getEnv('DEEP_CSP_REPORT_FILE')
  const inquireShimPath = fileURLToPath(new URL('./src/shims/protobufjs-inquire.ts', import.meta.url))

  return {
    plugins: [react(), cspReportPlugin({ reportFile })],
    resolve: {
      alias: {
        '@protobufjs/inquire': inquireShimPath,
        '@protobufjs/inquire/index.js': inquireShimPath
      }
    },
    server: {
      // More stable local development configuration
      host: 'localhost',
      port: 5173,
      headers: {
        [CSP_HEADER_REPORT_ONLY]: csp
      },
      // Better error handling
      hmr: {
        overlay: true
      }
    },
    preview: {
      headers: {
        [previewCspHeaderName]: cspNonDev
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // Separate large dependencies into independent chunks
            ethers: ['ethers'],
            d3: ['d3'],
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-vendor': ['lucide-react', 'react-hook-form', '@hookform/resolvers', 'zod'],
            i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector']
          }
        }
      },
      // Increase chunk size warning limit to 1MB since some third-party libraries are indeed large
      chunkSizeWarningLimit: 1000
    },
    // Optimize dependency pre-bundling
    optimizeDeps: {
      include: ['ethers', 'react', 'react-dom', 'react-router-dom']
    }
  }
})
