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
import {
  buildImplementationVerificationCommand,
  candidateVerificationGuidance,
  explorerApiKeyForNetwork,
  selectedHardhatNetwork,
} from "../tasks/lib/explorerVerification.mjs";

// Covers the upgrade-tooling layer that the contract-level UUPS tests
// (test/contract-upgradeability.test.mjs) do not reach: the storage / bytecode safety gates
// used by `upgrade-schedule`, the deterministic salt shared by schedule/execute, the timelock
// role dual-mode, and the GOVERNANCE_OWNER deploy-handover path in integratedDeployment.mjs.
describe("Upgrade tooling & governance deploy path", function () {
  this.timeout(120_000);

  describe("candidate source-verification guidance", function () {
    const implementation = "0x1234567890abcdef1234567890abcdef12345678";

    it("uses the ConfluxScan placeholder only for eSpace networks", function () {
      expect(explorerApiKeyForNetwork("confluxTestnet", "")).to.equal("espace");
      expect(explorerApiKeyForNetwork("conflux", "")).to.equal("espace");
      expect(explorerApiKeyForNetwork("sepolia", "")).to.equal("");
      expect(explorerApiKeyForNetwork("mainnet", "")).to.equal("");
      expect(explorerApiKeyForNetwork("sepolia", "espace")).to.equal("");
      expect(explorerApiKeyForNetwork("conflux", "  configured-key  ")).to.equal("configured-key");
    });

    it("recognizes both Hardhat network argument forms", function () {
      expect(
        selectedHardhatNetwork(["node", "hardhat", "verify", "--network", "conflux"]),
      ).to.equal("conflux");
      expect(
        selectedHardhatNetwork(["node", "hardhat", "verify", "--network=confluxTestnet"]),
      ).to.equal("confluxTestnet");
    });

    it("prints an exact current-network, fully-qualified verification command", function () {
      expect(
        buildImplementationVerificationCommand({
          networkName: "confluxTestnet",
          sourceName: "contracts/DeepFamilyV2.sol",
          contractName: "DeepFamilyV2",
          implementation,
        }),
      ).to.equal(
        "npx hardhat --config hardhat.config.mjs --build-profile default verify " +
          "--network confluxTestnet --contract contracts/DeepFamilyV2.sol:DeepFamilyV2 " +
          implementation,
      );
    });

    it("stops a freshly deployed candidate before scheduling and explains the two-step flow", function () {
      const guidance = candidateVerificationGuidance({
        networkName: "conflux",
        sourceName: "contracts/DeepFamilyV2.sol",
        contractName: "DeepFamilyV2",
        implementation,
        freshlyDeployed: true,
      });
      const output = guidance.lines.join("\n");

      expect(guidance.stopBeforeScheduling).to.equal(true);
      expect(output).to.include("--network conflux");
      expect(output).to.include("ConfluxScan");
      expect(output).to.include('fallback "espace"');
      expect(output).to.match(/no Timelock operation was scheduled/i);
      expect(output).to.match(/rerun upgrade-schedule.*--implementation/i);
    });

    it("requires a real Etherscan key and verification before multisig submission", function () {
      const guidance = candidateVerificationGuidance({
        networkName: "sepolia",
        sourceName: "contracts/DeepFamilyV2.sol",
        contractName: "DeepFamilyV2",
        implementation,
        freshlyDeployed: false,
      });
      const output = guidance.lines.join("\n");

      expect(guidance.stopBeforeScheduling).to.equal(false);
      expect(output).to.include("--network sepolia");
      expect(output).to.match(/real Etherscan API key/i);
      expect(output).to.match(/before submitting.*schedule.*governance multisig/i);
      expect(output).to.match(/does not contact the explorer/i);
    });
  });

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

    it("differs by initData and honors an explicit override", async () => {
      const impl = "0x0000000000000000000000000000000000000001";
      const main = deriveSalt(hre.ethers, { target: "main", implementation: impl, initData: "0x" });
      const withInit = deriveSalt(hre.ethers, {
        target: "main",
        implementation: impl,
        initData: "0x1234",
      });
      expect(main).to.not.equal(withInit);

      const override = hre.ethers.id("custom-salt");
      expect(
        deriveSalt(hre.ethers, { target: "main", implementation: impl, initData: "0x", override }),
      ).to.equal(override);
    });
  });

  describe("on-chain bytecode match gate (assertImplementationMatchesArtifact)", function () {
    // Use the token (needsLibraries: false) so the check does not depend on recorded
    // library deployment files.
    it("accepts an address hosting the claimed artifact bytecode", async () => {
      const impl = await (await hre.ethers.getContractFactory("DeepFamilyToken")).deploy();
      await impl.waitForDeployment();
      await assertImplementationMatchesArtifact({
        connection: undefined,
        ethers: hre.ethers,
        hre,
        contractName: "DeepFamilyToken",
        implementation: await impl.getAddress(),
        spec: { needsLibraries: false },
      });
    });

    it("rejects an address whose bytecode does not match the artifact", async () => {
      const wrong = await (await hre.ethers.getContractFactory("AdultAgeGate")).deploy();
      await wrong.waitForDeployment();
      let err;
      try {
        await assertImplementationMatchesArtifact({
          connection: undefined,
          ethers: hre.ethers,
          hre,
          contractName: "DeepFamilyToken",
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
      const tl = await Timelock.deploy(3600, roleHolder);
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

    it("prints multisig calldata when no local signer is configured", async () => {
      const [deployer] = await hre.ethers.getSigners();
      const tl = await deployTimelock(await deployer.getAddress());
      const res = await sendOrPrint({
        timelock: tl,
        timelockAddress: await tl.getAddress(),
        signer: undefined,
        role: await tl.PROPOSER_ROLE(),
        method: "schedule",
        callArgs: [
          hre.ethers.ZeroAddress,
          0,
          "0x",
          hre.ethers.ZeroHash,
          hre.ethers.id("salt-no-signer"),
          3600,
        ],
      });
      expect(res.sent).to.equal(false);
      expect(res.calldata).to.match(/^0x[0-9a-fA-F]+$/);
    });
  });

  describe("GOVERNANCE_OWNER deploy handover (live-network path)", function () {
    const OWNER_ENV = "GOVERNANCE_OWNER";
    const MULTISIG_ENV = "GOVERNANCE_MULTISIG";
    let originalOwner;
    let originalMultisig;
    beforeEach(() => {
      originalOwner = process.env[OWNER_ENV];
      originalMultisig = process.env[MULTISIG_ENV];
      delete process.env[OWNER_ENV];
      delete process.env[MULTISIG_ENV];
    });
    afterEach(() => {
      if (originalOwner === undefined) delete process.env[OWNER_ENV];
      else process.env[OWNER_ENV] = originalOwner;
      if (originalMultisig === undefined) delete process.env[MULTISIG_ENV];
      else process.env[MULTISIG_ENV] = originalMultisig;
    });

    // deployIntegratedSystem exempts local/simulated networks from the governance-owner
    // requirement; fake a live networkConfig so the requirement and the ownership handover run.
    const fakeLiveConnection = () => ({
      ethers: hre.ethers,
      artifacts: hre.artifacts,
      networkConfig: { type: "http", chainId: 11155111 },
    });

    it("hands the main proxy to governance and retires the token bootstrap owner", async () => {
      const [deployer, member1, member2] = await hre.ethers.getSigners();
      const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
      const multisig = await Multisig.deploy(
        await member1.getAddress(),
        await member2.getAddress(),
      );
      await multisig.waitForDeployment();
      const multisigAddr = await multisig.getAddress();

      const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
      const tl = await Timelock.deploy(3600, multisigAddr);
      await tl.waitForDeployment();
      const tlAddr = await tl.getAddress();

      process.env[OWNER_ENV] = tlAddr;
      process.env[MULTISIG_ENV] = multisigAddr;
      const deployed = await deployIntegratedSystem(fakeLiveConnection(), {
        writeDeployments: false,
        signer: deployer,
      });

      expect(await deployed.deepFamily.owner()).to.equal(tlAddr);
      expect(await deployed.token.owner()).to.equal(hre.ethers.ZeroAddress);
    });

    it("refuses to deploy without GOVERNANCE_OWNER on a live network", async () => {
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
      process.env[OWNER_ENV] = await eoa.getAddress();
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

    it("refuses a multisig contract as the direct governance owner", async () => {
      const [deployer, member1, member2] = await hre.ethers.getSigners();
      const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
      const multisig = await Multisig.deploy(
        await member1.getAddress(),
        await member2.getAddress(),
      );
      await multisig.waitForDeployment();
      process.env[OWNER_ENV] = await multisig.getAddress();
      process.env[MULTISIG_ENV] = await multisig.getAddress();

      let err;
      try {
        await deployIntegratedSystem(fakeLiveConnection(), {
          writeDeployments: false,
          signer: deployer,
        });
      } catch (e) {
        err = e;
      }

      expect(err, "expected a non-timelock owner abort").to.be.an("error");
      expect(err.message).to.match(/does not behave like a TimelockController/i);
      expect(err.message).to.match(/bytecode does NOT match artifact GovernanceTimelock/i);
      expect(err.message).to.match(/multisig.*proposer\/canceller\/executor.*instead/i);
    });

    it("requires a configured multisig contract for a genuine timelock", async () => {
      const [deployer, member] = await hre.ethers.getSigners();
      const memberAddr = await member.getAddress();
      const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
      const tl = await Timelock.deploy(3600, memberAddr);
      await tl.waitForDeployment();
      process.env[OWNER_ENV] = await tl.getAddress();

      let err;
      try {
        await deployIntegratedSystem(fakeLiveConnection(), {
          writeDeployments: false,
          signer: deployer,
        });
      } catch (e) {
        err = e;
      }

      expect(err, "expected a missing-multisig abort").to.be.an("error");
      expect(err.message).to.match(/GOVERNANCE_MULTISIG must be set/i);
    });

    it("rejects a contract wallet whose reported threshold is below two", async () => {
      const [deployer, owner] = await hre.ethers.getSigners();
      const Wallet = await hre.ethers.getContractFactory("SingleSignerWalletMock");
      const wallet = await Wallet.deploy(await owner.getAddress());
      await wallet.waitForDeployment();
      const walletAddress = await wallet.getAddress();

      const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
      const tl = await Timelock.deploy(3600, walletAddress);
      await tl.waitForDeployment();
      process.env[OWNER_ENV] = await tl.getAddress();
      process.env[MULTISIG_ENV] = walletAddress;

      let err;
      try {
        await deployIntegratedSystem(fakeLiveConnection(), {
          writeDeployments: false,
          signer: deployer,
        });
      } catch (e) {
        err = e;
      }

      expect(err, "expected a single-signer policy abort").to.be.an("error");
      expect(err.message).to.match(/threshold=1.*requires at least 2/i);
    });

    it("rejects a codeless GOVERNANCE_MULTISIG even when that EOA holds timelock roles", async () => {
      const [deployer, roleHolder] = await hre.ethers.getSigners();
      const roleHolderAddr = await roleHolder.getAddress();
      const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
      const tl = await Timelock.deploy(3600, roleHolderAddr);
      await tl.waitForDeployment();
      process.env[OWNER_ENV] = await tl.getAddress();
      process.env[MULTISIG_ENV] = roleHolderAddr;

      let err;
      try {
        await deployIntegratedSystem(fakeLiveConnection(), {
          writeDeployments: false,
          signer: deployer,
        });
      } catch (e) {
        err = e;
      }

      expect(err, "expected a codeless-multisig abort").to.be.an("error");
      expect(err.message).to.match(/GOVERNANCE_MULTISIG .* has no contract code/i);
    });

    it("requires all timelock governance roles to belong to the configured multisig", async () => {
      const [deployer, member1, member2, unrelated] = await hre.ethers.getSigners();
      const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
      const multisig = await Multisig.deploy(
        await member1.getAddress(),
        await member2.getAddress(),
      );
      await multisig.waitForDeployment();
      const multisigAddr = await multisig.getAddress();
      const unrelatedAddr = await unrelated.getAddress();

      const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
      const tl = await Timelock.deploy(3600, unrelatedAddr);
      await tl.waitForDeployment();
      process.env[OWNER_ENV] = await tl.getAddress();
      process.env[MULTISIG_ENV] = multisigAddr;

      let err;
      try {
        await deployIntegratedSystem(fakeLiveConnection(), {
          writeDeployments: false,
          signer: deployer,
        });
      } catch (e) {
        err = e;
      }

      expect(err, "expected a missing-role abort").to.be.an("error");
      expect(err.message).to.match(/missing PROPOSER_ROLE, CANCELLER_ROLE, EXECUTOR_ROLE/i);
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
      for (const contractName of ["DeepFamily", "DeepFamilyToken", "DeepFamilyReader"]) {
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
