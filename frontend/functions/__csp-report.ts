export async function onRequestPost({ request }: { request: Request }): Promise<Response> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase()
  const looksJson =
    contentType.includes('application/json') ||
    contentType.includes('application/csp-report') ||
    contentType.includes('application/reports+json')

  try {
    const raw = looksJson ? (await request.text()).slice(0, 64 * 1024) : ''
    if (raw) {
      const parsed = JSON.parse(raw)
      const reports = Array.isArray(parsed) ? parsed : [parsed]
      const safe = reports
        .slice(0, 50)
        .map((r: any) => r?.['csp-report'] ?? r?.body ?? r ?? {})
        .map((report: any) => ({
          effectiveDirective:
            typeof report?.['effective-directive'] === 'string' ? report['effective-directive'] : undefined,
          violatedDirective:
            typeof report?.['violated-directive'] === 'string' ? report['violated-directive'] : undefined,
          blockedUri: typeof report?.['blocked-uri'] === 'string' ? report['blocked-uri'] : undefined,
          documentUri: typeof report?.['document-uri'] === 'string' ? report['document-uri'] : undefined,
          sourceFile: typeof report?.['source-file'] === 'string' ? report['source-file'] : undefined,
          lineNumber: typeof report?.['line-number'] === 'number' ? report['line-number'] : undefined,
          columnNumber: typeof report?.['column-number'] === 'number' ? report['column-number'] : undefined,
        }))
      console.warn('[csp-report]', safe)
    } else {
      console.warn('[csp-report] non-json or empty body')
    }
  } catch {
    console.warn('[csp-report] invalid JSON')
  }

  return new Response(null, { status: 204 })
}

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  if (request.method.toUpperCase() === 'POST') return onRequestPost({ request })
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST' },
  })
}
