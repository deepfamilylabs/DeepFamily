import { handleCspReportRequest } from "../lib/cspReport.js";

// Receives the CSP's report-uri posts. Pages reads Functions only from the project's root
// directory, which is the repository root (see frontend/README.md), so this file lives here.
export const onRequest = ({ request }: { request: Request }): Promise<Response> =>
  handleCspReportRequest(request, (entry) => console.warn("[csp-report]", entry));
