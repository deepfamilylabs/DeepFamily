import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { id } from "ethers";

import {
  assertRehearsalNetwork,
  loadCandidateArtifacts,
  parseRehearsalArguments,
  runShieldedTestnetRehearsal,
} from "../scripts/shielded-testnet-rehearsal.mjs";
import { SHIELDED_CIRCUITS } from "../scripts/zk-shielded-build.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lineageAddress = "0x0000000000000000000000000000000000000071";

function testConnection(overrides = {}) {
  const broadcasts = [];
  const signer = { getAddress: async () => "0x0000000000000000000000000000000000000001" };
  let nextAddress = 1000;
  function factory(label, metadata = {}) {
    return {
      async deploy(...args) {
        const sequence = broadcasts.length + 1;
        const address = `0x${(++nextAddress).toString(16).padStart(40, "0")}`;
        const hash = `0x${sequence.toString(16).padStart(64, "0")}`;
        broadcasts.push({ label, args, address, hash, metadata });
        return {
          getAddress: async () => address,
          deploymentTransaction: () => ({ hash, wait: async () => ({ status: 1, gasUsed: 123n }) }),
        };
      },
    };
  }
  const provider = {
    send: async () => overrides.rawChainId ?? "0x47",
    getNetwork: async () => ({ chainId: overrides.providerChainId ?? 71n }),
    getCode: async () => overrides.lineageCode ?? "0x6000",
    getBalance: async () => 1n,
  };
  const ethers = {
    provider,
    ContractFactory: class {
      constructor(abi) {
        return factory(`${abi[0]}Verifier`);
      }
    },
    getSigners: async () => [signer],
    getContractAt: async () => ({
      indexKind: async () => id("deepfamily.lineage-index.v1"),
      apiVersion: async () => 1n,
    }),
    getContractFactory: async (label, metadata) => factory(label, metadata),
  };
  return {
    connection: { networkName: overrides.networkName ?? "confluxTestnet", ethers },
    broadcasts,
  };
}

function fakeCandidate() {
  return {
    candidateClass: "development-only",
    candidateManifestSha256: "a".repeat(64),
    circuits: Object.fromEntries(
      Object.keys(SHIELDED_CIRCUITS).map((action) => [
        action,
        { source: SHIELDED_CIRCUITS[action] },
      ]),
    ),
  };
}

function fakeCompiled() {
  return Object.fromEntries(
    Object.keys(SHIELDED_CIRCUITS).map((action) => [
      action,
      { abi: [action], evm: { bytecode: { object: "60006000" } } },
    ]),
  );
}

function writeFixture(root) {
  const manifest = {
    schema: "deepfamily/shielded-development-keys@1",
    developmentOnly: true,
    productionReady: false,
    circuits: {},
  };
  const write = (relative, content) => {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
    return sha256(content);
  };
  for (const [action, source] of Object.entries(SHIELDED_CIRCUITS)) {
    const vkey = JSON.stringify({ nPublic: action === "keyRegistration" ? 7 : 32 });
    manifest.circuits[action] = {
      source,
      sourceSha256: write(`circuits/${source}.circom`, `source-${action}`),
      r1csSha256: write(`zk-artifacts/shielded/${source}.r1cs`, `r1cs-${action}`),
      wasmSha256: write(`zk-artifacts/shielded/${source}_js/${source}.wasm`, `wasm-${action}`),
      zkeySha256: write(`zk-artifacts/shielded/${source}_dev_final.zkey`, `zkey-${action}`),
      verificationKeySha256: write(`zk-artifacts/shielded/${source}.vkey.json`, vkey),
      verifierSha256: write(
        `zk-artifacts/shielded/verifiers/${source}.sol`,
        `contract Groth16Verifier { /* ${action} */ }`,
      ),
    };
  }
  write("zk-artifacts/shielded/development-manifest.json", JSON.stringify(manifest));
  return {
    candidateManifest: "zk-artifacts/shielded/development-manifest.json",
    verifierDirectory: "zk-artifacts/shielded/verifiers",
  };
}

