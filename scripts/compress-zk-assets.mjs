#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants } from "node:zlib";
import { listZkPublicAssets } from "../lib/zkPublicAssets.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function readPinnedAsset(root, asset) {
  const bytes = await fs.readFile(path.join(root, asset.file));
  if (sha256(bytes) !== asset.sha256) {
    throw new Error(`${asset.file} does not match its manifest digest; rerun the ZK setup first`);
  }
  return bytes;
}

async function cachedBrotli(file, original) {
  let bytes;
  try {
    bytes = await fs.readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const decoded = await decompress(bytes, { maxOutputLength: original.length });
    return decoded.equals(original) ? bytes : null;
  } catch {
    return null;
  }
}

/** Precompresses manifest-pinned proving files; the original files and their digests stay intact. */
export async function compressZkAssets({ root = ROOT, log = console.log } = {}) {
  root = path.resolve(root);
  const assets = listZkPublicAssets(root);
  // A partial or stale setup must not produce a partially refreshed compression set.
  for (const asset of assets) await readPinnedAsset(root, asset);

  let compressed = 0;
  let rawBytes = 0;
  let compressedBytes = 0;
  for (const asset of assets) {
    const original = await readPinnedAsset(root, asset);
    const destination = path.join(root, `${asset.file}.br`);
    let bytes = await cachedBrotli(destination, original);
    if (!bytes) {
      bytes = await compress(original, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 5,
          [constants.BROTLI_PARAM_SIZE_HINT]: original.length,
        },
      });
      const decoded = await decompress(bytes, { maxOutputLength: original.length });
      if (!decoded.equals(original)) throw new Error(`Brotli round trip failed: ${asset.file}`);
      const temporary = `${destination}.compress-${randomUUID()}`;
      try {
        await fs.writeFile(temporary, bytes, { flag: "wx" });
        await fs.rename(temporary, destination);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      compressed += 1;
    }
    rawBytes += original.length;
    compressedBytes += bytes.length;
    log(
      `[zk] Brotli ${asset.file}: ${(original.length / 1_000_000).toFixed(2)} -> ${(bytes.length / 1_000_000).toFixed(2)} MB`,
    );
  }
  log(
    `[zk] ${assets.length} Brotli proving files ready (${compressed} compressed; ${(rawBytes / 1_000_000).toFixed(2)} -> ${(compressedBytes / 1_000_000).toFixed(2)} MB)`,
  );
  return { assetCount: assets.length, compressed, rawBytes, compressedBytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await compressZkAssets();
}
