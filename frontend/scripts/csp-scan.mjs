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

    const browser = await withLaunchHints()
    const context = await browser.newContext()

    try {
      const page = await context.newPage()
      for (const route of routes) {
        const url = new URL(route, baseUrl).toString()
        console.log(`[csp-scan] visit ${url}`)
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1500)
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
