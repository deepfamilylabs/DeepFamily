#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportProtocolFrontendArtifacts } from '../../scripts/export-protocol-frontend.mjs'

const mode = process.env.CSP_SCAN_MODE === 'dev' ? 'dev' : 'preview'
const port = Number(process.env.CSP_SCAN_PORT || (mode === 'dev' ? 5173 : 4173))
const host = process.env.CSP_SCAN_HOST || '127.0.0.1'
const baseUrl = process.env.CSP_SCAN_BASE_URL || `http://${host}:${port}`

// The scan builds and serves its own copy, configured for scanning, and never touches dist/.
const workDir = path.join(process.cwd(), '.csp-scan')
const outDir = path.join(workDir, 'dist')
const workerManifestFile = path.join(workDir, 'worker-proof-manifest.json')
const reportFile = process.env.DEEP_CSP_REPORT_FILE || path.join(workDir, `report.${mode}.jsonl`)
const viteBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js')

const routes = [
  '/',
  '/family',
  '/genealogyBook',
  '/search',
  '/people',
  '/create',
  '/inheritance',
  '/terms',
  '/privacy',
  '/person/1',
  '/editor/1',
]

const waitForHttpOk = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (res.ok) return
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastError = err
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

const logEffectiveCsp = async (url) => {
  const res = await fetch(url, { redirect: 'follow' })
  const csp = res.headers.get('content-security-policy')
  const cspReportOnly = res.headers.get('content-security-policy-report-only')
  const effectiveHeaderName = csp ? 'content-security-policy' : (cspReportOnly ? 'content-security-policy-report-only' : null)
  const effectiveValue = csp || cspReportOnly || null

  if (!effectiveHeaderName || !effectiveValue) {
    console.warn('[csp-scan] warning: no CSP header found on response')
    return
  }

  const directives = effectiveValue
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)

  const findDirective = (name) => directives.find(d => d.toLowerCase().startsWith(`${name} `)) || null
  const scriptSrc = findDirective('script-src')

  console.log(`[csp-scan] cspHeader=${effectiveHeaderName}`)
  console.log(`[csp-scan] cspValue=${effectiveValue.slice(0, 220)}${effectiveValue.length > 220 ? '…' : ''}`)
  if (scriptSrc) console.log(`[csp-scan] cspDirective=${scriptSrc}`)

  // Preview serves the production headers, whose policy is always enforced.
  if (mode === 'preview' && effectiveHeaderName !== 'content-security-policy') {
    throw new Error('preview serves no enforced Content-Security-Policy')
  }
}

const runVite = (args, env) => spawn(process.execPath, [viteBin, ...args], { env, stdio: 'inherit' })

const spawnFrontendServer = async () => {
  const env = {
    ...process.env,
    DEEP_CSP_REPORT_FILE: reportFile,
  }

  if (mode === 'dev') return runVite(['--host', host, '--port', String(port), '--strictPort'], env)

  if (process.env.CSP_SCAN_SKIP_BUILD !== '1') {
    // Proving files load from this origin: the R2 host only admits the site's own origins.
    const build = runVite(['build', '--outDir', outDir, '--emptyOutDir'], { ...env, VITE_ZK_ASSET_BASE_URL: '' })
    const code = await new Promise(resolve => build.on('close', resolve))
    if (code !== 0) throw new Error(`frontend build failed (${code})`)
  }

  return runVite(['preview', '--outDir', outDir, '--host', host, '--port', String(port), '--strictPort'], env)
}

