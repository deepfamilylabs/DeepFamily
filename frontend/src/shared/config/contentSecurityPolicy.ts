import { readBooleanEnv } from "./env";
import { NETWORK_PRESETS } from "./networks";

/**
 * The browser security policy the app is served with, built by vite.config.ts. `vite preview`
 * serves {@link buildSecurityHeaders} and the build writes the same headers to `dist/_headers`
 * for Cloudflare Pages, so a preview enforces exactly what production does.
 */

/** Reads one build-time variable, from the env files or the process environment. */
export type BuildEnv = (key: string) => string | undefined;

export type PolicyOptions = {
  env: BuildEnv;
  /** Asset hosts fetched at runtime, such as the host of the ZK proving files. */
  connectOrigins?: string[];
};

export const CSP_REPORT_PATH = "/__csp-report";

// Vite's HMR socket on the dev server's fixed port.
const DEV_HMR_ORIGINS = ["ws://localhost:5173", "ws://127.0.0.1:5173"];

// Trusted Types, reported but not yet enforced: once production reports none, move these
// directives into the enforced policy. Each realm that starts workers installs the default policy
// (shared/workers/trustedWorkerUrls.ts), so ordinary use reports nothing.
const TRUSTED_TYPES_POLICY = `require-trusted-types-for 'script'; trusted-types default; report-uri ${CSP_REPORT_PATH}`;

// Cloudflare Pages caps every line of _headers at 2,000 characters.
const PAGES_HEADER_LINE_LIMIT = 2000;

const HOST_AND_PORT = String.raw`[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?`;
// A CSP host-source naming one origin: scheme, optional `*.` wildcard, host and port.
const CSP_SOURCE_ORIGIN = new RegExp(
  String.raw`^(?:https?|wss?)://(?:\*\.)?${HOST_AND_PORT}$`,
  "i",
);
// The origin of an http(s) URL. URL parsing accepts `;` and `,` in a host name, either of which
// would end the directive or start another once the origin is written into the policy.
const HTTP_ORIGIN = new RegExp(String.raw`^https?://${HOST_AND_PORT}$`, "i");

const unique = (items: string[]): string[] => Array.from(new Set(items));

/** The origin of `url` as a CSP source; `null` for an empty `url`. Throws for anything else. */
export function cspOriginOf(key: string, url: string): string | null {
  if (!url.trim()) return null;
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    // Reported below.
  }
  if (!HTTP_ORIGIN.test(origin)) {
    throw new Error(`${key}: "${url}" does not name an http(s) origin`);
  }
  return origin;
}

/**
 * The whitespace-separated origins in a `DEEP_CSP_*` variable. Anything else fails the build
 * rather than reaching the policy, where a stray `*`, `https:` or `;` would open the directive
 * or start a new one.
 */
export function parseCspOrigins(key: string, value: string | undefined): string[] {
  const tokens = (value ?? "").split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (!CSP_SOURCE_ORIGIN.test(token)) {
      throw new Error(`${key}: "${token}" is not an origin such as https://rpc.example.org`);
    }
  }
  return tokens;
}

/**
 * Every RPC origin the build can be pointed at: `VITE_RPC_URL`'s and the built-in networks'.
 * The network menu lists the local chain when the build names its reader
 * (`VITE_READER_ADDRESS_31337`) or when `VITE_RPC_URL` points at it, which the first origin
 * already covers. Anywhere else that address is just the visitor's own machine.
 */
function rpcOrigins(env: BuildEnv): string[] {
  const presets = readBooleanEnv(env("DEEP_CSP_INCLUDE_NETWORK_PRESETS"), true)
    ? NETWORK_PRESETS.filter(
        (preset) => !preset.isLocal || env(`VITE_READER_ADDRESS_${preset.chainId}`)?.trim(),
      )
    : [];
  return [
    cspOriginOf("VITE_RPC_URL", env("VITE_RPC_URL") ?? ""),
    ...presets.map((preset) => cspOriginOf(`network preset ${preset.chainId}`, preset.rpcUrl)),
  ].filter((origin): origin is string => origin !== null);
}

/** The Content-Security-Policy value; `dev` is the looser variant the dev server only reports. */
export function buildContentSecurityPolicy({
  env,
  connectOrigins = [],
  dev,
}: PolicyOptions & { dev: boolean }): string {
  const connectSrc = unique([
    "'self'",
    ...connectOrigins,
    ...rpcOrigins(env),
    ...parseCspOrigins("DEEP_CSP_CONNECT_SRC", env("DEEP_CSP_CONNECT_SRC")),
    ...(dev ? DEV_HMR_ORIGINS : []),
  ]);
  const imgSrc = unique([
    "'self'",
    "data:",
    ...parseCspOrigins("DEEP_CSP_IMG_SRC", env("DEEP_CSP_IMG_SRC")),
  ]);

  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // No report-to: Chrome ignores report-uri once report-to is set, and over the http preview the
    // Reporting API delivered nothing, from the page or from workers, so the scan would go blind.
    `report-uri ${CSP_REPORT_PATH}`,
    dev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' 'report-sample'"
      : "script-src 'self' 'wasm-unsafe-eval' 'report-sample'",
    "script-src-attr 'none'",
    `connect-src ${connectSrc.join(" ")}`,
    // data: carries wallet icons and the pages the PDF export rasterizes.
    `img-src ${imgSrc.join(" ")}`,
    // The dev server injects inline <style> tags; the production build does not.
    dev
      ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
      : "style-src 'self' https://fonts.googleapis.com",
    // React applies `style` props through the CSSOM, which style-src-attr does not govern; only
    // style attributes in markup or set with setAttribute are blocked.
    dev ? "style-src-attr 'unsafe-inline'" : "style-src-attr 'none'",
    "font-src 'self' https://fonts.gstatic.com",
    // snarkjs proves on threads it starts from blob: URLs inside the ZK worker.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

/**
 * The headers `vite preview` and Cloudflare Pages send. The policy is always enforced; the
 * Trusted Types directives ride in a second, report-only policy until they are enforced too.
 *
 * HSTS covers the site's own host only. includeSubDomains or preload would bind every subdomain,
 * the proving-file host included, and browsers keep either for months after it is withdrawn.
 * Browsers ignore the header over plain http, so a local preview is unaffected.
 *
 * COOP cuts the handle a cross-origin page keeps after opening this site, so it cannot later
 * navigate the tab to a look-alike. allow-popups keeps the windows this site opens itself, which
 * popup-based wallets rely on.
 */
export function buildSecurityHeaders(options: PolicyOptions): Record<string, string> {
  return {
    "Content-Security-Policy": buildContentSecurityPolicy({ ...options, dev: false }),
    "Content-Security-Policy-Report-Only": TRUSTED_TYPES_POLICY,
    "Strict-Transport-Security": "max-age=31536000",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), browsing-topics=()",
  };
}

/** A Cloudflare Pages `_headers` file applying `headers` to every path. */
export function renderPagesHeaders(headers: Record<string, string>): string {
  const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);
  const tooLong = lines.find((line) => line.length > PAGES_HEADER_LINE_LIMIT);
  if (tooLong) {
    throw new Error(
      `_headers line exceeds ${PAGES_HEADER_LINE_LIMIT} characters: ${tooLong.trim().slice(0, 60)}…`,
    );
  }
  return `/*\n${lines.join("\n")}\n`;
}
