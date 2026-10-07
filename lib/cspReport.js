// The CSP report endpoint, shared by the Pages Function and the Vite dev/preview server.
//
// The policy reports through report-uri only, so browsers post one `application/csp-report`
// object per violation. A report carries the blocked URL whole, path and query included, so an
// RPC that puts its API key in the URL (Infura's /v3/<key>, Alchemy's /v2/<key>) would be logged
// verbatim: every URL is cut down before it leaves this module. Only built-in APIs are used,
// because the Pages Function bundles this file without any dependencies.

/** Characters of a report body that are parsed; a browser's report is far smaller. */
const MAX_REPORT_LENGTH = 64 * 1024;
const WEB_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

/**
 * A web URL keeps its origin, plus its path when `keepPath` is set, but never its query or
 * fragment. A blob: URL keeps the origin that created it, other schemes only their name, and
 * keywords such as `eval` or `inline` pass through.
 */
export function redactReportUrl(value, { keepPath = false } = {}) {
  if (typeof value !== "string" || value === "") return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    return /^[a-z][a-z-]*$/i.test(value) ? value : undefined;
  }
  if (WEB_SCHEMES.has(url.protocol)) return keepPath ? `${url.origin}${url.pathname}` : url.origin;
  const scheme = url.protocol.slice(0, -1);
  return url.origin === "null" ? scheme : `${scheme}:${url.origin}`;
}

const stringField = (value) => (typeof value === "string" ? value : undefined);
const numberField = (value) => (typeof value === "number" ? value : undefined);

/** The log-safe entry for one report body. Throws when the body is not a CSP report. */
export function summarizeCspReport(raw, { includeSample = false } = {}) {
  const report = JSON.parse(raw)?.["csp-report"];
  if (!report || typeof report !== "object") throw new TypeError("Not a CSP report");
  return {
    directive: stringField(report["effective-directive"]),
    blocked: redactReportUrl(report["blocked-uri"]),
    document: redactReportUrl(report["document-uri"], { keepPath: true }),
    sourceFile: redactReportUrl(report["source-file"], { keepPath: true }),
    line: numberField(report["line-number"]),
    column: numberField(report["column-number"]),
    disposition: stringField(report.disposition),
    ...(includeSample ? { sample: stringField(report["script-sample"]) } : {}),
  };
}

/**
 * Answers a request to the report endpoint: 405, 415 or 400 for anything that is not a browser's
 * CSP report, otherwise 204 after handing the redacted entry to `record`.
 */
export async function handleCspReportRequest(request, record, { includeSample = false } = {}) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/csp-report")) {
    return new Response(null, { status: 415 });
  }
  let entry;
  try {
    entry = summarizeCspReport((await request.text()).slice(0, MAX_REPORT_LENGTH), {
      includeSample,
    });
  } catch {
    return new Response(null, { status: 400 });
  }
  record(entry);
  return new Response(null, { status: 204 });
}