// Exercise the built wallet worker under the site's real CSP, including Groth16
// WASM/blob workers and encrypted wallet backup recovery. The worker does not need
// an RPC server to create a generic code or prove a public revocation-log range.
const runWorkerFlows = async (page) => {
  const assets = await fs.readdir(path.join(outDir, 'assets'))
  const workerFile = assets.find(file => file.startsWith('receive.worker-') && file.endsWith('.js'))
  if (!workerFile) throw new Error('The receive worker is missing from the frontend build')
  const manifest = JSON.parse(await fs.readFile(workerManifestFile, 'utf8'))
  const context = { rpcUrl: new URL('/__csp-scan/unused-rpc', baseUrl).toString(),
    deployment: { chainId: manifest.chainId, registryAddress: manifest.registryAddress, poolAddress: '0x0000000000000000000000000000000000000001' }, manifest }
  await page.goto(new URL('/terms', baseUrl).toString(), { waitUntil: 'load' })
  const result = await page.evaluate(async ({ url, context }) => {
    const worker = new Worker(url, { type: 'module' })
    let sequence = 0
    const call = (method, input) => new Promise((resolve, reject) => {
      const id = ++sequence
      worker.onmessage = ({ data }) => {
        if (data?.id !== id) return
        data.ok ? resolve(data.result) : reject(new Error(`${method}: ${data?.error?.message || 'failed'}`))
      }
      worker.onerror = () => reject(new Error(`${method}: worker could not load`))
      worker.postMessage({ id, method, input, context })
    })
    const assertFields = (value, fields) => {
      if (!value || typeof value !== 'object' || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Wallet worker exposed an unexpected field')
    }
    try {
      const rawPassphrase = 'csp-scan wallet backup password'
      const created = await call('walletCreate', { rawPassphrase })
      assertFields(created, ['state', 'backup'])
      const received = await call('walletCreateCode', { rawPassphrase, expiresAt: String(Math.floor(Date.now() / 1000) + 86400) })
      assertFields(received, ['state', 'backup', 'code'])
      const checked = await call('verifyCode', { code: received.code })
      assertFields(checked, ['chainId', 'authorizerScope', 'nonce', 'codeAlias', 'commonBinding', 'revocationTag', 'ownerCommitment', 'viewingKey', 'expiresAt', 'version', 'proof', 'publicSignals', 'capabilities'])
      await call('walletLock', {})
      const restored = await call('walletRestore', { rawPassphrase, backup: received.backup })
      return { validCode: received.code.startsWith('dfreceive1') && checked.capabilities.length === 0,
        restored: restored.state.unlocked && restored.state.codeCount === received.state.codeCount,
        backup: received.backup instanceof Uint8Array && received.backup.length > 64 }
    } finally { worker.terminate() }
  }, { url: `/assets/${workerFile}`, context })
  if (!result.validCode || !result.restored || !result.backup) throw new Error('Wallet worker CSP flow failed')
}

const readReports = async () => {
  try {
    const raw = await fs.readFile(reportFile, 'utf8')
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line))
  } catch {
    return []
  }
}

const summarize = (reports) => {
  const byKey = new Map()
  for (const r of reports) {
    const key = `${r.directive || 'unknown'}|${r.blocked || ''}`
    byKey.set(key, (byKey.get(key) || 0) + 1)
  }
  return Array.from(byKey.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }))
}

