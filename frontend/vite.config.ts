import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import {
  CSP_REPORT_PATH,
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  cspOriginOf,
  renderPagesHeaders,
} from './src/shared/config/contentSecurityPolicy'
import { handleCspReportRequest } from '../lib/cspReport.js'
import { listZkPublicAssets } from '../lib/zkPublicAssets.js'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const UNICODE_LICENSE_SHA256 = 'e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96'

// Payers verify receive codes in the browser. The verification key is embedded in the bundle
// so that replacing a file under /zk cannot make a forged receive code verify.
const shieldedReceiveCodeVerificationKey = JSON.parse(
  fs.readFileSync(
    fileURLToPath(new URL('./public/zk/shielded/shielded_receive_code.vkey.json', import.meta.url)),
    'utf8'
  )
)

// Proving WASM/zkey files are not in Git; the browser checks each download against these digests.
const zkAssetDigests = Object.fromEntries(
  listZkPublicAssets(fileURLToPath(new URL('..', import.meta.url))).map(asset => [asset.path, asset.sha256])
)

const getManualChunk = (id: string): string | undefined => {
  const normalized = id.replace(/\\/g, '/')

  // Zod v4 decides whether to compile a parser with `new Function` as each object schema is
  // constructed, so the jitless switch must run before any chunk builds one at module scope.
  // In zod's own chunk it runs as soon as zod loads. Left in the entry chunk it ran only after
  // every chunk the entry imports, and the CSP blocked zod's eval probe on every page load.
  if (normalized.endsWith('/src/zodInit.ts')) return 'ui-vendor'

  if (
    normalized.includes('/src/domains/person/') ||
    normalized.includes('/src/domains/tree/')
  ) {
    return 'domain-person-tree'
  }

  if (!normalized.includes('/node_modules/')) return undefined

  if (
    normalized.includes('/node_modules/snarkjs/') ||
    normalized.includes('/node_modules/r1csfile/') ||
    normalized.includes('/node_modules/fastfile/') ||
    normalized.includes('/node_modules/ffjavascript/')
  ) {
    return 'zk-vendor'
  }
  if (
    normalized.includes('/node_modules/@noble/hashes/') ||
    normalized.includes('/node_modules/hash-wasm/') ||
    normalized.includes('/node_modules/poseidon-lite/')
  ) {
    return 'crypto-vendor'
  }
  if (
    normalized.includes('/node_modules/multiformats/') ||
    normalized.includes('/node_modules/@multiformats/')
  ) {
    return 'ipfs-vendor'
  }
  if (normalized.includes('/node_modules/ethers/')) return 'ethers'
  if (normalized.includes('/node_modules/d3/')) return 'd3'
  if (
    normalized.includes('/node_modules/react/') ||
    normalized.includes('/node_modules/react-dom/') ||
    normalized.includes('/node_modules/react-router-dom/') ||
    normalized.includes('/node_modules/scheduler/')
  ) {
    return 'react-vendor'
  }
  if (
    normalized.includes('/node_modules/lucide-react/') ||
    normalized.includes('/node_modules/react-hook-form/') ||
    normalized.includes('/node_modules/@hookform/resolvers/') ||
    normalized.includes('/node_modules/zod/')
  ) {
    return 'ui-vendor'
  }
  if (
    normalized.includes('/node_modules/i18next/') ||
    normalized.includes('/node_modules/react-i18next/') ||
    normalized.includes('/node_modules/i18next-browser-languagedetector/')
  ) {
    return 'i18n'
  }

  return undefined
}

