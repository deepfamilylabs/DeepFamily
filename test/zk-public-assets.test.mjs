import { expect } from "chai";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fetchWithRetry, listZkPublicAssets } from "../lib/zkPublicAssets.js";
import { configuredZkAssetBaseUrl, fetchZkAssets } from "../scripts/fetch-zk-assets.mjs";
import { publishZkAssets } from "../scripts/publish-zk-assets.mjs";
import { compressZkAssets } from "../scripts/compress-zk-assets.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const CORE = ["person_commitment", "disclosure_binding"];
const BOUNDARIES = ["shielded_shield", "shielded_unshield", "shielded_unshield_4"];
const PROTOCOL = ["eligibility_source_fact", "eligibility_source_trust", "eligibility_issue", "receive_code", "budget_capability", "budget_deposit", "budget_claim", "value_transfer"];
const BYTES = Object.fromEntries([
  ...CORE.map(name => ["", name]), ...BOUNDARIES.map(name => ["shielded/", name]), ...PROTOCOL.map(name => ["protocol/", name]),
].flatMap(([directory, name]) => [
  [`frontend/public/zk/${directory}${name}.wasm`, Buffer.from(`${name}-wasm`)],
  [`frontend/public/zk/${directory}${name}_final.zkey`, Buffer.from(`${name}-zkey`)],
]));
const ASSET_COUNT = 26;
const digest = (file) => sha256(BYTES[`frontend/public/zk/${file}`]);
const CREDENTIALS = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key-id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
};

