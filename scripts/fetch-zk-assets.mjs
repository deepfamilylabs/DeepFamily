#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { fetchWithRetry, listZkPublicAssets } from "../lib/zkPublicAssets.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
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

/** Installs the manifest-pinned browser WASM/zkey files under frontend/public/zk. */
export async function fetchZkAssets({
  root = ROOT,
  baseUrl = configuredZkAssetBaseUrl(root),
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  root = path.resolve(root);
  baseUrl = baseUrl.replace(/\/+$/, "");
  const assets = listZkPublicAssets(root);
  let downloaded = 0;
  for (const asset of assets) {
    const destination = path.join(root, asset.file);
    if ((await localDigest(destination)) === asset.sha256) continue;
    const url = `${baseUrl}/${asset.key}`;
    const response = await fetchWithRetry(fetchImpl, url, { redirect: "error" });
    if (!response.ok) {
      throw new Error(
        `ZK asset download failed: HTTP ${response.status} ${url} (run npm run zk:assets:publish after setup)`,
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== asset.sha256) throw new Error(`ZK asset SHA-256 mismatch: ${url}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.download-${process.pid}`;
    try {
      await fs.writeFile(temporary, bytes, { flag: "wx" });
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    downloaded += 1;
    log(`[zk] Downloaded ${asset.file} (${(bytes.length / 1048576).toFixed(1)} MiB)`);
  }
  log(`[zk] ${assets.length} browser proving files ready (${downloaded} downloaded)`);
  return { assetCount: assets.length, downloaded };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await fetchZkAssets();
}
