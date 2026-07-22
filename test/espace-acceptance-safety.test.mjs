import { expect } from "chai";
import { ethers } from "ethers";
import {
  ESPACE_E2E_CONFIRMATION,
  buildMultisigExecuteTypedData,
  deriveAcceptanceWallet,
  deriveAcceptanceWallets,
  hashRunId,
  parseESpaceAcceptanceConfig,
  pollUntil,
  redactSecrets,
  runIdReportFileComponent,
  safeJsonStringify,
  sanitizeRunId,
  signMultisigExecute,
  withTimeout,
} from "../scripts/lib/espaceAcceptanceSafety.mjs";

describe("eSpace acceptance safety helpers", function () {
  const basePrivateKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const runId = "acceptance-run-20260721";
  const baseConfig = (overrides = {}) => ({
    env: {
      ESPACE_E2E_CONFIRM: ESPACE_E2E_CONFIRMATION,
      ...overrides,
    },
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
      expect(result.minDelaySeconds).to.equal(30);
      expect(result.confirmations).to.equal(2);
      expect(result.maxCfx).to.equal("5");
      expect(result.maxCfxWei).to.equal(ethers.parseEther("5"));
      expect(result.verify).to.equal(true);
      expect(result.recover).to.equal(false);
      expect(result.runId).to.equal(null);
    });

    it("requires exact network name, chain ID, and confirmation phrase", function () {
      expect(() =>
        parseESpaceAcceptanceConfig({ ...baseConfig(), networkName: "conflux" }),
      ).to.throw(/restricted.*confluxTestnet/i);
      expect(() => parseESpaceAcceptanceConfig({ ...baseConfig(), chainId: 1030 })).to.throw(
        /chainId 71/i,
      );
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ ESPACE_E2E_CONFIRM: "yes" }))).to.throw(
        new RegExp(ESPACE_E2E_CONFIRMATION),
      );
    });

    it("validates delay, confirmations, budget and binary flags", function () {
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ ESPACE_E2E_MIN_DELAY: "9" }))).to.throw(
        /MIN_DELAY.*>= 10/i,
      );
      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ ESPACE_E2E_CONFIRMATIONS: "0" })),
      ).to.throw(/CONFIRMATIONS.*>= 1/i);
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ ESPACE_E2E_MAX_CFX: "0" }))).to.throw(
        /greater than zero/i,
      );
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ ESPACE_E2E_MAX_CFX: "1e2" }))).to.throw(
        /positive plain decimal/i,
      );
      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ ESPACE_E2E_MIN_DELAY: "86401" })),
      ).to.throw(/must not exceed 86400/i);
      expect(() =>
        parseESpaceAcceptanceConfig(baseConfig({ ESPACE_E2E_CONFIRMATIONS: "101" })),
      ).to.throw(/must not exceed 100/i);
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ ESPACE_E2E_VERIFY: "true" }))).to.throw(
        /exactly 0 or 1/i,
      );
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ ESPACE_E2E_RECOVER: "yes" }))).to.throw(
        /exactly 0 or 1/i,
      );
    });

    it("requires a safe run ID in recovery mode", function () {
      expect(() => parseESpaceAcceptanceConfig(baseConfig({ ESPACE_E2E_RECOVER: "1" }))).to.throw(
        /requires ESPACE_E2E_RUN_ID/i,
      );

      const result = parseESpaceAcceptanceConfig(
        baseConfig({ ESPACE_E2E_RECOVER: "1", ESPACE_E2E_RUN_ID: runId }),
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

    it("derives four distinct deterministic wallets without serializing secrets", function () {
      const first = deriveAcceptanceWallets({ basePrivateKey, runId });
      const second = deriveAcceptanceWallets({ basePrivateKey, runId });
      const baseAddress = new ethers.Wallet(basePrivateKey).address;
      const addresses = [
        baseAddress,
        first.runDeployer.address,
        first.ownerA.address,
        first.ownerB.address,
        first.ownerC.address,
      ];
      expect(new Set(addresses.map((address) => address.toLowerCase())).size).to.equal(5);
      expect(second.runDeployer.address).to.equal(first.runDeployer.address);
      expect(second.ownerA.address).to.equal(first.ownerA.address);
      expect(second.ownerB.address).to.equal(first.ownerB.address);
      expect(second.ownerC.address).to.equal(first.ownerC.address);
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

  describe("EIP-712 2-of-3 execution signatures", function () {
    it("hashes calldata and produces signatures recoverable to both owners", async function () {
      const { ownerA, ownerB } = deriveAcceptanceWallets({ basePrivateKey, runId });
      const multisigAddress = "0x0000000000000000000000000000000000000071";
      const target = "0x0000000000000000000000000000000000000072";
      const data = "0x12345678";
      const signed = await signMultisigExecute({
        wallets: [ownerA, ownerB],
        chainId: 71,
        multisigAddress,
        target,
        value: 3n,
        data,
        nonce: 4n,
      });

      expect(signed.typedData.domain.name).to.equal("DeepFamily E2E Testnet Multisig");
      expect(signed.typedData.domain.version).to.equal("1");
      expect(signed.typedData.message.dataHash).to.equal(ethers.keccak256(data));
      expect(signed.signatures).to.have.length(2);
      const recovered = signed.signatures.map((signature) =>
        ethers.verifyTypedData(
          signed.typedData.domain,
          signed.typedData.types,
          signed.typedData.message,
          signature,
        ),
      );
      expect(recovered.map((address) => address.toLowerCase())).to.have.members([
        ownerA.address.toLowerCase(),
        ownerB.address.toLowerCase(),
      ]);
    });

    it("supports three distinct owner signatures over the same typed message", async function () {
      const { ownerA, ownerB, ownerC } = deriveAcceptanceWallets({ basePrivateKey, runId });
      const signed = await signMultisigExecute({
        wallets: [ownerC, ownerA, ownerB],
        chainId: 71,
        multisigAddress: "0x0000000000000000000000000000000000000071",
        target: "0x0000000000000000000000000000000000000072",
        value: 0n,
        data: "0xabcdef",
        nonce: 5n,
      });

      expect(signed.signatures).to.have.length(3);
      const recovered = signed.signatures.map((signature) =>
        ethers.verifyTypedData(
          signed.typedData.domain,
          signed.typedData.types,
          signed.typedData.message,
          signature,
        ),
      );
      expect(recovered.map((address) => address.toLowerCase())).to.deep.equal([
        ownerC.address.toLowerCase(),
        ownerA.address.toLowerCase(),
        ownerB.address.toLowerCase(),
      ]);
    });

    it("rejects the wrong chain, invalid targets, invalid counts and duplicate owners", async function () {
      const { runDeployer, ownerA, ownerB, ownerC } = deriveAcceptanceWallets({
        basePrivateKey,
        runId,
      });
      expect(() =>
        buildMultisigExecuteTypedData({
          chainId: 1030,
          multisigAddress: "0x0000000000000000000000000000000000000071",
          target: "0x0000000000000000000000000000000000000072",
          data: "0x",
          nonce: 0,
        }),
      ).to.throw(/chainId 71/i);
      expect(() =>
        buildMultisigExecuteTypedData({
          chainId: 71,
          multisigAddress: ethers.ZeroAddress,
          target: "0x0000000000000000000000000000000000000072",
          data: "0x",
          nonce: 0,
        }),
      ).to.throw(/nonzero EVM address/i);
      await expectRejected(
        () =>
          signMultisigExecute({
            wallets: [ownerA, ownerA],
            chainId: 71,
            multisigAddress: "0x0000000000000000000000000000000000000071",
            target: "0x0000000000000000000000000000000000000072",
            data: "0x",
            nonce: 0,
          }),
        /distinct/i,
      );
      await expectRejected(
        () =>
          signMultisigExecute({
            wallets: [ownerA, ownerB, ownerA],
            chainId: 71,
            multisigAddress: "0x0000000000000000000000000000000000000071",
            target: "0x0000000000000000000000000000000000000072",
            data: "0x",
            nonce: 0,
          }),
        /distinct/i,
      );
      await expectRejected(
        () =>
          signMultisigExecute({
            wallets: [ownerA],
            chainId: 71,
            multisigAddress: "0x0000000000000000000000000000000000000071",
            target: "0x0000000000000000000000000000000000000072",
            data: "0x",
            nonce: 0,
          }),
        /two or three/i,
      );
      await expectRejected(
        () =>
          signMultisigExecute({
            wallets: [ownerA, ownerB, ownerC, runDeployer],
            chainId: 71,
            multisigAddress: "0x0000000000000000000000000000000000000071",
            target: "0x0000000000000000000000000000000000000072",
            data: "0x",
            nonce: 0,
          }),
        /two or three/i,
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
