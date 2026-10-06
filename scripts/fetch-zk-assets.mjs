#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZK_ASSET_BASE_URL, fetchWithRetry, listZkPublicAssets } from "../lib/zkPublicAssets.js";

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

/** Installs the manifest-pinned browser WASM/zkey files under frontend/public/zk. */
export async function fetchZkAssets({
  root = ROOT,
  baseUrl = process.env.ZK_ASSET_BASE_URL || ZK_ASSET_BASE_URL,
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
