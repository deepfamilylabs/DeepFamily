import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_CEREMONY_TRANSCRIPT_PATH,
  ZK_PRODUCTION_PHASE1,
  ZK_TRUST_MODEL_SINGLE_OPERATOR,
} from "../scripts/lib/zkArtifactTrust.mjs";
import { resolveSnarkjsCliPath } from "../scripts/lib/snarkjsToolchain.mjs";
import {
  DEVELOPMENT_CIRCUITS,
  DEVELOPMENT_CONTRIBUTOR_NAME,
  DEVELOPMENT_PUBLIC_ENTROPY,
  buildDevelopmentSetupCommands,
  runZkDevelopmentRefresh,
} from "../scripts/zk-dev-refresh.mjs";

const fakePtau = (root) => ({
  status: "already-cached",
  path: path.join(root, "tmp/zk-production/powersOfTau28_hez_final_13.ptau"),
  bytes: 9_520_280,
  sha256: "95".repeat(32),
  blake2b512: "58".repeat(64),
  source: "https://example.invalid/pinned.ptau",
});

describe("development ZK refresh", function () {
  it("rejects a valid production manifest without changing the fixture tree", async function () {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-zk-production-guard-"));
    const manifestPath = path.join(root, ZK_ARTIFACT_MANIFEST_PATH);
    const artifactHashes = Object.fromEntries(
      DEVELOPMENT_CIRCUITS.map((circuit, index) => [
        circuit.name,
        {
          sourceSha256: `${index + 1}`.repeat(64),
          r1csSha256: `${index + 2}`.repeat(64),
          wasmSha256: `${index + 3}`.repeat(64),
          zkeySha256: `${index + 4}`.repeat(64),
          verificationKeySha256: `${index + 5}`.repeat(64),
          solidityVerifierSha256: `${index + 6}`.repeat(64),
        },
      ]),
    );
    const manifest = {
      schemaVersion: 3,
      circomVersion: "2.2.3",
      snarkjsVersion: "0.7.5",
      toolchain: {
        circomBinarySha256: "a".repeat(64),
        snarkjsCliSha256: "b".repeat(64),
        snarkjsRuntimeSha256: "9".repeat(64),
      },
      trustedSetup: {
        status: "production",
        trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
        warning: "Single operator must destroy every circuit-specific Phase 2 secret.",
        ceremonyId: "deepfamily-production-fixture",
        minimumContributors: 1,
        contributorCount: 1,
        phase1: { ...ZK_PRODUCTION_PHASE1, verified: true },
        transcript: {
          path: ZK_CEREMONY_TRANSCRIPT_PATH,
          sha256: "c".repeat(64),
        },
        beacon: {
          applied: true,
          name: "development-guard-fixture",
          hash: "d".repeat(64),
          numIterationsExp: 10,
          source: "fixture-public-randomness",
          personCommitmentContributionHash: "e".repeat(128),
          disclosureBindingContributionHash: "f".repeat(128),
        },
      },
      circuits: artifactHashes,
    };
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    const original = `${JSON.stringify(manifest, null, 2)}\n`;
    await fs.writeFile(manifestPath, original);
    const entriesBefore = await fs.readdir(root, { recursive: true });
    let mutationCalls = 0;

    try {
      let caught;
      try {
        await runZkDevelopmentRefresh({
          root,
          ptauInstaller: async () => {
            mutationCalls += 1;
          },
          temporaryDirectoryFactory: () => {
            mutationCalls += 1;
          },
          commandRunner: async () => {
            mutationCalls += 1;
          },
          assetSynchronizer: async () => {
            mutationCalls += 1;
          },
          manifestUpdater: () => {
            mutationCalls += 1;
          },
        });
      } catch (error) {
        caught = error;
      }

      expect(caught?.message).to.equal(
        "Refusing to rewrite a production ceremony manifest with development artifact hashes",
      );
      expect(mutationCalls).to.equal(0);
      expect(await fs.readFile(manifestPath, "utf8")).to.equal(original);
      expect(await fs.readdir(root, { recursive: true })).to.deep.equal(entriesBefore);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails the manifest guard before invoking any mutation-capable dependency", async function () {
    const calls = [];
    const productionError = new Error(
      "Refusing to rewrite a production ceremony manifest with development artifact hashes",
    );

    let caught;
    try {
      await runZkDevelopmentRefresh({
        root: "/tmp/deepfamily-production-guard-fixture",
        manifestGuard: () => {
          calls.push("guard");
          throw productionError;
        },
        ptauInstaller: async () => {
          calls.push("ptau");
        },
        temporaryDirectoryFactory: () => {
          calls.push("temporary-directory");
        },
        commandRunner: async () => {
          calls.push("command");
        },
        assetSynchronizer: async () => {
          calls.push("sync");
        },
        manifestUpdater: () => {
          calls.push("manifest-update");
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.equal(productionError);
    expect(calls).to.deep.equal(["guard"]);
  });

  it("uses the pinned pTau before rebuilding keys, then syncs, updates and proves", async function () {
    const root = path.resolve("/tmp/deepfamily-development-refresh-fixture");
    const temporaryDirectory = path.join(root, "temporary");
    const calls = [];
    const ptau = fakePtau(root);
    const output = {
      log: (message) => calls.push(["log", message]),
      warn: (message) => calls.push(["warn", message]),
      error: (message) => calls.push(["error", message]),
    };
    const manifestEvidence = { manifestSha256: "ab".repeat(32) };

    const result = await runZkDevelopmentRefresh({
      root,
      output,
      manifestGuard: ({ root: guardedRoot }) => calls.push(["guard", guardedRoot]),
      ptauInstaller: async ({ root: installedRoot }) => {
        calls.push(["ptau", installedRoot]);
        return ptau;
      },
      temporaryDirectoryFactory: () => {
        calls.push(["temporary-directory", temporaryDirectory]);
        return temporaryDirectory;
      },
      temporaryDirectoryRemover: (directory) => calls.push(["remove", directory]),
      commandRunner: async (command) => calls.push(["command", command]),
      assetSynchronizer: async (options) => {
        calls.push(["sync", options]);
        return { exitCode: 0, failedFiles: [] };
      },
      manifestUpdater: ({ root: updatedRoot }) => {
        calls.push(["manifest-update", updatedRoot]);
        return manifestEvidence;
      },
    });

    expect(result).to.deep.include({ status: "passed", manifestEvidence });
    expect(calls[0]).to.deep.equal(["guard", root]);
    expect(calls[1]).to.deep.equal(["ptau", root]);
    expect(calls[2][0]).to.equal("log");
    expect(calls[3]).to.deep.equal(["temporary-directory", temporaryDirectory]);

    const commandCalls = calls.filter(([kind]) => kind === "command");
    expect(commandCalls).to.have.length(2 + DEVELOPMENT_CIRCUITS.length * 5);
    expect(commandCalls[0][1]).to.deep.equal({
      executable: process.execPath,
      args: [path.join(root, "scripts/zk-build.mjs")],
      cwd: root,
    });
    expect(commandCalls.at(-1)[1]).to.deep.equal({
      executable: process.execPath,
      args: [path.join(root, "scripts/zk-check.mjs")],
      cwd: root,
    });

    const syncIndex = calls.findIndex(([kind]) => kind === "sync");
    const manifestIndex = calls.findIndex(([kind]) => kind === "manifest-update");
    const proofIndex = calls.lastIndexOf(commandCalls.at(-1));
    const cleanupIndex = calls.findIndex(([kind]) => kind === "remove");
    expect(syncIndex).to.be.greaterThan(calls.indexOf(commandCalls.at(-2)));
    expect(manifestIndex).to.be.greaterThan(syncIndex);
    expect(proofIndex).to.be.greaterThan(manifestIndex);
    expect(cleanupIndex).to.be.greaterThan(proofIndex);
  });

  it("builds one fixed-entropy development Phase 2 sequence per circuit", function () {
    const root = path.resolve("/tmp/deepfamily-development-commands");
    const temporaryDirectory = path.join(root, "temporary");
    const ptauPath = path.join(root, "pinned.ptau");

    const commands = buildDevelopmentSetupCommands({
      root,
      ptauPath,
      temporaryDirectory,
    });

    expect(commands).to.have.length(DEVELOPMENT_CIRCUITS.length * 5);
    const snarkjsCli = resolveSnarkjsCliPath({ root });
    for (let index = 0; index < DEVELOPMENT_CIRCUITS.length; index += 1) {
      const circuit = DEVELOPMENT_CIRCUITS[index];
      const [setup, contribute, exportVkey, exportVerifier, renameVerifier] = commands.slice(
        index * 5,
        index * 5 + 5,
      );
      for (const command of [setup, contribute, exportVkey, exportVerifier]) {
        expect(command.executable).to.equal(process.execPath);
        expect(command.args[0]).to.equal(snarkjsCli);
        expect(command.cwd).to.equal(root);
      }
      expect(setup.args.slice(1)).to.deep.equal([
        "groth16",
        "setup",
        path.join(root, "zk-artifacts/circuits", `${circuit.name}.r1cs`),
        ptauPath,
        path.join(temporaryDirectory, `${circuit.name}_0000.zkey`),
      ]);
      expect(contribute.args).to.include(`--name=${DEVELOPMENT_CONTRIBUTOR_NAME}`);
      expect(contribute.args).to.include(`-e=${DEVELOPMENT_PUBLIC_ENTROPY}`);
      expect(exportVkey.args.slice(1, 4)).to.deep.equal(["zkey", "export", "verificationkey"]);
      expect(exportVerifier.args.slice(1, 4)).to.deep.equal(["zkey", "export", "solidityverifier"]);
      expect(renameVerifier.executable).to.equal(process.execPath);
      expect(renameVerifier.args.at(-1)).to.equal(circuit.verifierContractName);
    }
  });

  it("propagates strict synchronization failure and still removes temporary secrets", async function () {
    const root = path.resolve("/tmp/deepfamily-development-sync-failure");
    const calls = [];
    let caught;
    try {
      await runZkDevelopmentRefresh({
        root,
        output: { log: () => {}, warn: () => {}, error: () => {} },
        manifestGuard: () => {},
        ptauInstaller: async () => fakePtau(root),
        temporaryDirectoryFactory: () => "/tmp/deepfamily-development-secret-fixture",
        temporaryDirectoryRemover: (directory) => calls.push(["remove", directory]),
        commandRunner: async () => calls.push(["command"]),
        assetSynchronizer: async () => ({ exitCode: 1, failedFiles: ["missing-vkey"] }),
        manifestUpdater: () => calls.push(["manifest-update"]),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught?.message).to.equal("ZK frontend artifact synchronization failed");
    expect(calls).to.not.deep.include(["manifest-update"]);
    expect(calls.at(-1)).to.deep.equal(["remove", "/tmp/deepfamily-development-secret-fixture"]);
  });
});