const main = async () => {
  await fs.rm(reportFile, { force: true })

  let playwright
  try {
    playwright = await import('playwright-core')
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('[csp-scan] missing dependency: playwright-core')
      console.error('[csp-scan] run: npm install from the repository root')
      process.exit(1)
    }
    throw err
  }

  const { chromium } = playwright
  const headless = process.env.CSP_SCAN_HEADLESS === '0' ? false : true
  // The Google Chrome installed in its standard location, unless another binary or channel is named.
  const executablePath = process.env.CSP_SCAN_EXECUTABLE_PATH
  const channel = process.env.CSP_SCAN_CHROME_CHANNEL || 'chrome'

  const buildLaunchOptions = () =>
    executablePath ? { headless, executablePath } : { headless, channel }

  const withLaunchHints = async () => {
    try {
      return await chromium.launch(buildLaunchOptions())
    } catch (err) {
      const hintLines = [
        '[csp-scan] failed to launch the browser.',
        '',
        'The scan runs the Google Chrome installed on this machine. Otherwise:',
        '  - another binary:       CSP_SCAN_EXECUTABLE_PATH=/path/to/chrome npm run csp:scan',
        "  - Playwright's Chromium: npx playwright install --with-deps chromium",
        '                          CSP_SCAN_CHROME_CHANNEL=chromium npm run csp:scan',
      ]
      console.error(hintLines.join('\n'))
      throw err
    }
  }

  console.log(`[csp-scan] mode=${mode} baseUrl=${baseUrl}`)
  console.log(`[csp-scan] reportFile=${reportFile}`)

  // Preflight: verify Playwright can launch a browser before starting the server.
  // This avoids leaving a Vite preview process running if Chromium can't start.
  const preflightBrowser = await withLaunchHints()
  await preflightBrowser.close()

  const pageViolations = []
  let workerFailure = null
  await fs.mkdir(workDir, { recursive: true })
  if (mode === 'preview' && process.env.CSP_SCAN_WORKERS !== '0') {
    // This scope exercises a local worker without a deployed registry. Keep its
    // test pins in the scan directory; never replace the application's config.
    const { manifest } = exportProtocolFrontendArtifacts({
      root: fileURLToPath(new URL('../..', import.meta.url)),
      chainId: 31337n,
      registryAddress: '0x0000000000000000000000000000000000001234',
      writeConfig: false,
    })
    await fs.writeFile(workerManifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  const server = await spawnFrontendServer()
  const serverExit = new Promise((_, reject) => {
    server.on('exit', (code) => reject(new Error(`frontend server exited (${code})`)))
  })

  try {
    await Promise.race([waitForHttpOk(baseUrl, 60_000), serverExit])
    await logEffectiveCsp(baseUrl)

    const browser = await withLaunchHints()
    const context = await browser.newContext()
    // The browser's own CSP messages never reach page.on('console'), so record the violation
    // events themselves. A worker's violations arrive only through report-uri.
    await context.addInitScript(() => {
      window.__cspViolations = []
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations.push({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
          sourceFile: event.sourceFile,
          line: event.lineNumber,
          disposition: event.disposition,
        })
      })
    })
    // Capture style-related mutations so we can map `style-src-attr` violations back to the exact
    // code path / element being modified.
    await context.addInitScript(() => {
      const safeString = (v) => {
        try { return String(v ?? '') } catch { return '' }
      }

      const pick = (el) => {
        try {
          const tag = el?.tagName ? String(el.tagName).toLowerCase() : 'unknown'
          const id = el?.id ? `#${el.id}` : ''
          const cls = typeof el?.className === 'string' && el.className.trim()
            ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
            : ''
          return `${tag}${id}${cls}`
        } catch {
          return 'unknown'
        }
      }

      try {
        const origSetAttribute = Element.prototype.setAttribute
        Element.prototype.setAttribute = function (name, value) {
          try {
            if (String(name).toLowerCase() === 'style') {
              // eslint-disable-next-line no-console
              console.warn('[csp-style-set]', 'setAttribute', pick(this), safeString(value).slice(0, 200))
            }
          } catch {}
          return origSetAttribute.call(this, name, value)
        }
      } catch {}

      try {
        const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')
        if (desc?.set) {
          Object.defineProperty(Element.prototype, 'innerHTML', {
            ...desc,
            set(value) {
              try {
                const s = safeString(value)
                if (s.toLowerCase().includes('style=')) {
                  // eslint-disable-next-line no-console
                  console.warn('[csp-style-set]', 'innerHTML', pick(this), s.slice(0, 200))
                }
              } catch {}
              return desc.set.call(this, value)
            }
          })
        }
      } catch {}

      try {
        const origInsertAdjacentHTML = Element.prototype.insertAdjacentHTML
        Element.prototype.insertAdjacentHTML = function (position, text) {
          try {
            const s = safeString(text)
            if (s.toLowerCase().includes('style=')) {
              // eslint-disable-next-line no-console
              console.warn('[csp-style-set]', 'insertAdjacentHTML', safeString(position), pick(this), s.slice(0, 200))
            }
          } catch {}
          return origInsertAdjacentHTML.call(this, position, text)
        }
      } catch {}

      try {
        const origSetProperty = CSSStyleDeclaration.prototype.setProperty
        CSSStyleDeclaration.prototype.setProperty = function (prop, value, priority) {
          try {
            // eslint-disable-next-line no-console
            console.warn('[csp-style-set]', 'setProperty', safeString(prop), safeString(value).slice(0, 120))
          } catch {}
          return origSetProperty.call(this, prop, value, priority)
        }
      } catch {}

      try {
        const desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'cssText')
        if (desc?.set) {
          Object.defineProperty(CSSStyleDeclaration.prototype, 'cssText', {
            ...desc,
            set(value) {
              try {
                // eslint-disable-next-line no-console
                console.warn('[csp-style-set]', 'cssText', safeString(value).slice(0, 200))
              } catch {}
              return desc.set.call(this, value)
            }
          })
        }
      } catch {}
    })

    try {
      const page = await context.newPage()
      const styleWrites = []
      page.on('console', (msg) => {
        const text = msg.text() || ''
        if (text.includes('[csp-style-set]')) styleWrites.push(text)
      })

      const collectStyleAttrs = async (label) => {
        try {
          const results = await page.evaluate(async () => {
            const toBase64 = (buf) => {
              const bytes = new Uint8Array(buf)
              let binary = ''
              for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
              return btoa(binary)
            }

            const hashStyle = async (styleText) => {
              const enc = new TextEncoder().encode(styleText)
              const buf = await crypto.subtle.digest('SHA-256', enc)
              return `sha256-${toBase64(buf)}`
            }

            const pick = (el) => {
              const tag = el.tagName.toLowerCase()
              const id = el.id ? `#${el.id}` : ''
              const cls = typeof el.className === 'string' && el.className.trim()
                ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
                : ''
              return `${tag}${id}${cls}`
            }

            const styled = Array.from(document.querySelectorAll('[style]'))
            const items = []
            for (const el of styled.slice(0, 50)) {
              const styleText = el.getAttribute('style') || ''
              const hash = styleText ? await hashStyle(styleText) : null
              items.push({
                selector: pick(el),
                style: styleText,
                hash,
                outerHTML: (el.outerHTML || '').slice(0, 240),
              })
            }
            const hashes = Array.from(new Set(items.map(i => i.hash).filter(Boolean)))
            return { count: styled.length, hashes, items }
          })

          if (results.count > 0) {
            console.log(`[csp-scan] styleAttrElements(${label})=${results.count}`)
            for (const h of results.hashes.slice(0, 20)) console.log(`[csp-scan] styleAttrHash(${label})=${h}`)
            for (const item of results.items.slice(0, 10)) {
              console.log(`[csp-scan] styleAttr(${label}) selector=${item.selector} hash=${item.hash} style="${item.style}" html="${item.outerHTML}"`)
            }
          }
        } catch (err) {
          console.warn('[csp-scan] collectStyleAttrs failed', err?.message || err)
        }
      }

      for (const route of routes) {
        const url = new URL(route, baseUrl).toString()
        console.log(`[csp-scan] visit ${url}`)
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1500)
        await collectStyleAttrs(route)
        const violations = await page.evaluate(() => window.__cspViolations ?? [])
        for (const violation of violations) pageViolations.push({ route, ...violation })
      }

      if (mode === 'preview' && process.env.CSP_SCAN_WORKERS !== '0') {
        const started = Date.now()
        try {
          await runWorkerFlows(page)
          const seconds = ((Date.now() - started) / 1000).toFixed(1)
          console.log(`[csp-scan] workers: receive code proved and verified in the wallet worker, encrypted backup restored, public results checked, worker terminated (${seconds}s)`)
        } catch (err) {
          workerFailure = err
        }
        // The workers' own violations arrive as reports; give them time before the browser closes.
        await page.waitForTimeout(2000)
        const violations = await page.evaluate(() => window.__cspViolations ?? []).catch(() => [])
        for (const violation of violations) pageViolations.push({ route: 'workers', ...violation })
      }

      // Optional (off by default): prove that the browser enforces `style-src-attr` by attempting
      // to apply blocked inline styles. This intentionally triggers CSP violations, so only enable
      // it when debugging enforcement behavior.
      if (process.env.CSP_SCAN_STYLE_ATTR_PROBE === '1') {
        try {
          const styleAttrProbe = await page.evaluate(() => {
            const base = document.createElement('div')
            base.textContent = 'csp-style-attr-probe'
            document.body.appendChild(base)

            const baseline = getComputedStyle(base).color

            base.setAttribute('style', 'color: rgb(255, 0, 0) !important;')
            const afterSetAttribute = getComputedStyle(base).color

            const container = document.createElement('div')
            container.innerHTML = '<div id="csp-style-attr-probe-inner" style="color: rgb(0, 128, 0) !important;">x</div>'
            document.body.appendChild(container)
            const inner = document.getElementById('csp-style-attr-probe-inner')
            const afterInnerHtml = inner ? getComputedStyle(inner).color : null

            base.style.color = 'rgb(0, 0, 255)'
            const afterCssom = getComputedStyle(base).color

            container.remove()
            base.remove()

            return {
              baseline,
              afterSetAttribute,
              afterInnerHtml,
              afterCssom,
              blockedSetAttribute: afterSetAttribute === baseline,
              blockedInnerHtml: afterInnerHtml === baseline,
            }
          })
          console.log(
            `[csp-scan] styleSrcAttrProbe baseline=${styleAttrProbe.baseline} ` +
            `setAttribute=${styleAttrProbe.afterSetAttribute} innerHTML=${styleAttrProbe.afterInnerHtml} cssom=${styleAttrProbe.afterCssom} ` +
            `blocked(setAttribute)=${styleAttrProbe.blockedSetAttribute} blocked(innerHTML)=${styleAttrProbe.blockedInnerHtml}`
          )
        } catch (err) {
          console.warn('[csp-scan] styleSrcAttrProbe failed', err?.message || err)
        }
      }

      if (styleWrites.length > 0) {
        console.log(`[csp-scan] styleWrites=${styleWrites.length}`)
        for (const text of styleWrites.slice(0, 10)) console.log(`[csp-scan] ${text}`)
      }
    } finally {
      await browser.close()
    }
  } finally {
    server.kill('SIGTERM')
  }

  const reports = (await readReports()).filter(r => typeof r?.document === 'string' && r.document.startsWith(baseUrl))
  const summary = summarize(reports)

  console.log(`[csp-scan] reports=${reports.length}`)
  for (const item of summary.slice(0, 30)) {
    console.log(`[csp-scan] ${item.count}x ${item.key}`)
  }

  console.log(`[csp-scan] pageViolations=${pageViolations.length}`)
  for (const v of pageViolations.slice(0, 30)) {
    console.log(`[csp-scan] ${v.route} ${v.disposition} ${v.directive} ${v.blocked} ${v.sourceFile || ''}:${v.line ?? ''}`)
  }

  if (workerFailure) {
    console.error(`[csp-scan] worker flows failed: ${workerFailure.message}`)
    process.exit(1)
  }

  const failed = reports.length > 0 || pageViolations.length > 0
  if (process.env.CSP_SCAN_FAIL_ON_REPORT === '1' && failed) process.exit(1)
}

main().catch((err) => {
  console.error('[csp-scan] failed', err)
  process.exit(1)
})