// The same handler as the Pages Function (functions/__csp-report.ts), behind Node's req/res.
const cspReportPlugin = (opts: { reportFile?: string }): Plugin => {
  const record = (entry: object) => {
    console.warn('[csp-report]', entry)
    if (opts.reportFile) {
      fs.appendFileSync(opts.reportFile, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`, 'utf8')
    }
  }
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const request = new Request(new URL(CSP_REPORT_PATH, 'http://localhost'), {
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] ?? '' },
      body: req.method === 'POST' ? (Readable.toWeb(req) as ReadableStream) : undefined,
      duplex: 'half',
    } as RequestInit)
    // Connect ignores a returned promise, so a rejection here would end the whole dev server.
    handleCspReportRequest(request, record, { includeSample: true })
      .then(async (response) => {
        res.statusCode = response.status
        response.headers.forEach((value, name) => res.setHeader(name, value))
        res.end(await response.text())
      })
      .catch(() => {
        res.statusCode = 500
        res.end()
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

// What Cloudflare Pages serves next to the bundle: `_headers`, holding the headers `vite preview`
// sends, and the Unicode notice for the normalization tables @deepfamily/protocol-core bundles.
// Emitted by the build itself so the headers come from exactly this build's env and mode.
const pagesOutputPlugin = (headers: Record<string, string>): Plugin => ({
  name: 'deepfamily:pages-output',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: '_headers', source: renderPagesHeaders(headers) })

    const license = fs.readFileSync(
      fileURLToPath(new URL('../packages/protocol-core/UNICODE-LICENSE.txt', import.meta.url))
    )
    if (createHash('sha256').update(license).digest('hex') !== UNICODE_LICENSE_SHA256) {
      this.error('Unicode license notice differs from the reviewed Unicode-3.0 bytes')
    }
    this.emitFile({ type: 'asset', fileName: 'third-party/UNICODE-LICENSE.txt', source: license })
  }
})

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const getEnv = (key: string): string | undefined => env[key] ?? process.env[key]

  // Builds load proving files from VITE_ZK_ASSET_BASE_URL, which Cloudflare Pages and CI set in
  // their settings and a local build reads from .env.local. There is no default host: a build
  // without it fails here rather than ship proofs that cannot load. An empty value serves the
  // files from this site's /zk. The dev server always serves the local copies.
  const zkAssetBaseUrlFromEnv = getEnv('VITE_ZK_ASSET_BASE_URL')
  if (command === 'build' && zkAssetBaseUrlFromEnv === undefined) {
    throw new Error('VITE_ZK_ASSET_BASE_URL is not set; see frontend/.env.example')
  }
  const zkAssetBuildBaseUrl = (zkAssetBaseUrlFromEnv ?? '').replace(/\/+$/, '')
  const zkAssetBaseUrl = command === 'build' ? zkAssetBuildBaseUrl : ''
  const zkAssetOrigin = cspOriginOf('VITE_ZK_ASSET_BASE_URL', zkAssetBuildBaseUrl)

  const policyOptions = { env: getEnv, connectOrigins: zkAssetOrigin ? [zkAssetOrigin] : [] }
  const securityHeaders = buildSecurityHeaders(policyOptions)

  const reportFile = getEnv('DEEP_CSP_REPORT_FILE')
  const inquireShimPath = fileURLToPath(new URL('./src/shims/protobufjs-inquire.ts', import.meta.url))

  return {
    define: {
      __SHIELDED_RECEIVE_CODE_VKEY__: JSON.stringify(shieldedReceiveCodeVerificationKey),
      __ZK_ASSET_BASE_URL__: JSON.stringify(zkAssetBaseUrl),
      __ZK_ASSET_DIGESTS__: JSON.stringify(zkAssetDigests),
    },
    plugins: [
      react(),
      cspReportPlugin({ reportFile }),
      pagesOutputPlugin(securityHeaders),
    ],
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
        'Content-Security-Policy-Report-Only': buildContentSecurityPolicy({ ...policyOptions, dev: true })
      },
      // Better error handling
      hmr: {
        overlay: true
      }
    },
    preview: {
      headers: securityHeaders
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: getManualChunk
        }
      },
      // Increase chunk size warning limit to 1MB since some third-party libraries are indeed large
      chunkSizeWarningLimit: 1000
    },
    // Workers are single IIFE bundles. The ZK worker derives receive-code viewing
    // keys with @hpke, whose Node <= 18 fallback is a dynamic import("crypto");
    // workers always have globalThis.crypto, so inline it instead of splitting.
    worker: {
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    },
    // Optimize dependency pre-bundling. The dep scanner does not follow Worker
    // entries, so snarkjs (zk.worker) is listed to avoid a mid-proof full reload
    // when Vite discovers it at runtime.
    optimizeDeps: {
      include: ['ethers', 'react', 'react-dom', 'react-router-dom', 'snarkjs']
    }
  }
})
