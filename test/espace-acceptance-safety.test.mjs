import { expect } from "chai";
import { ethers } from "ethers";
import {
  ACCEPTANCE_MODE_DIAGNOSTIC,
  ACCEPTANCE_MODE_RELEASE_REHEARSAL,
  ESPACE_E2E_RELEASE_SAFE_PROFILE,
  deriveAcceptanceWallet,
  deriveAcceptanceWallets,
  hashRunId,
  parseESpaceAcceptanceConfig,
  pollUntil,
  redactSecrets,
  runIdReportFileComponent,
  safeJsonStringify,
  sanitizeRunId,
  summarizeProductionBuildInfo,
  withTimeout,
} from "../scripts/lib/acceptanceSafety.mjs";

describe("eSpace acceptance safety helpers", function () {
  const basePrivateKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const runId = "acceptance-run-20260721";
  const baseConfig = (overrides = {}) => ({
    env: { ...overrides },
    networkName: "confluxTestnet",
    chainId: 71n,
  });

  const expectRejected = async (operation, pattern) => {
    let error;
    try {
      await operation();
    } catch (caught) {
      error = caught;
    }
    expect(error, "expected operation to reject").to.be.an("error");
    expect(error.message).to.match(pattern);
  };

  describe("configuration guards", function () {
    it("parses the safe defaults only on Conflux eSpace testnet", function () {
      const result = parseESpaceAcceptanceConfig(baseConfig());
      expect(result.networkName).to.equal("confluxTestnet");
      expect(result.chainId).to.equal(71n);
      expect(result.acceptanceMode).to.equal(ACCEPTANCE_MODE_DIAGNOSTIC);
      expect(result.minDelaySeconds).to.equal(30);
      expect(result.diagnosticMinDelaySeconds).to.equal(30);
      expect(result.runGovernanceLifecycle).to.equal(true);
      expect(result.productionMinDelaySeconds).to.equal(null);
      expect(result.productionGovernanceMultisigProfile).to.equal(null);
      expect(result.confirmations).to.equal(2);
      expect(result.maximumCost).to.equal("5");
      expect(result.maximumCostWei).to.equal(ethers.parseEther("5"));
      expect(result.verify).to.equal(true);
      expect(result.recover).to.equal(false);
      expect(result.requireFinality).to.equal(true);
      expect(result.finalityTimeoutSeconds).to.equal(3600);
      expect(result.runId).to.equal(null);
    });

    it("accepts only the two explicit acceptance modes", function () {
      expect(
        parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_MODE: ACCEPTANCE_MODE_DIAGNOSTIC }))
          .acceptanceMode,
      ).to.equal(ACCEPTANCE_MODE_DIAGNOSTIC);
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_MODE: "release" }))).to.throw(
        /EVM_E2E_MODE.*diagnostic.*release-rehearsal/i,
      );
    });

    it("uses the explicit production delay for release rehearsals", function () {
      const releaseEnv = {
        EVM_E2E_MODE: ACCEPTANCE_MODE_RELEASE_REHEARSAL,
        EVM_E2E_MIN_DELAY: "30",
        MIN_DELAY: "172800",
        GOVERNANCE_SAFE_PROFILE: ESPACE_E2E_RELEASE_SAFE_PROFILE,
      };
      const result = parseESpaceAcceptanceConfig(baseConfig(releaseEnv));
      expect(result.acceptanceMode).to.equal(ACCEPTANCE_MODE_RELEASE_REHEARSAL);
      expect(result.verify).to.equal(true);
      expect(result.requireFinality).to.equal(true);
      expect(result.minDelaySeconds).to.equal(172800);
      expect(result.diagnosticMinDelaySeconds).to.equal(30);
      expect(result.runGovernanceLifecycle).to.equal(false);
      expect(result.productionMinDelaySeconds).to.equal(172800);
      expect(result.productionGovernanceMultisigProfile).to.equal(ESPACE_E2E_RELEASE_SAFE_PROFILE);

      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ ...releaseEnv, EVM_E2E_VERIFY: "0" })),
      ).to.throw(/release-rehearsal requires EVM_E2E_VERIFY=1/i);
      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ ...releaseEnv, EVM_E2E_REQUIRE_FINALITY: "0" })),
      ).to.throw(/release-rehearsal requires EVM_E2E_REQUIRE_FINALITY=1/i);
      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ ...releaseEnv, MIN_DELAY: "" })),
      ).to.throw(/MIN_DELAY.*explicitly set.*positive/i);
      expect(() =>
        parseESpaceAcceptanceConfig(
          baseConfig({
            ...releaseEnv,
            EVM_E2E_MIN_DELAY: "30",
            MIN_DELAY: "30",
          }),
        ),
      ).to.throw(/release-rehearsal requires MIN_DELAY >= 86400 seconds/i);
      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ ...releaseEnv, GOVERNANCE_SAFE_PROFILE: "" })),
      ).to.throw(/GOVERNANCE_SAFE_PROFILE=conflux-safe-1\.3\.0-2of3/i);
    });

    it("requires exact network name and chain ID", function () {
      expect(() =>
        parseESpaceAcceptanceConfig({ ...baseConfig(), networkName: "conflux" }),
      ).to.throw(/restricted.*confluxTestnet/i);
      expect(() => parseESpaceAcceptanceConfig({ ...baseConfig(), chainId: 1030 })).to.throw(
        /chainId 71/i,
      );
    });

    it("validates delay, confirmations, budget and binary flags", function () {
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_MIN_DELAY: "9" }))).to.throw(
        /MIN_DELAY.*>= 10/i,
      );
      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_CONFIRMATIONS: "0" })),
      ).to.throw(/CONFIRMATIONS.*>= 1/i);
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_MAX_NATIVE: "0" }))).to.throw(
        /greater than zero/i,
      );
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_MAX_NATIVE: "1e2" }))).to.throw(
        /positive plain decimal/i,
      );
      expect(parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_MIN_DELAY: "172800" }))).to.include({
        minDelaySeconds: 172800,
        diagnosticMinDelaySeconds: 172800,
        runGovernanceLifecycle: true,
      });
      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_CONFIRMATIONS: "101" })),
      ).to.throw(/must not exceed 100/i);
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_VERIFY: "true" }))).to.throw(
        /exactly 0 or 1/i,
      );
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_RECOVER: "yes" }))).to.throw(
        /exactly 0 or 1/i,
      );
      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_REQUIRE_FINALITY: "yes" })),
      ).to.throw(/exactly 0 or 1/i);
      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_FINALITY_TIMEOUT: "59" })),
      ).to.throw(/FINALITY_TIMEOUT.*>= 60/i);
    });

    it("requires a safe run ID in recovery mode", function () {
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ EVM_E2E_RECOVER: "1" }))).to.throw(
        /requires EVM_E2E_RUN_ID/i,
      );

      const result = parseESpaceAcceptanceConfig(
        baseConfig({ EVM_E2E_RECOVER: "1", EVM_E2E_RUN_ID: runId }),
      );
      expect(result.recover).to.equal(true);
      expect(result.runId).to.equal(runId);
      expect(result.runIdHash).to.equal(hashRunId(runId));
    });
  });

  describe("run IDs and deterministic isolated wallets", function () {
    it("rejects path traversal and produces a fixed safe report component", function () {
      expect(sanitizeRunId(runId)).to.equal(runId);
      for (const invalid of ["../escape", "short", "contains space", "/absolute-path"]) {
        expect(() => sanitizeRunId(invalid)).to.throw(/RUN_ID/);
      }
      expect(hashRunId(runId)).to.match(/^0x[0-9a-f]{64}$/);
      expect(runIdReportFileComponent(runId)).to.match(/^[0-9a-f]{32}$/);
      expect(runIdReportFileComponent(runId)).to.equal(runIdReportFileComponent(runId));
    });

    it("derives a deployer and two disjoint 2-of-3 owner sets deterministically", function () {
      const first = deriveAcceptanceWallets({ basePrivateKey, runId });
      const second = deriveAcceptanceWallets({ basePrivateKey, runId });
      const baseAddress = new ethers.Wallet(basePrivateKey).address;
      const addresses = [
        baseAddress,
        first.runDeployer.address,
        first.ownerA.address,
        first.ownerB.address,
        first.ownerC.address,
        first.ownerD.address,
        first.ownerE.address,
        first.ownerF.address,
      ];
      expect(new Set(addresses.map((address) => address.toLowerCase())).size).to.equal(8);
      expect(second.runDeployer.address).to.equal(first.runDeployer.address);
      for (const label of ["ownerA", "ownerB", "ownerC", "ownerD", "ownerE", "ownerF"]) {
        expect(second[label].address).to.equal(first[label].address);
      }
      const primaryOwners = [first.ownerA, first.ownerB, first.ownerC].map(
        (wallet) => wallet.address,
      );
      const replacementOwners = [first.ownerD, first.ownerE, first.ownerF].map(
        (wallet) => wallet.address,
      );
      expect(replacementOwners).not.to.include.members(primaryOwners);
      expect(addresses.slice(1)).not.to.include(baseAddress);

      const differentRun = deriveAcceptanceWallets({
        basePrivateKey,
        runId: "acceptance-run-20260722",
      });
      expect(differentRun.runDeployer.address).not.to.equal(first.runDeployer.address);
    });

    it("validates the base key, run ID and derivation label", function () {
      expect(() => deriveAcceptanceWallets({ basePrivateKey: "0x1234", runId })).to.throw(
        /PRIVATE_KEY/,
      );
      expect(() =>
        deriveAcceptanceWallet({ basePrivateKey, runId, label: "../bad-label" }),
      ).to.throw(/label/i);
    });
  });

  describe("production build-info evidence", function () {
    const record = ({ file, viaIR, sources }) => ({
      file,
      digest: ethers.id(file),
      buildInfo: {
        solcVersion: "0.8.28",
        solcLongVersion: "0.8.28+commit.7893614a",
        input: {
          sources: Object.fromEntries(sources.map((source) => [source, { content: "" }])),
          settings: {
            optimizer: { enabled: true, runs: 1 },
            evmVersion: "cancun",
            viaIR,
          },
        },
      },
    });
    const projectRecord = () =>
      record({
        file: "artifacts/build-info/project.json",
        viaIR: true,
        sources: ["project/contracts/DeepFamily.sol"],
      });
    const poseidonRecord = () =>
      record({
        file: "artifacts/build-info/poseidon.json",
        viaIR: false,
        sources: ["npm/poseidon-solidity@0.0.5/PoseidonT5.sol"],
      });

    it("derives the production compiler policy from actual project and override jobs", function () {
      const summary = summarizeProductionBuildInfo([projectRecord(), poseidonRecord()]);
      expect(summary.buildInfoFileCount).to.equal(2);
      expect(summary.hasProjectCompilerJob).to.equal(true);
      expect(summary.hasPoseidonOverrideCompilerJob).to.equal(true);
      expect(summary.productionSettingsMatched).to.equal(true);
      expect(summary.compilerJobs.map((job) => job.viaIR)).to.deep.equal([true, false]);
    });

    it("fails closed for missing or compiler-divergent build-info jobs", function () {
      expect(summarizeProductionBuildInfo([projectRecord()]).productionSettingsMatched).to.equal(
        false,
      );
      const wrongProject = projectRecord();
      wrongProject.buildInfo.input.settings.viaIR = false;
      expect(
        summarizeProductionBuildInfo([wrongProject, poseidonRecord()]).productionSettingsMatched,
      ).to.equal(false);
      expect(() => summarizeProductionBuildInfo([{ file: "bad", digest: "0x12" }])).to.throw(
        /Malformed Hardhat build-info/,
      );
    });
  });

  describe("bounded waits and report serialization", function () {
    it("polls until a truthy value and times out deterministically", async function () {
      let attempts = 0;
      const value = await pollUntil(
        async () => {
          attempts += 1;
          return attempts === 3 ? { ready: true } : null;
        },
        { timeoutMs: 100, intervalMs: 1, description: "test readiness" },
      );
      expect(value).to.deep.equal({ ready: true });
      expect(attempts).to.equal(3);

      await expectRejected(
        () =>
          pollUntil(async () => false, {
            timeoutMs: 10,
            intervalMs: 2,
            description: "never ready",
          }),
        /never ready timed out/,
      );
      await expectRejected(
        () =>
          withTimeout(() => new Promise(() => {}), {
            timeoutMs: 10,
            description: "hung request",
          }),
        /hung request timed out/,
      );
    });

    it("converts bigint and redacts secret fields and literal secret values", function () {
      const literalSecret = basePrivateKey;
      const report = {
        amount: 71n,
        nested: {
          privateKey: literalSecret,
          signatures: ["0xsigned"],
          proofData: "0xproof",
          harmless: `failure mentions ${literalSecret}`,
        },
      };
      const redacted = redactSecrets(report, { secretValues: [literalSecret] });
      expect(redacted.amount).to.equal("71");
      expect(redacted.nested.privateKey).to.equal("[REDACTED]");
      expect(redacted.nested.signatures).to.equal("[REDACTED]");
      expect(redacted.nested.proofData).to.equal("[REDACTED]");
      expect(redacted.nested.harmless).to.equal("failure mentions [REDACTED]");

      const json = safeJsonStringify(report, { secretValues: [literalSecret] });
      expect(() => JSON.parse(json)).not.to.throw();
      expect(json).not.to.include(literalSecret);
      expect(json).not.to.include("0xsigned");
      expect(json).not.to.include("0xproof");
    });
  });
});
