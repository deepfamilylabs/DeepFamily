import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadCandidateArtifacts } from "../scripts/lib/shieldedArtifacts.mjs";
import { SHIELDED_SETUP_CIRCUITS } from "../scripts/lib/shieldedProductionSetup.mjs";
import { ensureZkArtifacts } from "../scripts/ensure-zk-artifacts.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function writeFixture(root, { production = false } = {}) {
  const manifest = {
    schema: production
      ? "deepfamily/shielded-production-artifacts@1"
      : "deepfamily/shielded-development-keys@1",
    ...(production ? { status: "production" } : {}),
    developmentOnly: !production,
    productionReady: production,
    circuits: {},
  };
  const write = (relative, content) => {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
    return sha256(content);
  };
  for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
    const { source, verifierContractName: contractName, verifierPath } = spec;
    const vkey = JSON.stringify({ nPublic: spec.publicSignals });
    const verifierSha256 =
      verifierPath && write(verifierPath, `contract ${contractName} { /* ${action} */ }`);
    write(`frontend/public/zk/shielded/${source}.wasm`, `wasm-${action}`);
    manifest.circuits[action] = {
      source,
      publicSignals: spec.publicSignals,
      sourceSha256: write(`circuits/${source}.circom`, `source-${action}`),
      r1csSha256: write(`zk-artifacts/shielded/${source}.r1cs`, `r1cs-${action}`),
      wasmSha256: write(`zk-artifacts/shielded/${source}_js/${source}.wasm`, `wasm-${action}`),
      zkeySha256: write(`frontend/public/zk/shielded/${source}_final.zkey`, `zkey-${action}`),
      verificationKeySha256: write(`frontend/public/zk/shielded/${source}.vkey.json`, vkey),
      ...(verifierPath && {
        verifierPath,
        verifierContractName: contractName,
        ...(production ? { verifierSha256 } : { solidityVerifierSha256: verifierSha256 }),
      }),
    };
  }
  const candidateManifest = `circuits/shielded-${production ? "production" : "development"}-manifest.json`;
  write(candidateManifest, JSON.stringify(manifest));
  return {
    candidateManifest,
  };
}

describe("current public shielded artifacts", function () {
  it("checks the five candidate verifier files and all eight proof-artifact digests", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-rehearsal-test-"));
    try {
      const options = writeFixture(root);
      const candidate = loadCandidateArtifacts({ root, ...options });
      assert.equal(Object.keys(candidate.circuits).length, 8);
      assert.equal(candidate.candidateClass, "development-only");
      for (const [action, entry] of Object.entries(candidate.circuits)) {
        assert.ok(entry.zkey.includes(path.join("frontend", "public", "zk", "shielded")));
        assert.ok(entry.vkey.includes(path.join("frontend", "public", "zk", "shielded")));
        assert.equal(
          entry.contractName,
          action === "receiveCode"
            ? null
            : `Shielded${action[0].toUpperCase()}${action.slice(1)}Verifier`,
        );
      }
      assert.equal(candidate.circuits.receiveCode.verifier, null);
      fs.appendFileSync(candidate.circuits.claim.verifier, "\nmodified");
      assert.throws(
        () => loadCandidateArtifacts({ root, ...options }),
        /claim verifier SHA-256 mismatch/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("selects the production manifest and public keys while stale development mirrors exist", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-rehearsal-production-"));
    try {
      writeFixture(root);
      writeFixture(root, { production: true });
      fs.writeFileSync(
        path.join(root, "zk-artifacts/shielded/shielded_claim_dev_final.zkey"),
        "stale dev key",
      );
      const candidate = loadCandidateArtifacts({ root });
      assert.equal(candidate.candidateClass, "production-candidate-unapproved");
      assert.equal(fs.readFileSync(candidate.circuits.claim.zkey, "utf8"), "zkey-claim");
      fs.appendFileSync(candidate.circuits.claim.zkey, "changed public key");
      assert.throws(() => loadCandidateArtifacts({ root }), /claim zkey SHA-256 mismatch/);
      fs.rmSync(candidate.circuits.claim.zkey);
      assert.throws(
        () => loadCandidateArtifacts({ root }),
        (error) => error.code === "ENOENT" && error.path === candidate.circuits.claim.zkey,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rebuilds absent ignored compilation outputs while retaining checked-in public keys", async function () {
    for (const production of [false, true]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-rehearsal-clean-clone-"));
      try {
        writeFixture(root, { production });
        const original = loadCandidateArtifacts({ root });
        const compiled = Object.values(original.circuits)
          .flatMap((entry) => [
            entry.r1cs,
            path.join(root, `zk-artifacts/shielded/${entry.source}_js/${entry.source}.wasm`),
          ])
          .map((file) => ({ file, bytes: fs.readFileSync(file) }));
        const keyHashes = Object.values(original.circuits).map((entry) =>
          sha256(fs.readFileSync(entry.zkey)),
        );
        fs.rmSync(path.join(root, "zk-artifacts/shielded"), { recursive: true });
        let builds = 0;
        const result = await ensureZkArtifacts({
          root,
          check: () => loadCandidateArtifacts({ root }),
          build: (options) => {
            assert.deepEqual(options, { root, circuit: "all" });
            builds += 1;
            for (const { file, bytes } of compiled) {
              fs.mkdirSync(path.dirname(file), { recursive: true });
              fs.writeFileSync(file, bytes);
            }
          },
          setup: () => assert.fail("Existing public keys must be reused"),
          log: () => {},
        });
        assert.equal(builds, 1);
        assert.equal(result.regenerated, false);
        assert.equal(Object.keys(result.artifacts.circuits).length, 8);
        assert.deepEqual(
          Object.values(result.artifacts.circuits).map((entry) =>
            sha256(fs.readFileSync(entry.zkey)),
          ),
          keyHashes,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("rejects a verifier path or name belonging to another circuit", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-rehearsal-identity-"));
    try {
      const options = writeFixture(root);
      const file = path.join(root, options.candidateManifest);
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      manifest.circuits.claim.verifierPath = manifest.circuits.fund.verifierPath;
      manifest.circuits.claim.verifierContractName = manifest.circuits.fund.verifierContractName;
      fs.writeFileSync(file, JSON.stringify(manifest));
      assert.throws(
        () => loadCandidateArtifacts({ root, ...options }),
        /claim verifier identity differs/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