describe("shielded testnet rehearsal deployment safety", function () {
  it("requires explicit execution, candidate artifacts, and a lineage address", function () {
    assert.throws(() => parseRehearsalArguments([]), /Usage:/);
    assert.throws(
      () =>
        parseRehearsalArguments([
          "--execute",
          "--candidate-manifest",
          "a",
          "--verifier-dir",
          "b",
          "--lineage",
          lineageAddress,
          "--token",
          lineageAddress,
        ]),
      /Unexpected/,
    );
    assert.deepEqual(
      parseRehearsalArguments([
        "--execute",
        "--candidate-manifest",
        "zk-artifacts/shielded/development-manifest.json",
        "--verifier-dir",
        "zk-artifacts/shielded/verifiers",
        "--lineage",
        lineageAddress,
      ]),
      {
        candidateManifest: "zk-artifacts/shielded/development-manifest.json",
        verifierDirectory: "zk-artifacts/shielded/verifiers",
        lineageAddress,
      },
    );
  });

  it("checks both raw RPC and provider chain IDs before loading or broadcasting", async function () {
    for (const overrides of [
      { networkName: "conflux" },
      { rawChainId: "0x406" },
      { providerChainId: 1030n },
    ]) {
      const { connection, broadcasts } = testConnection(overrides);
      let loaded = false;
      await assert.rejects(
        runShieldedTestnetRehearsal({
          connection,
          options: { lineageAddress },
          loadCandidate: () => {
            loaded = true;
            throw new Error("should not load");
          },
        }),
        /requires/,
      );
      assert.equal(loaded, false);
      assert.equal(broadcasts.length, 0);
    }
    await assertRehearsalNetwork(testConnection().connection);
  });

  it("checks all nine candidate verifier files and proof-artifact digests", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-rehearsal-test-"));
    try {
      const options = writeFixture(root);
      const candidate = loadCandidateArtifacts({ root, ...options });
      assert.equal(Object.keys(candidate.circuits).length, 9);
      assert.equal(candidate.candidateClass, "development-only");
      fs.appendFileSync(candidate.circuits.claim.verifier, "\nmodified");
      assert.throws(
        () => loadCandidateArtifacts({ root, ...options }),
        /claim verifier SHA-256 mismatch/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an address without lineage code before any broadcast", async function () {
    const { connection, broadcasts } = testConnection({ lineageCode: "0x" });
    await assert.rejects(
      runShieldedTestnetRehearsal({
        connection,
        options: { lineageAddress },
        loadCandidate: fakeCandidate,
        verifyDerivation: () => {},
        compileVerifiers: fakeCompiled,
      }),
      /lineage index address has no code/,
    );
    assert.equal(broadcasts.length, 0);
  });

  it("wires nine explicit verifiers, eight adapters, a fresh TDEEP token, and the pool", async function () {
    const { connection, broadcasts } = testConnection();
    const records = [];
    const result = await runShieldedTestnetRehearsal({
      connection,
      options: { lineageAddress },
      loadCandidate: fakeCandidate,
      verifyDerivation: () => {},
      compileVerifiers: fakeCompiled,
      write: (record) => records.push(record),
    });
    assert.equal(broadcasts.length, 22);
    assert.deepEqual(
      broadcasts.slice(0, 9).map((entry) => entry.label),
      Object.keys(SHIELDED_CIRCUITS).map((action) => `${action}Verifier`),
    );
    assert.deepEqual(
      broadcasts.slice(9, 17).map((entry) => entry.args[1]),
      [0, 1, 2, 3, 4, 5, 6, 7],
    );
    assert.deepEqual(
      broadcasts.slice(9, 17).map((entry) => entry.args[0]),
      broadcasts.slice(1, 9).map((entry) => entry.address),
    );
    const token = broadcasts.find((entry) => entry.label === "ShieldedPoolTokenMock");
    const registry = broadcasts.find((entry) => entry.label === "ShieldedHeirKeyRegistry");
    const pool = broadcasts.find((entry) => entry.label === "ShieldedDeepPool");
    assert.ok(token);
    assert.ok(registry);
    assert.ok(pool);
    assert.equal(pool.args[0], token.address);
    assert.equal(pool.args[1], lineageAddress);
    assert.equal(pool.args[2], registry.address);
    assert.deepEqual(
      pool.args[3],
      broadcasts.slice(9, 17).map((entry) => entry.address),
    );
    assert.equal(result.releaseEvidence, false);
    assert.equal(result.benchmarkMeasured, false);
    assert.equal(result.candidateClass, "development-only");
    assert.equal(result.testToken, token.address);
    assert.equal(records.at(-1).type, "rehearsal-deployed");
  });
});
