import { expect } from "chai";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fetchWithRetry, listZkPublicAssets } from "../lib/zkPublicAssets.js";
import { fetchZkAssets } from "../scripts/fetch-zk-assets.mjs";
import { publishZkAssets } from "../scripts/publish-zk-assets.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const BYTES = {
  "frontend/public/zk/person_commitment.wasm": Buffer.from("core-wasm"),
  "frontend/public/zk/person_commitment_final.zkey": Buffer.from("core-zkey"),
  "frontend/public/zk/shielded/shielded_claim.wasm": Buffer.from("claim-wasm"),
  "frontend/public/zk/shielded/shielded_claim_final.zkey": Buffer.from("claim-zkey"),
};
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
    fs.writeFileSync(
      path.join(root, "circuits/zk-artifacts-manifest.json"),
      JSON.stringify({
        circuits: {
          person_commitment: {
            wasmSha256: digest("person_commitment.wasm"),
            zkeySha256: digest("person_commitment_final.zkey"),
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(root, "circuits/shielded-development-manifest.json"),
      JSON.stringify({
        circuits: {
          claim: {
            source: "shielded_claim",
            wasmSha256: digest("shielded/shielded_claim.wasm"),
            zkeySha256: digest("shielded/shielded_claim_final.zkey"),
          },
        },
      }),
    );
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

  it("lists the WASM and zkey of every manifest circuit by content-addressed key", function () {
    expect(listZkPublicAssets(root)).to.deep.equal([
      {
        path: "/zk/person_commitment.wasm",
        file: "frontend/public/zk/person_commitment.wasm",
        key: `${digest("person_commitment.wasm")}/person_commitment.wasm`,
        sha256: digest("person_commitment.wasm"),
      },
      {
        path: "/zk/person_commitment_final.zkey",
        file: "frontend/public/zk/person_commitment_final.zkey",
        key: `${digest("person_commitment_final.zkey")}/person_commitment_final.zkey`,
        sha256: digest("person_commitment_final.zkey"),
      },
      {
        path: "/zk/shielded/shielded_claim.wasm",
        file: "frontend/public/zk/shielded/shielded_claim.wasm",
        key: `${digest("shielded/shielded_claim.wasm")}/shielded_claim.wasm`,
        sha256: digest("shielded/shielded_claim.wasm"),
      },
      {
        path: "/zk/shielded/shielded_claim_final.zkey",
        file: "frontend/public/zk/shielded/shielded_claim_final.zkey",
        key: `${digest("shielded/shielded_claim_final.zkey")}/shielded_claim_final.zkey`,
        sha256: digest("shielded/shielded_claim_final.zkey"),
      },
    ]);
  });

  it("prefers the shielded production manifest once it exists", function () {
    fs.writeFileSync(
      path.join(root, "circuits/shielded-production-manifest.json"),
      JSON.stringify({
        circuits: {
          claim: {
            source: "shielded_claim",
            wasmSha256: "a".repeat(64),
            zkeySha256: "b".repeat(64),
          },
        },
      }),
    );
    const shielded = listZkPublicAssets(root).filter((asset) => asset.path.includes("/shielded/"));
    expect(shielded.map((asset) => asset.sha256)).to.deep.equal(["a".repeat(64), "b".repeat(64)]);
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
    expect(result).to.deep.equal({ assetCount: 4, downloaded: 3 });
    expect(requests).to.deep.equal([
      `https://assets.example/${digest("person_commitment_final.zkey")}/person_commitment_final.zkey`,
      `https://assets.example/${digest("shielded/shielded_claim.wasm")}/shielded_claim.wasm`,
      `https://assets.example/${digest("shielded/shielded_claim_final.zkey")}/shielded_claim_final.zkey`,
    ]);
    for (const [file, bytes] of Object.entries(BYTES)) {
      expect(fs.readFileSync(path.join(root, file))).to.deep.equal(bytes);
    }
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
    const existingKey = `${digest("person_commitment.wasm")}/person_commitment.wasm`;
    const requests = [];
    const result = await publishZkAssets({
      root,
      env: CREDENTIALS,
      fetchImpl: async (url, init) => {
        requests.push({ url, method: init.method, headers: init.headers, body: init.body });
        if (init.method === "HEAD") {
          return new Response(null, { status: url.endsWith(existingKey) ? 200 : 404 });
        }
        return new Response(null, { status: 200 });
      },
      log: () => {},
    });
    expect(result).to.deep.equal({ assetCount: 4, uploaded: 3 });
    const puts = requests.filter((request) => request.method === "PUT");
    expect(puts.map((request) => request.url)).to.deep.equal(
      listZkPublicAssets(root)
        .filter((asset) => asset.key !== existingKey)
        .map((asset) => `https://account.r2.cloudflarestorage.com/bucket/${asset.key}`),
    );
    for (const put of puts) {
      expect(put.headers["x-amz-content-sha256"]).to.equal(sha256(put.body));
      expect(put.headers["cache-control"]).to.equal("public, max-age=31536000, immutable");
      expect(put.headers.authorization).to.match(
        /^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
      );
    }
    expect(puts.map((put) => put.headers["content-type"])).to.deep.equal([
      "application/octet-stream",
      "application/wasm",
      "application/octet-stream",
    ]);
  });

  it("refuses to publish local files that differ from the manifest", async function () {
    for (const file of Object.keys(BYTES)) writeLocal(file);
    writeLocal("frontend/public/zk/shielded/shielded_claim_final.zkey", Buffer.from("regenerated"));
    let error;
    try {
      await publishZkAssets({
        root,
        env: CREDENTIALS,
        fetchImpl: async () => new Response(null, { status: 404 }),
        log: () => {},
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.contain("does not match its manifest digest");
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
