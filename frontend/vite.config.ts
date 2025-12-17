import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { NETWORK_PRESETS } from './src/config/networks'
import { IPFS_GATEWAY_BASE_URLS } from './src/config/ipfs'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const CSP_REPORT_PATH = '/__csp-report'

const uniq = <T,>(items: T[]): T[] => Array.from(new Set(items))

const parseExtraSources = (value: string | undefined): string[] => {
  if (!value) return []
  return value
    .split(/\s+/)
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

const cspReportPlugin = (): Plugin => {
  const reportFile = process.env.DEEP_CSP_REPORT_FILE
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

const ipfsGatewayOrigins = uniq(
  IPFS_GATEWAY_BASE_URLS
    .map(urlToOrigin)
    .filter((v): v is string => Boolean(v))
)

const connectSrc = uniq([
  "'self'",
  'http://127.0.0.1:8545',
  'http://localhost:8545',
  'ws://localhost:5173',
  'ws://127.0.0.1:5173',
  ...presetRpcOrigins,
  ...ipfsGatewayOrigins,
  ...parseExtraSources(process.env.DEEP_CSP_CONNECT_SRC)
])

const imgSrc = uniq([
  "'self'",
  'data:',
  'blob:',
  ...ipfsGatewayOrigins,
  ...parseExtraSources(process.env.DEEP_CSP_IMG_SRC)
])

const buildCsp = (opts: { dev: boolean }): string => {
  const { dev } = opts
  const scriptSrc = dev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' 'report-sample'"
    : "script-src 'self' 'wasm-unsafe-eval' 'report-sample'"

  const styleSrc = dev
    ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
    : "style-src 'self' https://fonts.googleapis.com"

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
    // React uses inline style attributes widely; keep this narrow to attributes only.
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' data: https://fonts.gstatic.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ')
}

const CSP_DEV = buildCsp({ dev: true })
const CSP_NON_DEV = buildCsp({ dev: false })

const CSP_HEADER_NAME = process.env.DEEP_CSP_ENFORCE === '1' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'

export default defineConfig(({ command }) => {
  const csp = command === 'serve' ? CSP_DEV : CSP_NON_DEV
  const inquireShimPath = fileURLToPath(new URL('./src/shims/protobufjs-inquire.ts', import.meta.url))

  return {
    plugins: [react(), cspReportPlugin()],
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
        [CSP_HEADER_NAME]: csp
      },
      // Better error handling
      hmr: {
        overlay: true
      }
    },
    preview: {
      headers: {
        [CSP_HEADER_NAME]: CSP_NON_DEV
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
