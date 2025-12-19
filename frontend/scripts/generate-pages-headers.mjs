import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from 'vite'

const CSP_HEADER = 'Content-Security-Policy'
const CSP_HEADER_REPORT_ONLY = 'Content-Security-Policy-Report-Only'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')

const readArg = (name) => {
  const args = process.argv.slice(2)
  const exactIndex = args.indexOf(name)
  if (exactIndex !== -1) return args[exactIndex + 1]
  const prefix = `${name}=`
  const hit = args.find(a => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : undefined
}

const mode = readArg('--mode') ?? process.env.MODE ?? process.env.NODE_ENV ?? 'production'

process.chdir(frontendRoot)

const resolved = await resolveConfig(
  {
    root: frontendRoot,
    configFile: path.join(frontendRoot, 'vite.config.ts'),
    logLevel: 'silent',
  },
  'build',
  mode
)

const previewHeaders = resolved?.preview?.headers ?? {}

const lowerToOriginal = new Map(
  Object.keys(previewHeaders).map(k => [k.toLowerCase(), k])
)
const enforceKey = lowerToOriginal.get(CSP_HEADER.toLowerCase())
const reportOnlyKey = lowerToOriginal.get(CSP_HEADER_REPORT_ONLY.toLowerCase())

const cspHeaderName = enforceKey ?? reportOnlyKey ?? null

if (!cspHeaderName) {
  throw new Error('No CSP header found in Vite `preview.headers`; check frontend/vite.config.ts.')
}

const cspHeaderValue = previewHeaders[cspHeaderName]
if (typeof cspHeaderValue !== 'string' || !cspHeaderValue.trim()) {
  throw new Error(`Invalid CSP header value for ${cspHeaderName}`)
}

const distDir = path.join(frontendRoot, 'dist')
fs.mkdirSync(distDir, { recursive: true })

const headersFile = path.join(distDir, '_headers')
const contents = `/*\n  ${cspHeaderName}: ${cspHeaderValue}\n`
fs.writeFileSync(headersFile, contents, 'utf8')

console.log(`[pages] wrote ${path.relative(frontendRoot, headersFile)} (${cspHeaderName})`)
