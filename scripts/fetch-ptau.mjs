#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_PTAU_EVIDENCE,
  PRODUCTION_PTAU_URL,
  ensureProductionPtau,
  productionPtauPath,
} from "./lib/productionPtau.mjs";

/** Explicit developer/CI installation; production setup never downloads Phase 1. */
export async function fetchPinnedPtau({
  root = process.cwd(),
  fetchImpl = globalThis.fetch,
  expected = PRODUCTION_PTAU_EVIDENCE,
} = {}) {
  root = await fs.realpath(root);
  const destination = productionPtauPath(root);
  const directory = path.dirname(destination);
  const validate = (file) => ensureProductionPtau({ root, env: { ZK_PTAU_PATH: file }, expected });
  try {
    await fs.lstat(destination);
    return await validate(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(directory, { recursive: true });
  if ((await fs.realpath(directory)) !== directory)
    throw new Error("Powers of Tau download directory must not traverse a symlink");
  const stage = await fs.mkdtemp(path.join(directory, ".ptau-download-"));
  const temporary = path.join(stage, "phase1.ptau");
  try {
    const response = await fetchImpl(PRODUCTION_PTAU_URL, {
      redirect: "error",
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`Powers of Tau download failed: HTTP ${response.status}`);
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > expected.bytes ? new Error("Powers of Tau download exceeds pinned size") : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      limit,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    await validate(temporary);
    try {
      // Exclusive publication prevents replacing a concurrently installed or unreviewed file.
      await fs.link(temporary, destination);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    return await validate(destination);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await fetchPinnedPtau();
  console.log(`Pinned Powers of Tau installed: ${result.path} (SHA-256 ${result.sha256})`);
}
