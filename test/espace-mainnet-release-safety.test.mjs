import { expect } from "chai";
import { ethers } from "ethers";

import { ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE } from "../scripts/lib/chainProfiles.mjs";
import {
  assertMainnetReleaseSafeAcceptanceNonce,
  assertPlanMatchesCheckpoint,
  buildMainnetPlanApprovalMessage,
  deriveMainnetPlanDigest,
  parseESpaceMainnetReleaseConfig,
  parseMainnetAuthorization,
  verifyMainnetPlanApprovals,
} from "../scripts/lib/mainnetReleaseSafety.mjs";

const SAFE = "0x1000000000000000000000000000000000000001";
const DEPLOYER = "0x2000000000000000000000000000000000000002";
const OWNERS = [
  "0x3000000000000000000000000000000000000003",
  "0x4000000000000000000000000000000000000004",
  "0x5000000000000000000000000000000000000005",
];
const PLAN_DIGEST = `0x${"ab".repeat(32)}`;
const PLACEHOLDER_APPROVAL_SIGNATURES = JSON.stringify([
  ethers.Signature.from({
    r: `0x${"01".repeat(32)}`,
    s: `0x${"02".repeat(32)}`,
    v: 27,
  }).serialized,
  ethers.Signature.from({
    r: `0x${"03".repeat(32)}`,
    s: `0x${"04".repeat(32)}`,
    v: 28,
  }).serialized,
]);

const baseEnv = (overrides = {}) => ({
  EVM_MAINNET_PLAN_DIGEST: "",
  EVM_MAINNET_PLAN_APPROVAL_SIGNATURES: "",
  EVM_MAINNET_EXPECTED_DEPLOYER: DEPLOYER,
  EVM_MAINNET_SAFE_OWNERS: OWNERS.join(","),
  EVM_MAINNET_MAX_NATIVE: "12.5",
  EVM_MAINNET_CONFIRMATIONS: "2",
  EVM_MAINNET_FINALITY_TIMEOUT: "3600",
  EVM_MAINNET_SAFE_ACCEPTANCE_TX: `0x${"ef".repeat(32)}`,
  GOVERNANCE_MULTISIG: SAFE,
  GOVERNANCE_MULTISIG_PROFILE: "conflux-safe-1.3.0-2of3",
  GOVERNANCE_OWNER: "",
  MIN_DELAY: "172800",
  ...overrides,
});

const parse = (overrides = {}, context = {}) =>
  parseESpaceMainnetReleaseConfig({
    env: baseEnv(overrides),
    networkName: context.networkName ?? "conflux",
    chainId: context.chainId ?? 1030n,
  });