describe("ZK public proving assets", function () {
  let root;
  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-zk-assets-"));
    fs.mkdirSync(path.join(root, "circuits"));
    fs.writeFileSync(path.join(root, "circuits/zk-artifacts-manifest.json"), JSON.stringify({ circuits: Object.fromEntries(CORE.map(name => [name, {
      wasmSha256: digest(`${name}.wasm`), zkeySha256: digest(`${name}_final.zkey`),
    }])) }));
    fs.writeFileSync(path.join(root, "circuits/shielded-development-manifest.json"), JSON.stringify({ circuits: Object.fromEntries(["shield", "unshield", "unshield4"].map((action, index) => [action, {
      source: BOUNDARIES[index], wasmSha256: digest(`shielded/${BOUNDARIES[index]}.wasm`), zkeySha256: digest(`shielded/${BOUNDARIES[index]}_final.zkey`),
    }])) }));
    fs.writeFileSync(path.join(root, "circuits/receive-development-manifest.json"), JSON.stringify({ protocol: "deepfamily.receive", production:false,
      circuits: Object.fromEntries(PROTOCOL.map(source => [source, { source,
        compiled: { [`frontend/public/zk/protocol/${source}.wasm`]:digest(`protocol/${source}.wasm`) },
        setup: { artifacts: { [`frontend/public/zk/protocol/${source}_final.zkey`]:digest(`protocol/${source}_final.zkey`) } },
      }])),
    }));
  });
  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeLocal = (file, bytes = BYTES[file]) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), bytes);
  };
  const serve =
    (requests, bytesFor = (file) => BYTES[file]) =>
    async (url) => {
      requests.push(url);
      const asset = listZkPublicAssets(root).find((item) => url.endsWith(`/${item.key}`));
      return asset ? new Response(bytesFor(asset.file)) : new Response("missing", { status: 404 });
    };

  it("lists exactly the current 13 public relation pairs by pinned digest", function () {
    const assets = listZkPublicAssets(root);
    expect(assets).to.have.length(ASSET_COUNT);
    expect(new Set(assets.map(asset => asset.path)).size).to.equal(ASSET_COUNT);
    for (const asset of assets) {
      expect(asset.sha256).to.equal(sha256(BYTES[asset.file]));
      expect(asset.key).to.equal(`${asset.sha256}/${path.basename(asset.file)}.br`);
    }
    expect(assets.filter(asset => asset.path.includes("/protocol/"))).to.have.length(16);
    expect(fs.existsSync(path.join(root, "zk-artifacts"))).to.equal(false,
      "a fresh checkout can enumerate and fetch artifacts using only committed manifests");
  });
  it("rejects an incomplete receiving relation graph", function () {
    const file = path.join(root, "circuits/receive-development-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(file,"utf8"));
    delete manifest.circuits.receive_code;
    fs.writeFileSync(file, JSON.stringify(manifest));
    expect(()=>listZkPublicAssets(root)).to.throw("All eight receiving proof statements are required");
  });

  it("downloads only missing or stale files and verifies their digests", async function () {
    writeLocal("frontend/public/zk/person_commitment.wasm");
    writeLocal("frontend/public/zk/person_commitment_final.zkey", Buffer.from("stale"));
    const requests = [];
    const result = await fetchZkAssets({
      root,
      baseUrl: "https://assets.example/",
      fetchImpl: serve(requests),
      log: () => {},
    });
    expect(result).to.deep.equal({ assetCount: ASSET_COUNT, downloaded: ASSET_COUNT - 1 });
    expect(requests).to.deep.equal(listZkPublicAssets(root).filter(asset => asset.file !== "frontend/public/zk/person_commitment.wasm").map(asset => `https://assets.example/${asset.key}`));
    for (const [file, bytes] of Object.entries(BYTES)) {
      expect(fs.readFileSync(path.join(root, file))).to.deep.equal(bytes);
    }
  });

  describe("asset host", function () {
    let saved;
    beforeEach(function () {
      saved = process.env.VITE_ZK_ASSET_BASE_URL;
      delete process.env.VITE_ZK_ASSET_BASE_URL;
    });
    afterEach(function () {
      if (saved === undefined) delete process.env.VITE_ZK_ASSET_BASE_URL;
      else process.env.VITE_ZK_ASSET_BASE_URL = saved;
    });

    it("reads VITE_ZK_ASSET_BASE_URL the way the build does, the environment first", function () {
      fs.mkdirSync(path.join(root, "frontend"));
      fs.writeFileSync(
        path.join(root, "frontend/.env.local"),
        "VITE_ZK_ASSET_BASE_URL=https://local.example\n",
      );
      expect(configuredZkAssetBaseUrl(root)).to.equal("https://local.example");

      process.env.VITE_ZK_ASSET_BASE_URL = "https://ci.example";
      expect(configuredZkAssetBaseUrl(root)).to.equal("https://ci.example");
    });

    it("names no host of its own", async function () {
      expect(() => configuredZkAssetBaseUrl(root)).to.throw(/VITE_ZK_ASSET_BASE_URL is not set/);
      let error;
      try {
        await fetchZkAssets({ root, fetchImpl: async () => expect.fail("nothing to fetch from") });
      } catch (caught) {
        error = caught;
      }
      expect(error?.message).to.match(/VITE_ZK_ASSET_BASE_URL is not set/);
    });
  });

  it("rejects downloaded bytes that differ from the manifest digest", async function () {
    let error;
    try {
      await fetchZkAssets({
        root,
        baseUrl: "https://assets.example",
        fetchImpl: serve([], () => Buffer.from("tampered")),
        log: () => {},
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.contain("ZK asset SHA-256 mismatch");
    expect(fs.existsSync(path.join(root, "frontend/public/zk/person_commitment.wasm"))).to.equal(
      false,
    );
  });

  it("names the publish step when the asset host lacks a pinned file", async function () {
    let error;
    try {
      await fetchZkAssets({
        root,
        baseUrl: "https://assets.example",
        fetchImpl: async () => new Response("missing", { status: 404 }),
        log: () => {},
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.contain("HTTP 404");
    expect(error?.message).to.contain("npm run zk:assets:publish");
  });

  it("uploads only objects the bucket lacks, signing each payload digest", async function () {
    for (const file of Object.keys(BYTES)) writeLocal(file);
    const existingKey = `${digest("person_commitment.wasm")}/person_commitment.wasm.br`;
    const requests = [];
    const result = await publishZkAssets({
      root,
      env: CREDENTIALS,
      fetchImpl: async (url, init) => {
        requests.push({ url, method: init.method, headers: init.headers, body: init.body });
        if (init.method === "HEAD") {
          return new Response(null, {
            status: url.endsWith(existingKey) ? 200 : 404,
            headers: { "content-encoding": "br" },
          });
        }
        return new Response(null, { status: 200 });
      },
      log: () => {},
    });
    expect(result).to.deep.equal({ assetCount: ASSET_COUNT, uploaded: ASSET_COUNT - 1 });
    const puts = requests.filter((request) => request.method === "PUT");
    expect(puts.map((request) => request.url)).to.deep.equal(
      listZkPublicAssets(root)
        .filter((asset) => asset.key !== existingKey)
        .map((asset) => `https://account.r2.cloudflarestorage.com/bucket/${asset.key}`),
    );
    for (const put of puts) {
      expect(put.headers["x-amz-content-sha256"]).to.equal(sha256(put.body));
      expect(put.headers["cache-control"]).to.equal("public, max-age=31536000, immutable");
      expect(put.headers["content-encoding"]).to.equal("br");
      const asset = listZkPublicAssets(root).find((item) => put.url.endsWith(`/${item.key}`));
      expect(brotliDecompressSync(put.body)).to.deep.equal(BYTES[asset.file]);
      expect(put.headers["x-amz-content-sha256"]).not.to.equal(asset.sha256);
      expect(put.headers.authorization).to.match(
        /^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-encoding;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
      );
    }
    expect(puts.map(put => put.headers["content-type"])).to.deep.equal(
      listZkPublicAssets(root).filter(asset => asset.key !== existingKey).map(asset => asset.file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream"));
  });

  it("compresses, reuses valid sidecars and repairs corrupt or stale copies", async function () {
    for (const file of Object.keys(BYTES)) writeLocal(file);
    const first = await compressZkAssets({ root, log: () => {} });
    expect(first.assetCount).to.equal(ASSET_COUNT);
    expect(first.compressed).to.equal(ASSET_COUNT);
    expect(first.rawBytes).to.equal(
      Object.values(BYTES).reduce((total, bytes) => total + bytes.length, 0),
    );
    for (const [file, original] of Object.entries(BYTES)) {
      expect(brotliDecompressSync(fs.readFileSync(path.join(root, `${file}.br`)))).to.deep.equal(
        original,
      );
      expect(fs.readFileSync(path.join(root, file))).to.deep.equal(original);
    }
    expect(await compressZkAssets({ root, log: () => {} })).to.deep.equal({
      ...first,
      compressed: 0,
    });

    const files = Object.keys(BYTES);
    fs.writeFileSync(path.join(root, `${files[0]}.br`), Buffer.from("corrupt"));
    fs.writeFileSync(path.join(root, `${files[1]}.br`), brotliCompressSync(Buffer.from("stale")));
    const repaired = await compressZkAssets({ root, log: () => {} });
    expect(repaired.compressed).to.equal(2);
    for (const file of files) {
      expect(brotliDecompressSync(fs.readFileSync(path.join(root, `${file}.br`)))).to.deep.equal(
        BYTES[file],
      );
    }
  });

  it("refuses an existing encoded URL without the required Content-Encoding metadata", async function () {
    for (const file of Object.keys(BYTES)) writeLocal(file);
    let error;
    const methods = [];
    try {
      await publishZkAssets({
        root,
        env: CREDENTIALS,
        fetchImpl: async (_url, init) => {
          methods.push(init.method);
          return new Response(null, { status: 200 });
        },
        log: () => {},
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.contain("missing Content-Encoding: br");
    expect(methods).to.deep.equal(["HEAD"]);
  });

  it("downloads Brotli over real HTTP and installs decoded files with their original digests", async function () {
    const requests = [];
    const assets = listZkPublicAssets(root);
    const server = createServer((request, response) => {
      requests.push(request.url);
      const asset = assets.find((item) => request.url === `/${item.key}`);
      if (!asset) {
        response.writeHead(404).end();
        return;
      }
      const bytes = brotliCompressSync(BYTES[asset.file]);
      response.writeHead(200, {
        "content-encoding": "br",
        "content-type": asset.file.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream",
        "content-length": bytes.length,
      });
      response.end(bytes);
    });
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const result = await fetchZkAssets({
        root,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        log: () => {},
      });
      expect(result).to.deep.equal({ assetCount: ASSET_COUNT, downloaded: ASSET_COUNT });
      expect(requests).to.deep.equal(assets.map((asset) => `/${asset.key}`));
      for (const [file, bytes] of Object.entries(BYTES)) {
        expect(fs.readFileSync(path.join(root, file))).to.deep.equal(bytes);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("refuses to publish local files that differ from the manifest", async function () {
    for (const file of Object.keys(BYTES)) writeLocal(file);
    writeLocal(
      "frontend/public/zk/protocol/budget_deposit_final.zkey",
      Buffer.from("regenerated"),
    );
    let error;
    try {
      await publishZkAssets({
        root,
        env: CREDENTIALS,
        fetchImpl: async () => expect.fail("validate the complete set before contacting R2"),
        log: () => {},
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.contain("does not match its manifest digest");
    for (const file of Object.keys(BYTES)) {
      expect(fs.existsSync(path.join(root, `${file}.br`))).to.equal(false);
    }
  });

  it("retries reset connections and server errors but not client errors", async function () {
    const statuses = [];
    const flaky = (outcomes) => async () => {
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      statuses.push(outcome);
      return new Response(null, { status: outcome });
    };
    const options = { attempts: 3, delayMs: 0 };
    const reset = new TypeError("fetch failed");

    const recovered = await fetchWithRetry(flaky([reset, 503, 200]), "https://x/a", {}, options);
    expect(recovered.status).to.equal(200);
    expect(statuses).to.deep.equal([503, 200]);

    const missing = await fetchWithRetry(flaky([404, 200]), "https://x/b", {}, options);
    expect(missing.status).to.equal(404);

    const exhausted = await fetchWithRetry(flaky([500, 502, 503]), "https://x/c", {}, options);
    expect(exhausted.status).to.equal(503);

    let error;
    try {
      await fetchWithRetry(flaky([reset, reset, reset]), "https://x/d", { method: "PUT" }, options);
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.equal("PUT https://x/d failed after 3 attempts");
    expect(error?.cause).to.equal(reset);
  });

  it("names every missing R2 credential", async function () {
    let error;
    try {
      await publishZkAssets({ root, env: { R2_BUCKET: "bucket" }, fetchImpl: async () => {} });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.equal(
      "Missing R2 credentials in .env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
    );
  });
});
