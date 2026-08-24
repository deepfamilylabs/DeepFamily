import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";

const CSP_HEADER = "Content-Security-Policy";
const CSP_HEADER_REPORT_ONLY = "Content-Security-Policy-Report-Only";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(frontendRoot, "..");
const unicodeLicenseSource = path.join(
  repositoryRoot,
  "packages",
  "protocol-core",
  "UNICODE-LICENSE.txt",
);
const expectedUnicodeLicenseSha256 =
  "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96";

const readArg = (name) => {
  const args = process.argv.slice(2);
  const exactIndex = args.indexOf(name);
  if (exactIndex !== -1) return args[exactIndex + 1];
  const prefix = `${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
};

const mode = readArg("--mode") ?? process.env.MODE ?? process.env.NODE_ENV ?? "production";

process.chdir(frontendRoot);

const resolved = await resolveConfig(
  {
    root: frontendRoot,
    configFile: path.join(frontendRoot, "vite.config.ts"),
    logLevel: "silent",
  },
  "build",
  mode,
);

const previewHeaders = resolved?.preview?.headers ?? {};

const lowerToOriginal = new Map(Object.keys(previewHeaders).map((k) => [k.toLowerCase(), k]));
const enforceKey = lowerToOriginal.get(CSP_HEADER.toLowerCase());
const reportOnlyKey = lowerToOriginal.get(CSP_HEADER_REPORT_ONLY.toLowerCase());

const cspHeaderName = enforceKey ?? reportOnlyKey ?? null;

if (!cspHeaderName) {
  throw new Error("No CSP header found in Vite `preview.headers`; check frontend/vite.config.ts.");
}

const cspHeaderValue = previewHeaders[cspHeaderName];
if (typeof cspHeaderValue !== "string" || !cspHeaderValue.trim()) {
  throw new Error(`Invalid CSP header value for ${cspHeaderName}`);
}

const distDir = path.join(frontendRoot, "dist");
fs.mkdirSync(distDir, { recursive: true });

const headersFile = path.join(distDir, "_headers");
const contents = `/*\n  ${cspHeaderName}: ${cspHeaderValue}\n`;
fs.writeFileSync(headersFile, contents, "utf8");

const unicodeLicense = fs.readFileSync(unicodeLicenseSource);
const unicodeLicenseSha256 = createHash("sha256").update(unicodeLicense).digest("hex");
if (unicodeLicenseSha256 !== expectedUnicodeLicenseSha256) {
  throw new Error("Unicode license notice differs from the reviewed Unicode-3.0 bytes");
}
const thirdPartyDir = path.join(distDir, "third-party");
fs.mkdirSync(thirdPartyDir, { recursive: true });
const unicodeLicenseOutput = path.join(thirdPartyDir, "UNICODE-LICENSE.txt");
fs.writeFileSync(unicodeLicenseOutput, unicodeLicense, { mode: 0o644 });

console.log(`[pages] wrote ${path.relative(frontendRoot, headersFile)} (${cspHeaderName})`);
console.log(`[pages] wrote ${path.relative(frontendRoot, unicodeLicenseOutput)} (Unicode-3.0)`);