describe("eSpace Mainnet release safety", function () {
  it("uses a blank digest for plan mode and a valid reviewed digest for execute mode", function () {
    expect(parseMainnetAuthorization(baseEnv())).to.deep.equal({
      mode: "plan",
      configuredPlanDigest: null,
    });
    const config = parse({
      EVM_MAINNET_PLAN_DIGEST: PLAN_DIGEST.toUpperCase().replace("0X", "0x"),
      EVM_MAINNET_PLAN_APPROVAL_SIGNATURES: PLACEHOLDER_APPROVAL_SIGNATURES,
    });
    expect(config.mode).to.equal("execute");
    expect(config.configuredPlanDigest).to.equal(PLAN_DIGEST);
    expect(() =>
      parseMainnetAuthorization(baseEnv({ EVM_MAINNET_PLAN_DIGEST: "0x1234" })),
    ).to.throw("32-byte digest");
  });

  it("hard-locks the Hardhat network and raw chain identity", function () {
    expect(() => parse({}, { networkName: "confluxTestnet" })).to.throw(
      "restricted to network conflux",
    );
    expect(() => parse({}, { chainId: 71n })).to.throw("requires chainId 1030");
  });

  it("requires the exact Safe profile and independent three-owner allowlist", function () {
    expect(() => parse({ GOVERNANCE_MULTISIG_PROFILE: "" })).to.throw(
      "requires GOVERNANCE_MULTISIG_PROFILE",
    );
    expect(() => parse({ EVM_MAINNET_SAFE_OWNERS: OWNERS.slice(0, 2).join(",") })).to.throw(
      "exactly three",
    );
    expect(() =>
      parse({ EVM_MAINNET_SAFE_OWNERS: [OWNERS[0], OWNERS[0], OWNERS[2]].join(",") }),
    ).to.throw("three distinct");
    expect(() => parse({ EVM_MAINNET_EXPECTED_DEPLOYER: OWNERS[1] })).to.throw(
      "must not be one of the Safe owners",
    );
  });

  it("enforces the production delay floor, finality, verification and an explicit budget", function () {
    expect(() => parse({ MIN_DELAY: "86399" })).to.throw("between 86400");
    expect(ESPACE_CHAIN_PROFILE.mainnet).not.to.have.property("verifyEnvironmentName");
    expect(ESPACE_CHAIN_PROFILE.mainnet).not.to.have.property("requireFinalityEnvironmentName");
    expect(() => parse({ EVM_MAINNET_MAX_NATIVE: "" })).to.throw("explicitly set");
    expect(() => parse({ EVM_MAINNET_CONFIRMATIONS: "1" })).to.throw("between 2 and 100");
  });

  it("forbids force-new and a caller-supplied governance owner", function () {
    expect(() => parse({ FORCE_NEW_DEPLOYMENT: "1" })).to.throw("forbidden");
    expect(() => parse({ GOVERNANCE_OWNER: SAFE })).to.throw("must be blank");
  });

  it("strictly parses recovery transaction hashes without accepting arbitrary JSON", function () {
    expect(() => parse({ EVM_MAINNET_RECOVERY_TXS: "[]" })).to.throw("JSON object");
    expect(() => parse({ EVM_MAINNET_RECOVERY_TXS: '{"bad label":"0x12"}' })).to.throw(
      "invalid label",
    );
    expect(() =>
      parse({
        EVM_MAINNET_RECOVERY_TXS: JSON.stringify({
          unknownReleaseStep: `0x${"12".repeat(32)}`,
        }),
      }),
    ).to.throw("unknown release label");
    const hash = `0x${"12".repeat(32)}`;
    expect(
      parse({ EVM_MAINNET_RECOVERY_TXS: JSON.stringify({ deepFamilyToken: hash }) })
        .recoveryTransactions.deepFamilyToken,
    ).to.equal(hash);
  });

  it("requires finalized real-owner Safe acceptance evidence before release planning", function () {
    expect(() => parse({ EVM_MAINNET_SAFE_ACCEPTANCE_TX: "" })).to.throw(
      "real 2-of-3 owner smoke test",
    );
    expect(() => parse({ EVM_MAINNET_SAFE_ACCEPTANCE_TX: "0x1234" })).to.throw(
      "real 2-of-3 owner smoke test",
    );
    expect(parse().safeAcceptanceTransaction).to.equal(`0x${"ef".repeat(32)}`);
    expect(assertMainnetReleaseSafeAcceptanceNonce(1n)).to.equal(1n);
    for (const nonce of [0n, 2n, 99n]) {
      expect(() => assertMainnetReleaseSafeAcceptanceNonce(nonce)).to.throw(
        "first and only execution",
      );
    }
    expect(() => assertMainnetReleaseSafeAcceptanceNonce("not-a-nonce")).to.throw(
      "nonce is invalid",
    );
  });

  it("derives a deterministic digest that changes with any reviewed release input", function () {
    const fingerprint = {
      chainId: 1030n,
      safe: SAFE,
      owners: OWNERS,
      deployer: DEPLOYER,
      nonce: 9,
      budget: ethers.parseEther("12.5"),
    };
    const first = deriveMainnetPlanDigest(fingerprint);
    expect(deriveMainnetPlanDigest({ ...fingerprint })).to.equal(first);
    expect(deriveMainnetPlanDigest({ ...fingerprint, nonce: 10 })).not.to.equal(first);
    expect(deriveMainnetPlanDigest({ ...fingerprint, owners: [...OWNERS].reverse() })).not.to.equal(
      first,
    );
  });

  it("rejects replaying a release plan digest across eSpace and Ethereum profiles", function () {
    const reviewedInputs = {
      schemaVersion: 1,
      governanceMultisig: SAFE,
      expectedDeployer: DEPLOYER,
      expectedSafeOwners: OWNERS,
    };
    const espaceFingerprint = {
      ...reviewedInputs,
      domain: ESPACE_CHAIN_PROFILE.mainnet.releasePlanDigestDomain,
      chainProfileId: ESPACE_CHAIN_PROFILE.id,
      chainId: ESPACE_CHAIN_PROFILE.mainnet.chainId,
    };
    const ethereumFingerprint = {
      ...reviewedInputs,
      domain: ETHEREUM_CHAIN_PROFILE.mainnet.releasePlanDigestDomain,
      chainProfileId: ETHEREUM_CHAIN_PROFILE.id,
      chainId: ETHEREUM_CHAIN_PROFILE.mainnet.chainId,
    };
    const espaceDigest = deriveMainnetPlanDigest(espaceFingerprint);
    expect(deriveMainnetPlanDigest(ethereumFingerprint)).not.to.equal(espaceDigest);
    expect(() =>
      assertPlanMatchesCheckpoint({
        checkpoint: {
          schemaVersion: 1,
          planDigest: espaceDigest,
          fingerprint: ethereumFingerprint,
        },
        fingerprint: ethereumFingerprint,
        planDigest: espaceDigest,
      }),
    ).to.throw("Current release inputs do not match the approved plan digest");
  });

  it("requires execute-mode plan approvals and forbids stale approvals in plan mode", function () {
    expect(() =>
      parse({
        EVM_MAINNET_PLAN_DIGEST: PLAN_DIGEST,
      }),
    ).to.throw("PLAN_APPROVAL_SIGNATURES must contain approval signatures");
    expect(() =>
      parse({ EVM_MAINNET_PLAN_APPROVAL_SIGNATURES: PLACEHOLDER_APPROVAL_SIGNATURES }),
    ).to.throw("blank while generating a plan");
  });

  it("can label wrapper-provided approval and recovery inputs without exposing bridge env names", function () {
    const commandInputLabels = {
      planDigest: "--approval-file planDigest",
      planApprovalSignatures: "--approval-file signatures",
      recoveryTransactions: "--recovery-file",
    };
    expect(() =>
      parseMainnetAuthorization(
        baseEnv({ EVM_MAINNET_PLAN_DIGEST: "0x1234" }),
        ESPACE_CHAIN_PROFILE,
        { planDigestLabel: commandInputLabels.planDigest },
      ),
    ).to.throw("--approval-file planDigest");
    expect(() =>
      parseESpaceMainnetReleaseConfig({
        env: baseEnv({ EVM_MAINNET_PLAN_DIGEST: PLAN_DIGEST }),
        networkName: "conflux",
        chainId: 1030n,
        commandInputLabels,
      }),
    ).to.throw("--approval-file signatures");
    expect(() =>
      parseESpaceMainnetReleaseConfig({
        env: baseEnv({
          EVM_MAINNET_PLAN_DIGEST: PLAN_DIGEST,
          EVM_MAINNET_PLAN_APPROVAL_SIGNATURES: PLACEHOLDER_APPROVAL_SIGNATURES,
          EVM_MAINNET_RECOVERY_TXS: JSON.stringify({ unknownReleaseStep: PLAN_DIGEST }),
        }),
        networkName: "conflux",
        chainId: 1030n,
        commandInputLabels,
      }),
    ).to.throw("--recovery-file contains an unknown release label");
  });

  it("cryptographically requires distinct approvals from the expected Safe owners", async function () {
    const ownerWallets = [
      new ethers.Wallet(`0x${"11".repeat(32)}`),
      new ethers.Wallet(`0x${"22".repeat(32)}`),
      new ethers.Wallet(`0x${"33".repeat(32)}`),
    ];
    const ownerAddresses = ownerWallets.map((wallet) => wallet.address);
    const message = buildMainnetPlanApprovalMessage({
      planDigest: PLAN_DIGEST,
      governanceMultisig: SAFE,
    });
    const signatures = await Promise.all(
      ownerWallets.slice(0, 2).map((wallet) => wallet.signMessage(message)),
    );
    const approval = verifyMainnetPlanApprovals({
      planDigest: PLAN_DIGEST,
      governanceMultisig: SAFE,
      expectedOwners: ownerAddresses,
      requiredApprovals: 2,
      signatures,
    });
    expect(approval.requiredApprovals).to.equal(2);
    expect(approval.approvedOwners).to.have.members(ownerAddresses.slice(0, 2));
    expect(approval.messageHash).to.equal(ethers.hashMessage(message));

    expect(() =>
      verifyMainnetPlanApprovals({
        planDigest: PLAN_DIGEST,
        governanceMultisig: SAFE,
        expectedOwners: ownerAddresses,
        requiredApprovals: 2,
        signatures: [signatures[0], signatures[0]],
      }),
    ).to.throw("duplicate signature");
    const outsider = new ethers.Wallet(`0x${"44".repeat(32)}`);
    const outsiderSignature = await outsider.signMessage(message);
    expect(() =>
      verifyMainnetPlanApprovals({
        planDigest: PLAN_DIGEST,
        governanceMultisig: SAFE,
        expectedOwners: ownerAddresses,
        requiredApprovals: 2,
        signatures: [signatures[0], outsiderSignature],
      }),
    ).to.throw("not from an expected Safe owner");
    expect(() =>
      verifyMainnetPlanApprovals({
        planDigest: PLAN_DIGEST,
        governanceMultisig: SAFE,
        expectedOwners: ownerAddresses,
        requiredApprovals: 2,
        signatures: [signatures[0]],
      }),
    ).to.throw("at least 2 Safe-owner plan approvals");
  });

  it("binds Safe-owner approvals to the exact plan digest and production Safe", async function () {
    const ownerWallets = [
      new ethers.Wallet(`0x${"55".repeat(32)}`),
      new ethers.Wallet(`0x${"66".repeat(32)}`),
      new ethers.Wallet(`0x${"77".repeat(32)}`),
    ];
    const message = buildMainnetPlanApprovalMessage({
      planDigest: PLAN_DIGEST,
      governanceMultisig: SAFE,
    });
    const signatures = await Promise.all(
      ownerWallets.slice(0, 2).map((wallet) => wallet.signMessage(message)),
    );
    for (const changed of [
      { planDigest: `0x${"cd".repeat(32)}`, governanceMultisig: SAFE },
      {
        planDigest: PLAN_DIGEST,
        governanceMultisig: "0x9000000000000000000000000000000000000009",
      },
    ]) {
      expect(() =>
        verifyMainnetPlanApprovals({
          ...changed,
          expectedOwners: ownerWallets.map((wallet) => wallet.address),
          requiredApprovals: 2,
          signatures,
        }),
      ).to.throw("not from an expected Safe owner");
    }
  });

  it("rejects replaying plan approvals across eSpace and Ethereum profiles", async function () {
    const owners = [
      new ethers.Wallet(`0x${"81".repeat(32)}`),
      new ethers.Wallet(`0x${"82".repeat(32)}`),
      new ethers.Wallet(`0x${"83".repeat(32)}`),
    ];
    const ownerAddresses = owners.map((wallet) => wallet.address);
    const scenarios = [
      [ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE],
      [ETHEREUM_CHAIN_PROFILE, ESPACE_CHAIN_PROFILE],
    ];
    for (const [signedProfile, replayedProfile] of scenarios) {
      const message = buildMainnetPlanApprovalMessage({
        chainProfile: signedProfile,
        planDigest: PLAN_DIGEST,
        governanceMultisig: SAFE,
      });
      const signatures = await Promise.all(
        owners.slice(0, 2).map((wallet) => wallet.signMessage(message)),
      );
      expect(() =>
        verifyMainnetPlanApprovals({
          chainProfile: replayedProfile,
          planDigest: PLAN_DIGEST,
          governanceMultisig: SAFE,
          expectedOwners: ownerAddresses,
          requiredApprovals: 2,
          signatures,
        }),
      ).to.throw("not from an expected Safe owner");
    }
  });
});
