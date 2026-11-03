#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliDecompress } from "node:zlib";
import { loadEnv } from "vite";
import { fetchWithRetry, listZkPublicAssets } from "../lib/zkPublicAssets.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const decompress = promisify(brotliDecompress);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function localDigest(file) {
  try {
    return sha256(await fs.readFile(file));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The host production builds load proving files from, read the way the build reads it: the
 * environment first (Cloudflare Pages and CI set it there), then frontend/.env* files.
 */
export function configuredZkAssetBaseUrl(root = ROOT) {
  const { VITE_ZK_ASSET_BASE_URL: url } = loadEnv(
    "production",
    path.join(root, "frontend"),
    "VITE_ZK_ASSET_BASE_URL",
  );
  if (!url) {
    throw new Error(
      "VITE_ZK_ASSET_BASE_URL is not set; set it in frontend/.env.local, or in the environment in CI",
    );
  }
  return url;
}

/** The committed Brotli copy decoded to its pinned bytes, or null when missing or stale. */
async function committedCopy(file, digest) {
  let bytes;
  try {
    bytes = await fs.readFile(`${file}.br`);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const decoded = await decompress(bytes);
    return sha256(decoded) === digest ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Install the digest-checked raw WASM/zkey files, decoding committed Brotli copies first. Only
 * files without a valid copy come from the asset host, where fetch decodes Content-Encoding: br.
 */
export async function fetchZkAssets({
  root = ROOT,
  baseUrl,
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  root = path.resolve(root);
  const assets = listZkPublicAssets(root);
  let restored = 0;
  let downloaded = 0;
  for (const asset of assets) {
    const destination = path.join(root, asset.file);
    if ((await localDigest(destination)) === asset.sha256) continue;
    let bytes = await committedCopy(destination, asset.sha256);
    const fromCopy = bytes !== null;
    if (!fromCopy) {
      // Resolved on first use, so a checkout whose copies are all current needs no asset host.
      baseUrl = (baseUrl ?? configuredZkAssetBaseUrl(root)).replace(/\/+$/, "");
      const url = `${baseUrl}/${asset.key}`;
      const response = await fetchWithRetry(fetchImpl, url, { redirect: "error" });
      if (!response.ok) {
        throw new Error(
          `ZK asset download failed: HTTP ${response.status} ${url} (run npm run zk:assets:publish after setup)`,
        );
      }
      bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== asset.sha256) throw new Error(`ZK asset SHA-256 mismatch: ${url}`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.install-${process.pid}`;
    try {
      await fs.writeFile(temporary, bytes, { flag: "wx" });
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    if (fromCopy) restored += 1;
    else downloaded += 1;
    log(
      `[zk] ${fromCopy ? "Restored" : "Downloaded"} ${asset.file} (${(bytes.length / 1048576).toFixed(1)} MiB)`,
    );
  }
  log(
    `[zk] ${assets.length} browser proving files ready (${restored} restored from Brotli copies, ${downloaded} downloaded)`,
  );
  return { assetCount: assets.length, restored, downloaded };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await fetchZkAssets();
}
