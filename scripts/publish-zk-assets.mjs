#!/usr/bin/env node

import "dotenv/config";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry, listZkPublicAssets } from "../lib/zkPublicAssets.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

const CONTENT_TYPES = Object.freeze({
  ".wasm": "application/wasm",
  ".zkey": "application/octet-stream",
});
// Object keys are content addressed, so a published object never changes.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/** AWS Signature V4 for the R2 S3 API; the payload digest is signed, so R2 rejects altered bytes. */
export function signR2Request({
  credentials,
  method,
  key,
  payloadSha256,
  headers = {},
  now = new Date(),
}) {
  const { accountId, accessKeyId, secretAccessKey, bucket } = credentials;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const scope = `${amzDate.slice(0, 8)}/auto/s3/aws4_request`;
  const uri = `/${bucket}/${key}`;
  const signed = { ...headers, host, "x-amz-content-sha256": payloadSha256, "x-amz-date": amzDate };
  const names = Object.keys(signed).sort();
  const canonicalRequest = [
    method,
    uri,
    "",
    ...names.map((name) => `${name}:${signed[name]}`),
    "",
    names.join(";"),
    payloadSha256,
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = ["auto", "s3", "aws4_request"].reduce(
    hmac,
    hmac(`AWS4${secretAccessKey}`, amzDate.slice(0, 8)),
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const { host: _host, ...sent } = signed;
  return {
    url: `https://${host}${uri}`,
    headers: {
      ...sent,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
  };
}

function readCredentials(env) {
  const credentials = {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  };
  const missing = Object.entries({
    R2_ACCOUNT_ID: credentials.accountId,
    R2_ACCESS_KEY_ID: credentials.accessKeyId,
    R2_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    R2_BUCKET: credentials.bucket,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) throw new Error(`Missing R2 credentials in .env: ${missing.join(", ")}`);
  return credentials;
}

/** Uploads every manifest-pinned browser WASM/zkey that the bucket does not hold yet. */
export async function publishZkAssets({
  root = ROOT,
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  root = path.resolve(root);
  const credentials = readCredentials(env);
  const assets = listZkPublicAssets(root);
  // Check every file before uploading any, so an unfinished setup publishes nothing.
  for (const asset of assets) {
    if (sha256(await fs.readFile(path.join(root, asset.file))) !== asset.sha256) {
      throw new Error(`${asset.file} does not match its manifest digest; rerun the ZK setup first`);
    }
  }
  let uploaded = 0;
  for (const asset of assets) {
    const head = signR2Request({
      credentials,
      method: "HEAD",
      key: asset.key,
      payloadSha256: EMPTY_SHA256,
    });
    const existing = await fetchWithRetry(fetchImpl, head.url, {
      method: "HEAD",
      headers: head.headers,
    });
    if (existing.ok) continue;
    if (existing.status !== 404)
      throw new Error(`R2 HEAD ${asset.key} failed: HTTP ${existing.status}`);
    const bytes = await fs.readFile(path.join(root, asset.file));
    const put = signR2Request({
      credentials,
      method: "PUT",
      key: asset.key,
      payloadSha256: asset.sha256,
      headers: {
        "cache-control": CACHE_CONTROL,
        "content-type": CONTENT_TYPES[path.extname(asset.file)],
      },
    });
    const response = await fetchWithRetry(fetchImpl, put.url, {
      method: "PUT",
      headers: put.headers,
      body: bytes,
    });
    if (!response.ok) {
      throw new Error(
        `R2 PUT ${asset.key} failed: HTTP ${response.status} ${await response.text()}`,
      );
    }
    uploaded += 1;
    log(`[zk] Uploaded ${asset.file} -> ${asset.key}`);
  }
  log(`[zk] ${assets.length} browser proving files published (${uploaded} uploaded)`);
  return { assetCount: assets.length, uploaded };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await publishZkAssets();
}
