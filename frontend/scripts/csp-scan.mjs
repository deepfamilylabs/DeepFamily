#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const mode = process.env.CSP_SCAN_MODE === 'dev' ? 'dev' : 'preview'
const port = Number(process.env.CSP_SCAN_PORT || (mode === 'dev' ? 5173 : 4173))
const host = process.env.CSP_SCAN_HOST || '127.0.0.1'
const baseUrl = process.env.CSP_SCAN_BASE_URL || `http://${host}:${port}`

const reportFile = process.env.DEEP_CSP_REPORT_FILE || path.join(process.cwd(), `.csp-report.${mode}.jsonl`)

const routes = [
  '/',
  '/familyTree',
  '/search',
  '/people',
  '/actions',
  '/keygen',
  '/decrypt',
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
  const styleSrcAttr = findDirective('style-src-attr')
  const scriptSrc = findDirective('script-src')

  console.log(`[csp-scan] cspHeader=${effectiveHeaderName}`)
  console.log(`[csp-scan] cspValue=${effectiveValue.slice(0, 220)}${effectiveValue.length > 220 ? '…' : ''}`)
  if (scriptSrc) console.log(`[csp-scan] cspDirective=${scriptSrc}`)
  if (styleSrcAttr) console.log(`[csp-scan] cspDirective=${styleSrcAttr}`)

  if (process.env.DEEP_CSP_ENFORCE === '1' && effectiveHeaderName !== 'content-security-policy') {
    console.warn('[csp-scan] warning: DEEP_CSP_ENFORCE=1 but CSP is not enforced (header is Report-Only)')
  }

  if (process.env.DEEP_CSP_STYLE_ATTR_NONE === '1' && (!styleSrcAttr || !styleSrcAttr.includes("'none'"))) {
    console.warn("[csp-scan] warning: DEEP_CSP_STYLE_ATTR_NONE=1 but CSP does not contain \"style-src-attr 'none'\"")
  }
}

const spawnFrontendServer = async () => {
  const env = {
    ...process.env,
    DEEP_CSP_REPORT_FILE: reportFile,
  }

  if (mode === 'dev') {
    return spawn(npmCmd, ['run', 'dev', '--', '--host', host, '--port', String(port)], {
      env,
      stdio: 'inherit',
    })
  }

  if (process.env.CSP_SCAN_SKIP_BUILD !== '1') {
    const build = spawn(npmCmd, ['run', 'build'], { env, stdio: 'inherit' })
    const code = await new Promise(resolve => build.on('close', resolve))
    if (code !== 0) throw new Error(`frontend build failed (${code})`)
  }

  return spawn(npmCmd, ['run', 'preview', '--', '--host', host, '--port', String(port), '--strictPort'], {
    env,
    stdio: 'inherit',
  })
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
    const key = `${r.effective || r.violated || 'unknown'}|${r.blocked || ''}`
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
      console.error('[csp-scan] run: cd frontend && npm install')
      process.exit(1)
    }
    throw err
  }

  const { chromium } = playwright
  const headless = process.env.CSP_SCAN_HEADLESS === '0' ? false : true
  const executablePath = process.env.CSP_SCAN_EXECUTABLE_PATH
  const channel = process.env.CSP_SCAN_CHROME_CHANNEL

  const buildLaunchOptions = () => {
    const options = { headless }
    if (executablePath) options.executablePath = executablePath
    if (channel) options.channel = channel
    return options
  }

  const withLaunchHints = async () => {
    try {
      return await chromium.launch(buildLaunchOptions())
    } catch (err) {
      const hintLines = [
        '[csp-scan] failed to launch Chromium for Playwright.',
        '',
        'Common WSL fix (missing system libraries):',
        '  npx playwright install --with-deps chromium',
        '',
        'Other options:',
        '  - Install browsers only: npx playwright install chromium',
        '  - Install Linux deps only: npx playwright install-deps chromium',
        '  - Use system Chrome/Chromium: set CSP_SCAN_EXECUTABLE_PATH=/path/to/chrome',
        '',
        'Examples:',
        '  Linux:   CSP_SCAN_EXECUTABLE_PATH="/usr/bin/google-chrome" npm run csp:scan',
        '  WSL+Win: CSP_SCAN_EXECUTABLE_PATH="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" npm run csp:scan',
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

  const server = await spawnFrontendServer()
  const serverExit = new Promise((_, reject) => {
    server.on('exit', (code) => reject(new Error(`frontend server exited (${code})`)))
  })

  try {
    await Promise.race([waitForHttpOk(baseUrl, 60_000), serverExit])
    await logEffectiveCsp(baseUrl)

    const browser = await withLaunchHints()
    const context = await browser.newContext()
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
      const cspConsole = []
      page.on('console', (msg) => {
        if (msg.type() !== 'error' && msg.type() !== 'warning') return
        const text = msg.text() || ''
        if (!text.includes('Content Security Policy') && !text.includes('Content-Security-Policy') && !text.includes('[csp-style-set]')) return
        cspConsole.push({ type: msg.type(), text })
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

      if (cspConsole.length > 0) {
        console.log(`[csp-scan] consoleCspViolations=${cspConsole.length}`)
        for (const entry of cspConsole.slice(0, 10)) {
          console.log(`[csp-scan] console:${entry.type} ${entry.text}`)
        }
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

  if (process.env.CSP_SCAN_FAIL_ON_REPORT === '1' && reports.length > 0) process.exit(1)
}

main().catch((err) => {
  console.error('[csp-scan] failed', err)
  process.exit(1)
})
