import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RECEIVE_CIRCUITS,
  RECEIVE_BUILD_MANIFEST,
  RECEIVE_DEVELOPMENT_MANIFEST,
  RECEIVE_PRODUCTION_MANIFEST,
  inspectReceiveArtifacts,
  readReceiveBuildSnapshot,
  receiveArtifactSha256,
  receiveLoaderSourceHashes,
  receiveProverSourceHashes,
} from "../scripts/lib/receiveArtifacts.mjs";
import { RECEIVE_CIRCUIT_VERSION } from "../packages/receive-prover/browser.mjs";
import { runZkDevelopmentSetup } from "../scripts/zk-development-setup.mjs";

describe("receive presentation artifact trust", function () {
  let root;
  let summary;
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const write = (file, bytes) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    return hash(bytes);
  };
  const json = (file, value) => write(file, `${JSON.stringify(value)}\n`);
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const rewriteKind = (kind, mutate) => {
    const file = `frontend/public/zk/receive/${kind}/manifest.json`;
    const item = read(file);
    mutate(item);
    summary.kinds[kind].manifestSha256 = json(file, item);
    json(
      summary.productionReady ? RECEIVE_PRODUCTION_MANIFEST : RECEIVE_DEVELOPMENT_MANIFEST,
      summary,
    );
  };
  const productionFixture = () => {
    Object.assign(summary, {
      schema: "deepfamily/receive-production-keys@1",
      developmentOnly: false,
      productionReady: true,
      releaseCommit: "12".repeat(20),
      ceremonyId: "receive-production-2026-001",
      trustModel: "single-operator",
      minimumContributors: 1,
      contributorCount: 1,
      issuerManifestSha256: json("circuits/shielded-production-manifest.json", {
        status: "production",
        productionReady: true,
        developmentOnly: false,
      }),
      toolchain: {
        goVersion: "go version go1.26.8 darwin/arm64",
        goBinarySha256: "a".repeat(64),
      },
    });
    for (const [kind, spec] of Object.entries(RECEIVE_CIRCUITS)) {
      const entry = summary.kinds[kind];
      const ceremony = {
        schema: "deepfamily/receive-gnark-ceremony@1",
        trustModel: "single-operator",
        contributorCount: 1,
        minimumContributors: 1,
        randomnessSource: "crypto/rand",
        finalizationSource: "crypto/rand, generated after the corresponding contribution",
        r1csSha256: entry.artifacts["receipt.r1cs"],
        constraints: 23,
        publicSignals: spec.publicSignals,
        domainSize: 32,
        contractName: spec.contractName,
        artifacts: Object.fromEntries(
          Object.entries(entry.artifacts).filter(([file]) => file !== "receipt.r1cs"),
        ),
      };
      entry.ceremony = { path: `release-evidence/receive/${kind}/ceremony.json` };
      for (const phase of ["phase1", "phase2"]) {
        const file = `${phase}.contribution`,
          relative = `release-evidence/receive/${kind}/${file}`;
        const digest = write(relative, `${kind}/${phase}`);
        ceremony[phase] = { file, sha256: digest, finalization: "c".repeat(64) };
        entry.ceremony[phase] = { path: relative, sha256: digest };
      }
      entry.ceremony.sha256 = json(entry.ceremony.path, ceremony);
      rewriteKind(kind, (item) => {
        item.productionCeremony = true;
        item.setup = "single-operator-mpc";
        item.ceremonyId = summary.ceremonyId;
      });
    }
    json(RECEIVE_PRODUCTION_MANIFEST, summary);
  };

  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-trust-"));
    for (const file of [
      "main.go",
      "go.mod",
      "go.sum",
      "poseidon-constants.json",
      "browser.mjs",
      "worker.mjs",
      "wasm_exec.js",
    ]) {
      write(`packages/receive-prover/${file}`, file);
    }
    summary = {
      schema: "deepfamily/receive-development-keys@1",
      developmentOnly: true,
      productionReady: false,
      circuitVersion: RECEIVE_CIRCUIT_VERSION,
      sourceFiles: receiveProverSourceHashes({ root }),
      loaderSources: receiveLoaderSourceHashes({ root }),
      runtime: {
        wasmSha256: write("frontend/public/zk/receive/receive-prover.wasm", "wasm"),
        wasmExecSha256: write("frontend/public/zk/receive/wasm_exec.js", "wasm_exec.js"),
      },
      kinds: {},
    };
    for (const [kind, spec] of Object.entries(RECEIVE_CIRCUITS)) {
      const artifacts = {};
      const issuerVkSha256 = write(
        `frontend/public/zk/shielded/${spec.issuer}.vkey.json`,
        spec.issuer,
      );
      for (const file of ["receipt.r1cs", "receipt.pk", "receipt.vk", "ReceiptVerifier.sol"]) {
        artifacts[file] = write(
          file === "ReceiptVerifier.sol"
            ? `contracts/${spec.contractName}.sol`
            : `frontend/public/zk/receive/${kind}/${file}`,
          `${kind}/${file}`,
        );
      }
      const manifestSha256 = json(`frontend/public/zk/receive/${kind}/manifest.json`, {
        kind,
        circuitVersion: RECEIVE_CIRCUIT_VERSION,
        issuerVkSha256,
        publicSignals: spec.publicSignals,
        constraints: 23,
        productionCeremony: false,
        setup: "insecure-local-development",
        artifacts,
        sourceFiles: summary.sourceFiles,
        runtimeArtifacts: {
          "receive-prover.wasm": summary.runtime.wasmSha256,
          "wasm_exec.js": summary.runtime.wasmExecSha256,
        },
      });
      summary.kinds[kind] = {
        issuerVkSha256,
        publicSignals: spec.publicSignals,
        constraints: 23,
        contractName: spec.contractName,
        artifacts,
        manifestSha256,
      };
    }
    json(RECEIVE_DEVELOPMENT_MANIFEST, summary);
  });
  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("checks all presentation kinds and their fixed issuer, runtime, and Solidity pins", function () {
    const result = inspectReceiveArtifacts({ root });
    assert.equal(result.status, "development");
    assert.equal(result.circuitCount, 3);
    assert.equal(
      result.manifestSha256,
      receiveArtifactSha256(path.join(root, RECEIVE_DEVELOPMENT_MANIFEST)),
    );
  });

  for (const [file, pattern] of [
    [
      "frontend/public/zk/receive/receive-prover.wasm",
      /Receive receive-prover.wasm SHA-256 mismatch/u,
    ],
    ["frontend/public/zk/receive/fund/receipt.pk", /fund receive receipt.pk SHA-256 mismatch/u],
    [
      "contracts/AttachedReceivePresentationVerifier.sol",
      /attachment receive ReceiptVerifier.sol SHA-256 mismatch/u,
    ],
    [
      "frontend/public/zk/shielded/shielded_anonymous_receive_credential.vkey.json",
      /fixed issuer key SHA-256 mismatch/u,
    ],
  ]) {
    it(`rejects changed bytes in ${file}`, function () {
      write(file, "changed");
      assert.throws(() => inspectReceiveArtifacts({ root }), pattern);
    });
  }

  for (const file of ["main.go", "go.mod", "poseidon-constants.json"]) {
    it(`rejects stale presentation sources after ${file} changes`, function () {
      write(`packages/receive-prover/${file}`, "changed");
      assert.throws(() => inspectReceiveArtifacts({ root }), /Receive presentation stale source/u);
    });
  }

  it("rejects a new Go source omitted by the recorded source catalog", function () {
    write("packages/receive-prover/new_circuit.go", "new statement");
    assert.throws(
      () => inspectReceiveArtifacts({ root }),
      /Receive presentation source catalog mismatch/u,
    );
  });
  it("rejects a changed browser loader even when proving keys have not changed", function () {
    write("packages/receive-prover/browser.mjs", "changed loader");
    assert.throws(() => inspectReceiveArtifacts({ root }), /Receive loader stale source/u);
  });
  it("rejects an incomplete circuit set", function () {
    delete summary.kinds.attachment;
    json(RECEIVE_DEVELOPMENT_MANIFEST, summary);
    assert.throws(() => inspectReceiveArtifacts({ root }), /exactly all three/u);
  });
  it("rejects a relabelled production key and wrong public layout despite an updated manifest digest", function () {
    rewriteKind("fund", (item) => {
      item.productionCeremony = true;
    });
    assert.throws(
      () => inspectReceiveArtifacts({ root }),
      /does not match its pinned development circuit/u,
    );
    rewriteKind("fund", (item) => {
      item.productionCeremony = false;
      item.publicSignals = 12;
    });
    assert.throws(
      () => inspectReceiveArtifacts({ root }),
      /does not match its pinned development circuit/u,
    );
  });
  it("requires each circuit's setup to use the same source snapshot as the runtime", function () {
    rewriteKind("attachment", (item) => {
      item.sourceFiles["main.go"] = "a".repeat(64);
    });
    assert.throws(
      () => inspectReceiveArtifacts({ root }),
      /attachment receive circuit stale source/u,
    );
  });
  it("rejects presentation production release without complete ceremony evidence", function () {
    assert.throws(
      () => inspectReceiveArtifacts({ root, requireProduction: true }),
      /production manifest not found/u,
    );
    json(RECEIVE_PRODUCTION_MANIFEST, {});
    assert.throws(() => inspectReceiveArtifacts({ root }), /must explicitly identify/u);
  });
  it("protects production presentation issuer keys before any development setup mutation", async function () {
    json(RECEIVE_PRODUCTION_MANIFEST, {});
    let mutations = 0;
    await assert.rejects(
      runZkDevelopmentSetup({
        root,
        manifestGuard() {},
        ptauInstaller() {
          mutations++;
        },
      }),
      /production presentation artifacts exist/u,
    );
    assert.equal(mutations, 0);
  });
  it("inspects complete production public evidence separately from mathematical ceremony verification", function () {
    productionFixture();
    const result = inspectReceiveArtifacts({ root, requireProduction: true });
    assert.equal(result.status, "production");
    assert.equal(result.circuitCount, 3);
  });
  it("rejects merely relabelling development keys without production contribution records", function () {
    Object.assign(summary, {
      schema: "deepfamily/receive-production-keys@1",
      developmentOnly: false,
      productionReady: true,
    });
    json(RECEIVE_PRODUCTION_MANIFEST, summary);
    assert.throws(
      () => inspectReceiveArtifacts({ root, requireProduction: true }),
      /ceremony identity or trust model/u,
    );
  });
  it("rejects changed public contributions even though proving files remain unchanged", function () {
    productionFixture();
    write("release-evidence/receive/fund/phase2.contribution", "changed contribution");
    assert.throws(
      () => inspectReceiveArtifacts({ root }),
      /phase2 public contribution SHA-256 mismatch/u,
    );
  });
  it("rejects a ceremony bound to a different compiled statement despite an updated record digest", function () {
    productionFixture();
    const entry = summary.kinds.attachment;
    const ceremony = read(entry.ceremony.path);
    ceremony.r1csSha256 = "d".repeat(64);
    entry.ceremony.sha256 = json(entry.ceremony.path, ceremony);
    json(RECEIVE_PRODUCTION_MANIFEST, summary);
    assert.throws(() => inspectReceiveArtifacts({ root }), /public ceremony binding mismatch/u);
  });
  it("rejects stale or changed native/WASM builds before circuit setup or synchronization", function () {
    const outDir = path.join(root, "zk-artifacts/receive");
    const native = process.platform === "win32" ? "receive-prover.exe" : "receive-prover";
    const artifacts = Object.fromEntries(
      [native, "receive-prover.wasm", "wasm_exec.js"].map((name) => [
        name,
        write(`zk-artifacts/receive/${name}`, name),
      ]),
    );
    json(`zk-artifacts/receive/${RECEIVE_BUILD_MANIFEST}`, {
      schema: "deepfamily/receive-prover-build@1",
      sourceFiles: summary.sourceFiles,
      artifacts,
    });
    assert.deepEqual(readReceiveBuildSnapshot({ root, outDir }).artifacts, artifacts);
    write(`zk-artifacts/receive/${native}`, "different executable");
    assert.throws(
      () => readReceiveBuildSnapshot({ root, outDir }),
      /Receive build artifact mismatch/u,
    );
    write(`zk-artifacts/receive/${native}`, native);
    write("packages/receive-prover/main.go", "different circuit");
    assert.throws(() => readReceiveBuildSnapshot({ root, outDir }), /Receive build stale source/u);
  });
});
