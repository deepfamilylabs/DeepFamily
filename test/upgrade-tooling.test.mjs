import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import {
  deployIntegratedSystem,
  ensureIntegratedSystem,
} from "../hardhat/integratedDeployment.mjs";
import {
  assertImplementationStorageSafe,
  assertImplementationMatchesArtifact,
  deriveSalt,
  sendOrPrint,
} from "../tasks/lib/timelockUpgrade.mjs";

// Covers the upgrade-tooling layer that the contract-level UUPS tests
// (test/contract-upgradeability.test.mjs) do not reach: the storage / bytecode safety gates
// used by `upgrade-schedule`, the deterministic salt shared by schedule/execute, the timelock
// role dual-mode, and the GOVERNANCE_OWNER deploy-handover path in integratedDeployment.mjs.
describe("Upgrade tooling & governance deploy path", function () {
  this.timeout(120_000);

  describe("storage-layout safety gate (assertImplementationStorageSafe)", function () {
    it("accepts a storage-safe append-only implementation", async () => {
      // Must not throw: V2Mock appends after the existing variables (committed baseline).
      await assertImplementationStorageSafe(hre, "DeepFamily", "DeepFamilyV2Mock");
    });

    it("rejects a storage-incompatible implementation", async () => {
      let err;
      try {
        await assertImplementationStorageSafe(hre, "DeepFamily", "UnsafeUpgradeMock");
      } catch (e) {
        err = e;
      }
      expect(err, "expected a storage-safety abort").to.be.an("error");
      expect(err.message).to.match(/would break .* storage layout/i);
    });
  });

  describe("deterministic upgrade salt (deriveSalt)", function () {
    it("is deterministic and case-insensitive on the implementation address", async () => {
      const a = deriveSalt(hre.ethers, {
        target: "main",
        implementation: "0xABCDEF0000000000000000000000000000000001",
        initData: "0x",
      });
      const b = deriveSalt(hre.ethers, {
        target: "main",
        implementation: "0xabcdef0000000000000000000000000000000001",
        initData: "0x",
      });
      expect(a).to.equal(b);
    });

    it("differs by target / initData and honors an explicit override", async () => {
      const impl = "0x0000000000000000000000000000000000000001";
      const main = deriveSalt(hre.ethers, { target: "main", implementation: impl, initData: "0x" });
      const registry = deriveSalt(hre.ethers, {
        target: "registry",
        implementation: impl,
        initData: "0x",
      });
      const withInit = deriveSalt(hre.ethers, {
        target: "main",
        implementation: impl,
        initData: "0x1234",
      });
      expect(main).to.not.equal(registry);
      expect(main).to.not.equal(withInit);

      const override = hre.ethers.id("custom-salt");
      expect(
        deriveSalt(hre.ethers, { target: "main", implementation: impl, initData: "0x", override }),
      ).to.equal(override);
    });
  });

  describe("on-chain bytecode match gate (assertImplementationMatchesArtifact)", function () {
    // Use the registry (needsLibraries: false) so the check does not depend on recorded
    // library deployment files.
    it("accepts an address hosting the claimed artifact bytecode", async () => {
      const impl = await (
        await hre.ethers.getContractFactory("DeepFamilyAttestationRegistry")
      ).deploy();
      await impl.waitForDeployment();
      await assertImplementationMatchesArtifact({
        connection: undefined,
        ethers: hre.ethers,
        hre,
        contractName: "DeepFamilyAttestationRegistry",
        implementation: await impl.getAddress(),
        spec: { needsLibraries: false },
      });
    });

    it("rejects an address whose bytecode does not match the artifact", async () => {
      const wrong = await (await hre.ethers.getContractFactory("DeepFamilyToken")).deploy();
      await wrong.waitForDeployment();
      let err;
      try {
        await assertImplementationMatchesArtifact({
          connection: undefined,
          ethers: hre.ethers,
          hre,
          contractName: "DeepFamilyAttestationRegistry",
          implementation: await wrong.getAddress(),
          spec: { needsLibraries: false },
        });
      } catch (e) {
        err = e;
      }
      expect(err, "expected a bytecode mismatch").to.be.an("error");
      expect(err.message).to.match(/does NOT match/i);
    });

    it("accepts a deployed Solidity library after linking its self-address guard", async () => {
      const library = await (await hre.ethers.getContractFactory("PoseidonT5")).deploy();
      await library.waitForDeployment();

      await assertImplementationMatchesArtifact({
        connection: undefined,
        ethers: hre.ethers,
        hre,
        contractName: "PoseidonT5",
        implementation: await library.getAddress(),
        spec: { needsLibraries: false, librarySelfAddress: true },
      });
    });
  });

  describe("timelock role dual-mode (sendOrPrint)", function () {
    const deployTimelock = async (roleHolder) => {
      const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
      const tl = await Timelock.deploy(3600, [roleHolder], [roleHolder], hre.ethers.ZeroAddress);
      await tl.waitForDeployment();
      return tl;
    };

    it("sends directly when the signer holds the role", async () => {
      const [deployer] = await hre.ethers.getSigners();
      const tl = await deployTimelock(await deployer.getAddress());
      const res = await sendOrPrint({
        timelock: tl,
        timelockAddress: await tl.getAddress(),
        signer: deployer,
        role: await tl.PROPOSER_ROLE(),
        method: "schedule",
        callArgs: [
          hre.ethers.ZeroAddress,
          0,
          "0x",
          hre.ethers.ZeroHash,
          hre.ethers.id("salt-send"),
          3600,
        ],
      });
      expect(res.sent).to.equal(true);
      expect(res.txHash).to.be.a("string");
    });

    it("prints calldata for the multisig when the signer lacks the role", async () => {
      const [deployer, outsider] = await hre.ethers.getSigners();
      const tl = await deployTimelock(await deployer.getAddress());
      const res = await sendOrPrint({
        timelock: tl,
        timelockAddress: await tl.getAddress(),
        signer: outsider,
        role: await tl.PROPOSER_ROLE(),
        method: "schedule",
        callArgs: [
          hre.ethers.ZeroAddress,
          0,
          "0x",
          hre.ethers.ZeroHash,
          hre.ethers.id("salt-print"),
          3600,
        ],
      });
      expect(res.sent).to.equal(false);
      expect(res.calldata).to.match(/^0x[0-9a-fA-F]+$/);
    });
  });

  describe("GOVERNANCE_OWNER deploy handover (live-network path)", function () {
    const ENV = "GOVERNANCE_OWNER";
    let original;
    beforeEach(() => {
      original = process.env[ENV];
    });
    afterEach(() => {
      if (original === undefined) delete process.env[ENV];
      else process.env[ENV] = original;
    });

    // deployIntegratedSystem exempts local/simulated networks from the governance-owner
    // requirement; fake a live networkConfig so the requirement and the ownership handover run.
    const fakeLiveConnection = () => ({
      ethers: hre.ethers,
      networkConfig: { type: "http", chainId: 11155111 },
    });

    it("hands ownership of both proxies and the token to the governance timelock", async () => {
      const [deployer, member] = await hre.ethers.getSigners();
      const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
      const tl = await Timelock.deploy(
        3600,
        [await member.getAddress()],
        [await member.getAddress()],
        hre.ethers.ZeroAddress,
      );
      await tl.waitForDeployment();
      const tlAddr = await tl.getAddress();

      process.env[ENV] = tlAddr;
      const deployed = await deployIntegratedSystem(fakeLiveConnection(), {
        writeDeployments: false,
        signer: deployer,
      });

      expect(await deployed.deepFamily.owner()).to.equal(tlAddr);
      expect(await deployed.deepFamilyAttestationRegistry.owner()).to.equal(tlAddr);
      expect(await deployed.token.owner()).to.equal(tlAddr);
    });

    it("refuses to deploy without GOVERNANCE_OWNER on a live network", async () => {
      delete process.env[ENV];
      const [deployer] = await hre.ethers.getSigners();
      let err;
      try {
        await deployIntegratedSystem(fakeLiveConnection(), {
          writeDeployments: false,
          signer: deployer,
        });
      } catch (e) {
        err = e;
      }
      expect(err, "expected a missing-governance-owner abort").to.be.an("error");
      expect(err.message).to.match(/GOVERNANCE_OWNER must be set/);
    });

    it("refuses an EOA (codeless) governance owner", async () => {
      const [deployer, eoa] = await hre.ethers.getSigners();
      process.env[ENV] = await eoa.getAddress();
      let err;
      try {
        await deployIntegratedSystem(fakeLiveConnection(), {
          writeDeployments: false,
          signer: deployer,
        });
      } catch (e) {
        err = e;
      }
      expect(err, "expected an EOA-owner abort").to.be.an("error");
      expect(err.message).to.match(/no code|EOA/i);
    });
  });

  describe("deployment reuse guards", function () {
    it("refuses an implicit first deployment from an operational live-network path", async () => {
      const originalCwd = process.cwd();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-empty-live-"));

      try {
        process.chdir(tmpDir);
        let err;
        try {
          await ensureIntegratedSystem({
            ethers: hre.ethers,
            networkName: "sepolia",
            networkConfig: { type: "http", chainId: 11155111 },
          });
        } catch (error) {
          err = error;
        }

        expect(err, "expected an implicit live deployment to abort").to.be.an("error");
        expect(err.message).to.match(/no deployment metadata.*operational task/i);
      } finally {
        process.chdir(originalCwd);
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("requires an explicitly allowed first live deployment to persist current artifacts", async () => {
      const originalCwd = process.cwd();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-unwritten-live-"));

      try {
        process.chdir(tmpDir);
        let err;
        try {
          await ensureIntegratedSystem(
            {
              ethers: hre.ethers,
              networkName: "sepolia",
              networkConfig: { type: "http", chainId: 11155111 },
            },
            { allowNewDeployment: true, artifacts: hre.artifacts },
          );
        } catch (error) {
          err = error;
        }

        expect(err, "expected an unpersisted live deployment to abort").to.be.an("error");
        expect(err.message).to.match(/must persist.*artifact metadata/i);
      } finally {
        process.chdir(originalCwd);
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("refuses partial deployment metadata on a live network", async () => {
      const originalCwd = process.cwd();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-partial-live-"));
      const deploymentsDir = path.join(tmpDir, "deployments", "sepolia");
      await fs.mkdir(deploymentsDir, { recursive: true });
      await fs.writeFile(
        path.join(deploymentsDir, "DeepFamily.json"),
        JSON.stringify({ address: "0x000000000000000000000000000000000000dEaD", abi: [] }),
      );

      try {
        process.chdir(tmpDir);
        let err;
        try {
          await ensureIntegratedSystem({
            ethers: hre.ethers,
            networkName: "sepolia",
            networkConfig: { type: "http", chainId: 11155111 },
          });
        } catch (error) {
          err = error;
        }

        expect(err, "expected partial live metadata to abort").to.be.an("error");
        expect(err.message).to.match(/metadata is partial/i);
      } finally {
        process.chdir(originalCwd);
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("reuses a deployment only when the complete artifact and verifier set matches", async () => {
      const originalCwd = process.cwd();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-coherent-localhost-"));
      const connection = {
        ethers: hre.ethers,
        networkName: "localhost",
        networkConfig: { type: "http", chainId: 31337 },
      };

      try {
        process.chdir(tmpDir);
        const deployed = await deployIntegratedSystem(connection, {
          writeDeployments: true,
          artifacts: hre.artifacts,
        });
        const originalAddress = await deployed.deepFamily.getAddress();

        const reused = await ensureIntegratedSystem(connection, {
          writeDeployments: true,
          artifacts: hre.artifacts,
        });

        expect(await reused.deepFamily.getAddress()).to.equal(originalAddress);
      } finally {
        process.chdir(originalCwd);
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("redeploys and persists a coherent localhost set after verifier metadata mismatch", async () => {
      const originalCwd = process.cwd();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-mixed-localhost-"));
      const connection = {
        ethers: hre.ethers,
        networkName: "localhost",
        networkConfig: { type: "http", chainId: 31337 },
      };

      try {
        process.chdir(tmpDir);
        const deployed = await deployIntegratedSystem(connection, {
          writeDeployments: true,
          artifacts: hre.artifacts,
        });
        const originalAddress = await deployed.deepFamily.getAddress();
        const tokenAddress = await deployed.token.getAddress();
        const personVerifierPath = path.join(
          tmpDir,
          "deployments",
          "localhost",
          "PersonCommitmentVerifier.json",
        );
        const personVerifierDeployment = JSON.parse(await fs.readFile(personVerifierPath, "utf8"));
        personVerifierDeployment.address = tokenAddress;
        await fs.writeFile(personVerifierPath, JSON.stringify(personVerifierDeployment, null, 2));

        const redeployed = await ensureIntegratedSystem(connection, {
          artifacts: hre.artifacts,
        });
        const redeployedAddress = await redeployed.deepFamily.getAddress();

        expect(redeployedAddress).to.not.equal(originalAddress);

        const deepFamilyDeploymentPath = path.join(
          tmpDir,
          "deployments",
          "localhost",
          "DeepFamily.json",
        );
        const persistedDeepFamily = JSON.parse(await fs.readFile(deepFamilyDeploymentPath, "utf8"));
        expect(persistedDeepFamily.address).to.equal(redeployedAddress);

        const nextTaskConnection = {
          ethers: hre.ethers,
          networkName: "localhost",
          networkConfig: { type: "http", chainId: 31337 },
        };
        const reused = await ensureIntegratedSystem(nextTaskConnection, {
          artifacts: hre.artifacts,
        });
        expect(await reused.deepFamily.getAddress()).to.equal(redeployedAddress);
      } finally {
        process.chdir(originalCwd);
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("redeploys when localhost deployment files point at an empty restarted chain", async () => {
      const originalCwd = process.cwd();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-stale-localhost-"));
      const deploymentsDir = path.join(tmpDir, "deployments", "localhost");
      await fs.mkdir(deploymentsDir, { recursive: true });

      const staleAddress = "0x000000000000000000000000000000000000dEaD";
      for (const contractName of [
        "DeepFamily",
        "DeepFamilyToken",
        "DeepFamilyAttestationRegistry",
        "DeepFamilyReader",
      ]) {
        await fs.writeFile(
          path.join(deploymentsDir, `${contractName}.json`),
          JSON.stringify({ address: staleAddress, abi: [] }, null, 2),
        );
      }

      try {
        process.chdir(tmpDir);
        const deployed = await ensureIntegratedSystem({
          ethers: hre.ethers,
          networkName: "localhost",
          networkConfig: { type: "http", chainId: 31337 },
        });
        const deepFamilyAddress = await deployed.deepFamily.getAddress();

        expect(deepFamilyAddress).to.not.equal(staleAddress);
        expect(await hre.ethers.provider.getCode(deepFamilyAddress)).to.not.equal("0x");
      } finally {
        process.chdir(originalCwd);
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
