import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "vitest";

import { SHIELDED_CIRCUITS } from "../../scripts/zk-shielded-build.mjs";
import {
  assertNoShieldedPublicArtifacts,
  readShieldedDevelopmentArtifact,
} from "./shielded-dev-artifacts.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-vite-dev-"));
  try {
    const directory = path.join(root, "zk-artifacts", "shielded");
    fs.mkdirSync(path.join(directory, "shielded_claim_js"), { recursive: true });
    const files = {
      wasm: path.join(directory, "shielded_claim_js", "shielded_claim.wasm"),
      zkey: path.join(directory, "shielded_claim_dev_final.zkey"),
      vkey: path.join(directory, "shielded_claim.vkey.json"),
    };
    fs.writeFileSync(files.wasm, "wasm bytes");
    fs.writeFileSync(files.zkey, "dev key bytes");
    fs.writeFileSync(files.vkey, "{}\n");
    const circuits = Object.fromEntries(
      Object.entries(SHIELDED_CIRCUITS).map(([action, source]) => [action, { source }]),
    );
    circuits.claim = {
      ...circuits.claim,
      wasmSha256: hash(fs.readFileSync(files.wasm)),
      zkeySha256: hash(fs.readFileSync(files.zkey)),
      verificationKeySha256: hash(fs.readFileSync(files.vkey)),
    };
    const manifest = {
      schema: "deepfamily/shielded-development-keys@1",
      developmentOnly: true,
      productionReady: false,
      circuits,
    };
    const manifestFile = path.join(directory, "development-manifest.json");
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    return callback({ root, files, manifest, manifestFile });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

it("Vite dev route serves only manifest-pinned ignored proof artifacts", () => {
  fixture(({ root }) => {
    assert.equal(
      readShieldedDevelopmentArtifact("/zk/shielded/shielded_claim_final.zkey", {
        root,
      }).bytes.toString(),
      "dev key bytes",
    );
    assert.equal(readShieldedDevelopmentArtifact("/zk/person_commitment.wasm", { root }), null);
    assert.throws(
      () => readShieldedDevelopmentArtifact("/zk/shielded/not_a_circuit.zkey", { root }),
      /Unknown shielded development artifact path/,
    );
  });
});

it("Vite dev route rejects changed bytes and production-marked manifests", () => {
  fixture(({ root, files, manifest, manifestFile }) => {
    fs.writeFileSync(files.zkey, "changed");
    assert.throws(
      () => readShieldedDevelopmentArtifact("/zk/shielded/shielded_claim_final.zkey", { root }),
      /digest mismatch/,
    );
    manifest.productionReady = true;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.throws(
      () => readShieldedDevelopmentArtifact("/zk/shielded/shielded_claim.wasm", { root }),
      /manifest is invalid/,
    );
  });
});

it("production build refuses proof files in the public directory", () => {
  fixture(({ root }) => {
    assert.doesNotThrow(() => assertNoShieldedPublicArtifacts(root));
    fs.mkdirSync(path.join(root, "public", "zk", "shielded"), { recursive: true });
    assert.throws(() => assertNoShieldedPublicArtifacts(root), /must not be copied/);
  });
});
