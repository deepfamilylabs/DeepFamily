import fs from "node:fs";
import path from "node:path";

// Browser proving files are too large for Git and for Cloudflare Pages (25 MiB per asset).
// They live in R2 under `<sha256>/<file name>`; the circuit manifests pin every digest, so a
// checkout always names the exact bytes it needs. Only built-in modules are imported here
// because the Pages build loads this file without the root dependencies.
export const ZK_ASSET_BASE_URL = "https://zk.deepfamily.org";

const CORE_MANIFEST = "circuits/zk-artifacts-manifest.json";
// Mirrors currentShieldedCandidateManifest() in scripts/lib/shieldedArtifacts.mjs.
const SHIELDED_PRODUCTION_MANIFEST = "circuits/shielded-production-manifest.json";
const SHIELDED_DEVELOPMENT_MANIFEST = "circuits/shielded-development-manifest.json";
const SHA256 = /^[0-9a-f]{64}$/;
const FILE_NAME = /^[a-z0-9_]+(\.wasm|_final\.zkey)$/;

function defineAsset(directory, fileName, sha256, label) {
  if (!SHA256.test(sha256 ?? "")) throw new Error(`${label} has no SHA-256 digest`);
  if (!FILE_NAME.test(fileName)) throw new Error(`${label} has an unexpected file name`);
  const publicPath = `${directory}${fileName}`;
  return Object.freeze({
    path: `/zk/${publicPath}`,
    file: `frontend/public/zk/${publicPath}`,
    key: `${sha256}/${fileName}`,
    sha256,
  });
}

/**
 * Retries network failures, 5xx and 429 with exponential backoff; connections to R2 are
 * occasionally reset mid-handshake. Each attempt gets its own timeout signal.
 */
export async function fetchWithRetry(
  fetchImpl,
  url,
  init = {},
  { attempts = 4, delayMs = 1_000, timeoutMs = 300_000 } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    let failure;
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((response.status < 500 && response.status !== 429) || attempt >= attempts)
        return response;
    } catch (error) {
      failure = error;
    }
    if (failure && attempt >= attempts) {
      throw new Error(`${init.method ?? "GET"} ${url} failed after ${attempts} attempts`, {
        cause: failure,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
  }
}

/** The WASM and final zkey of all eight circuits, as pinned by this checkout's manifests. */
export function listZkPublicAssets(root) {
  const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  const shieldedManifest = fs.existsSync(path.join(root, SHIELDED_PRODUCTION_MANIFEST))
    ? SHIELDED_PRODUCTION_MANIFEST
    : SHIELDED_DEVELOPMENT_MANIFEST;
  const sets = [
    ...Object.entries(read(CORE_MANIFEST).circuits).map(([name, circuit]) => ({
      directory: "",
      name,
      circuit,
    })),
    ...Object.values(read(shieldedManifest).circuits).map((circuit) => ({
      directory: "shielded/",
      name: circuit.source,
      circuit,
    })),
  ];
  return sets.flatMap(({ directory, name, circuit }) => [
    defineAsset(directory, `${name}.wasm`, circuit.wasmSha256, `${name} WASM`),
    defineAsset(directory, `${name}_final.zkey`, circuit.zkeySha256, `${name} zkey`),
  ]);
}
