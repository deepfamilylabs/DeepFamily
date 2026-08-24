import fs from "node:fs/promises";
import { expect } from "chai";
import { ethers } from "ethers";

import {
  CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE,
  ESPACE_CHAIN_PROFILE,
  ETHEREUM_CHAIN_PROFILE,
  ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
  GAS_CHARGING_CONFLUX_THREE_QUARTER,
  GAS_CHARGING_ETHEREUM_RECEIPT,
  getAcceptanceProfileForNetwork,
  getChainProfile,
  getMainnetProfileForNetwork,
  supportedChainProfiles,
} from "../scripts/lib/chainProfiles.mjs";
import {
  deriveAcceptanceWallets,
  parseESpaceAcceptanceConfig,
  parseEthereumAcceptanceConfig,
} from "../scripts/lib/acceptanceSafety.mjs";
import {
  ESPACE_MAINNET_SAFE_PLAN_DIGEST_DOMAIN,
  ETHEREUM_MAINNET_SAFE_PLAN_DIGEST_DOMAIN,
  assertMainnetSafePlanMatchesCheckpoint,
  buildMainnetSafePlanFingerprint,
  deriveMainnetSafePlanDigest,
  parseEthereumMainnetSafeConfig,
} from "../scripts/lib/mainnetSafeSafety.mjs";
import { parseEthereumMainnetReleaseConfig } from "../scripts/lib/mainnetReleaseSafety.mjs";
import { chargedGasForReceipt } from "../scripts/lib/mainnetReleaseState.mjs";
import {
  buildCanonicalSafeDeploymentTransaction,
  getCanonicalSafeDeploymentMetadata,
} from "../scripts/lib/safeGovernance.mjs";
import {
  DEFAULT_CONFLUX_RPC_URLS,
  resolveEthereumRpcUrls,
  resolveProductionRpcUrl,
} from "../scripts/lib/hardhatConfig.mjs";

const SAFE = "0x1000000000000000000000000000000000000001";
const DEPLOYER = "0x2000000000000000000000000000000000000002";
const OWNERS = [
  "0x3000000000000000000000000000000000000003",
  "0x4000000000000000000000000000000000000004",
  "0x5000000000000000000000000000000000000005",
];
const PLAN_DIGEST = `0x${"ab".repeat(32)}`;
const SAFE_ACCEPTANCE_TX = `0x${"ef".repeat(32)}`;
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

const ethereumSafeEnv = (overrides = {}) => ({
  EVM_MAINNET_SAFE_PLAN_DIGEST: "",
  EVM_MAINNET_EXPECTED_DEPLOYER: DEPLOYER,
  EVM_MAINNET_SAFE_OWNERS: OWNERS.join(","),
  EVM_MAINNET_SAFE_SALT_NONCE: "42",
  EVM_MAINNET_SAFE_MAX_NATIVE: "0.25",
  GOVERNANCE_SAFE_PROFILE: ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
  ...overrides,
});

const ethereumReleaseEnv = (overrides = {}) => ({
  EVM_MAINNET_PLAN_DIGEST: "",
  EVM_MAINNET_PLAN_APPROVAL_SIGNATURES: "",
  EVM_MAINNET_EXPECTED_DEPLOYER: DEPLOYER,
  EVM_MAINNET_SAFE_OWNERS: OWNERS.join(","),
  EVM_MAINNET_MAX_NATIVE: "2",
  EVM_MAINNET_SAFE_ACCEPTANCE_TX: SAFE_ACCEPTANCE_TX,
  GOVERNANCE_SAFE_ADDRESS: SAFE,
  GOVERNANCE_SAFE_PROFILE: ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
  GOVERNANCE_TIMELOCK_ADDRESS: "",
  MIN_DELAY: "172800",
  ...overrides,
});

describe("Ethereum production tooling profiles", function () {
  it("defines immutable, exact eSpace and Ethereum chain identities", function () {
    expect(ESPACE_CHAIN_PROFILE.acceptance).to.include({
      networkName: "confluxTestnet",
      chainId: 71n,
      productionNetworkName: "conflux",
      productionChainId: 1030n,
      verificationProvider: "etherscan",
      explorerName: "ConfluxScan",
    });
    expect(ESPACE_CHAIN_PROFILE.mainnet).to.include({
      networkName: "conflux",
      chainId: 1030n,
      deploymentDirectoryName: "conflux",
      gasChargingPolicy: GAS_CHARGING_CONFLUX_THREE_QUARTER,
      verificationProvider: "etherscan",
      explorerName: "ConfluxScan",
    });
    expect(ETHEREUM_CHAIN_PROFILE.acceptance).to.include({
      networkName: "sepolia",
      chainId: 11155111n,
      productionNetworkName: "mainnet",
      productionChainId: 1n,
      verificationProvider: "blockscout",
      explorerName: "Blockscout",
    });
    expect(ETHEREUM_CHAIN_PROFILE.mainnet).to.include({
      networkName: "mainnet",
      chainId: 1n,
      deploymentDirectoryName: "mainnet",
      gasChargingPolicy: GAS_CHARGING_ETHEREUM_RECEIPT,
      verificationProvider: "etherscan",
      explorerName: "Etherscan",
    });
    expect(ESPACE_CHAIN_PROFILE.governanceMultisigProfile).to.equal(
      CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE,
    );
    expect(ETHEREUM_CHAIN_PROFILE.governanceMultisigProfile).to.equal(
      ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
    );
    expect(ESPACE_CHAIN_PROFILE.safe.singletonKind).to.equal("l2");
    expect(ETHEREUM_CHAIN_PROFILE.safe.singletonKind).to.equal("l1");
    expect(Object.isFrozen(ESPACE_CHAIN_PROFILE)).to.equal(true);
    expect(Object.isFrozen(ESPACE_CHAIN_PROFILE.mainnet)).to.equal(true);
    expect(Object.isFrozen(ETHEREUM_CHAIN_PROFILE)).to.equal(true);
    expect(Object.isFrozen(ETHEREUM_CHAIN_PROFILE.safe)).to.equal(true);
    expect(ESPACE_CHAIN_PROFILE.mainnet.testnetReleaseReportRelativePath).to.equal(
      "tmp/release-evidence/espace-release-rehearsal.json",
    );
    expect(ETHEREUM_CHAIN_PROFILE.mainnet.testnetReleaseReportRelativePath).to.equal(
      "tmp/release-evidence/ethereum-release-rehearsal.json",
    );
    expect(ESPACE_CHAIN_PROFILE.mainnet).not.to.have.property(
      "testnetReleaseReportEnvironmentName",
    );
    expect(ETHEREUM_CHAIN_PROFILE.mainnet).not.to.have.property(
      "testnetReleaseReportEnvironmentName",
    );
    expect(() => {
      ETHEREUM_CHAIN_PROFILE.mainnet.chainId = 2n;
    }).to.throw(TypeError);

    expect(getChainProfile("espace")).to.equal(ESPACE_CHAIN_PROFILE);
    expect(getChainProfile("ethereum")).to.equal(ETHEREUM_CHAIN_PROFILE);
    expect(getAcceptanceProfileForNetwork("sepolia")).to.equal(ETHEREUM_CHAIN_PROFILE);
    expect(getMainnetProfileForNetwork("mainnet")).to.equal(ETHEREUM_CHAIN_PROFILE);
    expect(() => getChainProfile("arbitrary")).to.throw("Unsupported live-chain profile");
    expect(() => getMainnetProfileForNetwork("localhost")).to.throw(
      "No guarded production profile",
    );
    expect(supportedChainProfiles()).to.deep.equal([ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE]);
    expect(Object.isFrozen(supportedChainProfiles())).to.equal(true);
  });

  it("exposes only explicit npm entry points with fixed Hardhat networks", async function () {
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    expect(packageJson.scripts).to.include({
      "espace:acceptance": "node scripts/espace-acceptance-command.mjs",
      "espace:mainnet:safe:plan": "node scripts/espace-mainnet-safe-command.mjs --plan",
      "espace:mainnet:safe:execute": "node scripts/espace-mainnet-safe-command.mjs --execute",
      "espace:mainnet:safe:status": "node scripts/espace-mainnet-safe-command.mjs --status",
      "espace:mainnet:release:projection":
        "node scripts/protocol-deployment-projection.mjs --chain espace",
      "espace:mainnet:release:plan": "node scripts/espace-mainnet-release-command.mjs --plan",
      "espace:mainnet:release:execute": "node scripts/espace-mainnet-release-command.mjs --execute",
      "ethereum:acceptance": "node scripts/ethereum-acceptance-command.mjs",
      "ethereum:mainnet:safe:plan": "node scripts/ethereum-mainnet-safe-command.mjs --plan",
      "ethereum:mainnet:safe:execute": "node scripts/ethereum-mainnet-safe-command.mjs --execute",
      "ethereum:mainnet:safe:status": "node scripts/ethereum-mainnet-safe-command.mjs --status",
      "ethereum:mainnet:release:projection":
        "node scripts/protocol-deployment-projection.mjs --chain ethereum",
      "ethereum:mainnet:release:plan": "node scripts/ethereum-mainnet-release-command.mjs --plan",
      "ethereum:mainnet:release:execute":
        "node scripts/ethereum-mainnet-release-command.mjs --execute",
    });
    for (const removedName of [
      "espace:mainnet:safe",
      "espace:mainnet:release",
      "ethereum:mainnet:safe",
      "ethereum:mainnet:release",
    ]) {
      expect(packageJson.scripts).not.to.have.property(removedName);
    }
    for (const name of [
      "espace:acceptance",
      "espace:mainnet:safe:plan",
      "espace:mainnet:safe:execute",
      "espace:mainnet:safe:status",
      "espace:mainnet:release:projection",
      "espace:mainnet:release:plan",
      "espace:mainnet:release:execute",
      "ethereum:acceptance",
      "ethereum:mainnet:safe:plan",
      "ethereum:mainnet:safe:execute",
      "ethereum:mainnet:safe:status",
      "ethereum:mainnet:release:projection",
      "ethereum:mainnet:release:plan",
      "ethereum:mainnet:release:execute",
    ]) {
      expect(packageJson.scripts[name], name).not.to.include("$npm_config_net");
    }
  });

  it("routes Sepolia acceptance to Blockscout while retaining Etherscan-compatible mainnets", async function () {
    const [acceptanceSource, releaseSource, verificationSource, hardhatConfig] = await Promise.all([
      fs.readFile("scripts/evm-acceptance.mjs", "utf8"),
      fs.readFile("scripts/evm-mainnet-release.mjs", "utf8"),
      fs.readFile("scripts/lib/acceptanceVerification.mjs", "utf8"),
      fs.readFile("hardhat.config.mjs", "utf8"),
    ]);

    expect(acceptanceSource).to.include(
      "verificationProvider: ACCEPTANCE_PROFILE.verificationProvider",
    );
    expect(acceptanceSource).not.to.include(
      "Ethereum acceptance verification requires a real EXPLORER_API_KEY before funding",
    );
    expect(releaseSource).to.include("verificationProvider: MAINNET_PROFILE.verificationProvider");
    expect(verificationSource).to.include("provider: verificationProvider");
    expect(hardhatConfig).to.include('enabled: HARDHAT_NETWORK_NAME === "sepolia"');
    expect(hardhatConfig).to.include('enabled: HARDHAT_NETWORK_NAME !== "sepolia"');
  });

  it("documents routine Ethereum acceptance, Safe and release inputs", async function () {
    const example = await fs.readFile(".env.example", "utf8");
    for (const name of [
      "INFURA_API_KEY",
      "ETHEREUM_SEPOLIA_RPC_URL",
      "ETHEREUM_MAINNET_RPC_URL",
      "EXPLORER_API_KEY",
      "EVM_E2E_MODE",
      "EVM_MAINNET_EXPECTED_DEPLOYER",
      "EVM_MAINNET_SAFE_OWNERS",
      "EVM_MAINNET_SAFE_SALT_NONCE",
      "EVM_MAINNET_SAFE_MAX_NATIVE",
      "EVM_MAINNET_SAFE_ACCEPTANCE_TX",
      "EVM_MAINNET_MAX_NATIVE",
      "GOVERNANCE_SAFE_PROFILE",
      "GOVERNANCE_SAFE_ADDRESS",
    ]) {
      expect(example, name).to.include(`${name}=`);
    }
    for (const name of [
      "EVM_E2E_MIN_DELAY",
      "EVM_E2E_MAX_NATIVE",
      "EVM_E2E_CONFIRMATIONS",
      "EVM_E2E_VERIFY",
      "EVM_E2E_REQUIRE_FINALITY",
      "EVM_E2E_FINALITY_TIMEOUT",
      "EVM_MAINNET_CONFIRMATIONS",
      "EVM_MAINNET_FINALITY_TIMEOUT",
    ]) {
      expect(example, name).not.to.include(`${name}=`);
    }
    expect(example).not.to.include("EVM_E2E_RUN_ID=");
    expect(example).not.to.include("EVM_E2E_RECOVER=");
    expect(example).not.to.include("EVM_MAINNET_TESTNET_RELEASE_REPORT=");
    expect(example).not.to.include("GOVERNANCE_MULTISIG=");
    expect(example).not.to.include("GOVERNANCE_OWNER=");
    expect(example).not.to.include("GOVERNANCE_MULTISIG_PROFILE=");
    expect(example).not.to.include("GOVERNANCE_TIMELOCK_ADDRESS=");
  });

  it("shares testnet settings while isolating chain guards and deterministic wallets", function () {
    const ethereum = parseEthereumAcceptanceConfig({
      env: { EVM_E2E_MAX_NATIVE: "0.15" },
      networkName: "sepolia",
      chainId: 11155111n,
    });
    expect(ethereum.chainProfileId).to.equal("ethereum");
    expect(ethereum.nativeSymbol).to.equal("ETH");
    expect(ethereum.confirmations).to.equal(2);
    expect(ethereum.maximumCost).to.equal("0.15");

    expect(() =>
      parseEthereumAcceptanceConfig({
        env: {},
        networkName: "sepolia",
        chainId: 71n,
      }),
    ).to.throw("requires chainId 11155111");
    expect(() =>
      parseEthereumAcceptanceConfig({
        env: {},
        networkName: "confluxTestnet",
        chainId: 71n,
      }),
    ).to.throw("restricted to network sepolia");

    const walletInput = {
      basePrivateKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      runId: "shared-run-20260724",
    };
    const espaceWallet = deriveAcceptanceWallets({
      ...walletInput,
      chainProfile: ESPACE_CHAIN_PROFILE,
    });
    const ethereumWallet = deriveAcceptanceWallets({
      ...walletInput,
      chainProfile: ETHEREUM_CHAIN_PROFILE,
    });
    expect(ethereumWallet.runDeployer.address).not.to.equal(espaceWallet.runDeployer.address);
    expect(ethereumWallet.ownerA.address).not.to.equal(espaceWallet.ownerA.address);

    expect(
      parseEthereumAcceptanceConfig({
        env: {},
        networkName: "sepolia",
        chainId: 11155111n,
      }).maximumCost,
    ).to.equal("0.2");
    expect(() =>
      parseEthereumAcceptanceConfig({
        env: { EVM_E2E_MAX_NATIVE: "0.200000000000000001" },
        networkName: "sepolia",
        chainId: 11155111n,
      }),
    ).to.throw("must not exceed 0.2 ETH");
  });

  it("keeps 30-second diagnostics but enforces the production delay floor for rehearsals", function () {
    const baseEnv = { EVM_E2E_MIN_DELAY: "30" };
    const diagnostic = parseEthereumAcceptanceConfig({
      env: {
        ...baseEnv,
        EVM_E2E_MODE: "diagnostic",
      },
      networkName: "sepolia",
      chainId: 11155111n,
    });
    expect(diagnostic.minDelaySeconds).to.equal(30);
    expect(diagnostic.diagnosticMinDelaySeconds).to.equal(30);
    expect(diagnostic.runGovernanceLifecycle).to.equal(true);

    expect(() =>
      parseEthereumAcceptanceConfig({
        env: {
          ...baseEnv,
          EVM_E2E_MODE: "release-rehearsal",
          MIN_DELAY: "30",
          GOVERNANCE_SAFE_PROFILE: ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
        },
        networkName: "sepolia",
        chainId: 11155111n,
      }),
    ).to.throw(/release-rehearsal requires MIN_DELAY >= 86400 seconds/i);

    const rehearsal = parseEthereumAcceptanceConfig({
      env: {
        ...baseEnv,
        EVM_E2E_MODE: "release-rehearsal",
        MIN_DELAY: "86400",
        GOVERNANCE_SAFE_PROFILE: ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
      },
      networkName: "sepolia",
      chainId: 11155111n,
    });
    expect(rehearsal.minDelaySeconds).to.equal(86400);
    expect(rehearsal.diagnosticMinDelaySeconds).to.equal(30);
    expect(rehearsal.runGovernanceLifecycle).to.equal(false);
    expect(rehearsal.productionMinDelaySeconds).to.equal(86400);
  });

  it("shares public Safe variables while retaining Ethereum network, chain and digest guards", function () {
    const config = parseEthereumMainnetSafeConfig({
      env: ethereumSafeEnv(),
      networkName: "mainnet",
      chainId: 1n,
    });
    expect(config.chainProfileId).to.equal("ethereum");
    expect(config.nativeSymbol).to.equal("ETH");
    expect(config.gasChargingPolicy).to.equal(GAS_CHARGING_ETHEREUM_RECEIPT);
    expect(config.maximumCostWei).to.equal(ethers.parseEther("0.25"));

    for (const field of [
      "expectedDeployerEnvironmentName",
      "safeOwnersEnvironmentName",
      "safeSaltNonceEnvironmentName",
      "safeMaximumCostEnvironmentName",
      "safePlanDigestEnvironmentName",
      "safeRecoveryTransactionEnvironmentName",
      "safeAcceptanceTransactionEnvironmentName",
    ]) {
      expect(ETHEREUM_CHAIN_PROFILE.mainnet[field]).to.equal(ESPACE_CHAIN_PROFILE.mainnet[field]);
    }
    const execution = parseEthereumMainnetSafeConfig({
      env: ethereumSafeEnv({ EVM_MAINNET_SAFE_PLAN_DIGEST: PLAN_DIGEST }),
      networkName: "mainnet",
      chainId: 1n,
    });
    expect(execution).to.include({ mode: "execute", configuredPlanDigest: PLAN_DIGEST });
    expect(() =>
      parseEthereumMainnetSafeConfig({
        env: ethereumSafeEnv({ EVM_MAINNET_SAFE_PLAN_DIGEST: "0x1234" }),
        networkName: "mainnet",
        chainId: 1n,
      }),
    ).to.throw("32-byte digest");
    expect(() =>
      parseEthereumMainnetSafeConfig({
        env: ethereumSafeEnv(),
        networkName: "conflux",
        chainId: 1030n,
      }),
    ).to.throw("restricted to network mainnet");
    expect(() =>
      parseEthereumMainnetSafeConfig({
        env: ethereumSafeEnv(),
        networkName: "mainnet",
        chainId: 1030n,
      }),
    ).to.throw("requires chainId 1");
  });

  it("binds the Safe plan fingerprint and digest to the Ethereum profile", function () {
    const config = parseEthereumMainnetSafeConfig({
      env: ethereumSafeEnv(),
      networkName: "mainnet",
      chainId: 1n,
    });
    const metadata = getCanonicalSafeDeploymentMetadata(1n);
    const prepared = buildCanonicalSafeDeploymentTransaction({
      chainId: 1n,
      owners: OWNERS,
      saltNonce: "42",
    });
    const fingerprint = buildMainnetSafePlanFingerprint({
      config,
      releaseCommit: "12".repeat(20),
      safeToolInputs: {
        digest: `0x${"11".repeat(32)}`,
        files: { "scripts/lib/safeGovernance.mjs": `0x${"22".repeat(32)}` },
      },
      deployerNonce: 7,
      predictedSafeAddress: SAFE,
      deploymentTransaction: prepared.deploymentTransaction,
      canonicalInfrastructure: {
        chainId: 1n,
        rpcChainId: "0x1",
        components: Object.fromEntries(
          ["singleton", "proxyFactory", "fallbackHandler"].map((name) => [
            name,
            {
              address: metadata[name].address,
              expectedCodeHash: metadata[name].codeHash,
              actualCodeHash: metadata[name].codeHash,
              matched: true,
            },
          ]),
        ),
        canonicalProxyCodeHash: `0x${"33".repeat(32)}`,
      },
    });

    expect(fingerprint.domain).to.equal(ETHEREUM_MAINNET_SAFE_PLAN_DIGEST_DOMAIN);
    expect(fingerprint.chainProfileId).to.equal("ethereum");
    expect(fingerprint.network).to.deep.equal({ name: "mainnet", chainId: "1" });
    expect(fingerprint.governanceSafe.profile).to.equal(ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE);
    expect(fingerprint.canonicalInfrastructure.components.singleton.address).to.equal(
      metadata.singleton.address,
    );
    expect(fingerprint.executionPolicy).to.include({
      nativeSymbol: "ETH",
      gasChargingPolicy: GAS_CHARGING_ETHEREUM_RECEIPT,
    });
    const digest = deriveMainnetSafePlanDigest(fingerprint);
    expect(ethers.isHexString(digest, 32)).to.equal(true);
    const espaceDigest = deriveMainnetSafePlanDigest({
      ...fingerprint,
      domain: ESPACE_MAINNET_SAFE_PLAN_DIGEST_DOMAIN,
    });
    expect(espaceDigest).not.to.equal(digest);
    expect(() =>
      assertMainnetSafePlanMatchesCheckpoint({
        checkpoint: { schemaVersion: 1, planDigest: espaceDigest, fingerprint },
        fingerprint,
        planDigest: espaceDigest,
      }),
    ).to.throw("do not match the approved plan digest");
  });

  it("shares public release variables while retaining Ethereum network, chain and digest guards", function () {
    const config = parseEthereumMainnetReleaseConfig({
      env: ethereumReleaseEnv({
        EVM_MAINNET_TESTNET_RELEASE_REPORT: "/tmp/untrusted-release-report.json",
      }),
      networkName: "mainnet",
      chainId: 1n,
    });
    expect(config.chainProfileId).to.equal("ethereum");
    expect(config.nativeSymbol).to.equal("ETH");
    expect(config.gasChargingPolicy).to.equal(GAS_CHARGING_ETHEREUM_RECEIPT);
    expect(config.maximumCostWei).to.equal(ethers.parseEther("2"));
    expect(config.testnetReleaseReportPath).to.equal(
      "tmp/release-evidence/ethereum-release-rehearsal.json",
    );

    for (const field of [
      "planDigestEnvironmentName",
      "planApprovalSignaturesEnvironmentName",
      "maximumCostEnvironmentName",
      "recoveryTransactionsEnvironmentName",
    ]) {
      expect(ETHEREUM_CHAIN_PROFILE.mainnet[field]).to.equal(ESPACE_CHAIN_PROFILE.mainnet[field]);
    }
    const execution = parseEthereumMainnetReleaseConfig({
      env: ethereumReleaseEnv({
        EVM_MAINNET_PLAN_DIGEST: PLAN_DIGEST,
        EVM_MAINNET_PLAN_APPROVAL_SIGNATURES: PLACEHOLDER_APPROVAL_SIGNATURES,
      }),
      networkName: "mainnet",
      chainId: 1n,
    });
    expect(execution).to.include({ mode: "execute", configuredPlanDigest: PLAN_DIGEST });
    expect(() =>
      parseEthereumMainnetReleaseConfig({
        env: ethereumReleaseEnv({ EVM_MAINNET_PLAN_DIGEST: "0x1234" }),
        networkName: "mainnet",
        chainId: 1n,
      }),
    ).to.throw("32-byte digest");
    expect(() =>
      parseEthereumMainnetReleaseConfig({
        env: ethereumReleaseEnv({ EVM_MAINNET_PLAN_DIGEST: PLAN_DIGEST }),
        networkName: "mainnet",
        chainId: 1n,
      }),
    ).to.throw("PLAN_APPROVAL_SIGNATURES must contain approval signatures");
    expect(() =>
      parseEthereumMainnetReleaseConfig({
        env: ethereumReleaseEnv(),
        networkName: "conflux",
        chainId: 1030n,
      }),
    ).to.throw("restricted to network mainnet");
    expect(() =>
      parseEthereumMainnetReleaseConfig({
        env: ethereumReleaseEnv(),
        networkName: "mainnet",
        chainId: 1030n,
      }),
    ).to.throw("requires chainId 1");
  });

  it("uses the Conflux three-quarter gas floor only on eSpace", function () {
    const entry = { request: { gasLimit: "100000" } };
    const receipt = { gasUsed: 50_000n };
    expect(
      chargedGasForReceipt({
        entry,
        receipt,
        gasChargingPolicy: GAS_CHARGING_CONFLUX_THREE_QUARTER,
      }),
    ).to.equal(75_000n);
    expect(
      chargedGasForReceipt({
        entry,
        receipt,
        gasChargingPolicy: GAS_CHARGING_ETHEREUM_RECEIPT,
      }),
    ).to.equal(50_000n);
    expect(() => chargedGasForReceipt({ entry, receipt, gasChargingPolicy: "unknown" })).to.throw(
      "Unsupported gas charging policy",
    );
  });

  it("resolves explicit Ethereum RPC URLs before Infura fallbacks", function () {
    expect(
      resolveEthereumRpcUrls({
        ETHEREUM_MAINNET_RPC_URL: " https://mainnet.example/rpc ",
        ETHEREUM_SEPOLIA_RPC_URL: " https://sepolia.example/rpc ",
        INFURA_API_KEY: "ignored",
      }),
    ).to.deep.equal({
      mainnet: "https://mainnet.example/rpc",
      sepolia: "https://sepolia.example/rpc",
    });
    expect(resolveEthereumRpcUrls({ INFURA_API_KEY: "project-key" })).to.deep.equal({
      mainnet: "https://mainnet.infura.io/v3/project-key",
      sepolia: "https://sepolia.infura.io/v3/project-key",
    });
    expect(
      resolveProductionRpcUrl(ETHEREUM_CHAIN_PROFILE, {
        ETHEREUM_MAINNET_RPC_URL: "https://ethereum.example",
      }),
    ).to.equal("https://ethereum.example");
    expect(resolveProductionRpcUrl(ESPACE_CHAIN_PROFILE, {})).to.equal(
      DEFAULT_CONFLUX_RPC_URLS.conflux,
    );
    expect(() => resolveProductionRpcUrl({ id: "unknown" }, {})).to.throw(
      "Unsupported production RPC profile",
    );
  });

  it("keeps thin wrappers profile-only and derives network, state directory and locks centrally", async function () {
    const [shared, locks, espaceSafe, espaceRelease, ethereumSafe, ethereumRelease] =
      await Promise.all([
        fs.readFile("scripts/lib/mainnetCommandWrapper.mjs", "utf8"),
        fs.readFile("scripts/lib/exclusiveCommandLock.mjs", "utf8"),
        fs.readFile("scripts/espace-mainnet-safe-command.mjs", "utf8"),
        fs.readFile("scripts/espace-mainnet-release-command.mjs", "utf8"),
        fs.readFile("scripts/ethereum-mainnet-safe-command.mjs", "utf8"),
        fs.readFile("scripts/ethereum-mainnet-release-command.mjs", "utf8"),
      ]);

    for (const [source, profileName] of [
      [espaceSafe, "ESPACE_CHAIN_PROFILE"],
      [espaceRelease, "ESPACE_CHAIN_PROFILE"],
      [ethereumSafe, "ETHEREUM_CHAIN_PROFILE"],
      [ethereumRelease, "ETHEREUM_CHAIN_PROFILE"],
    ]) {
      expect(source).to.include(profileName);
      expect(source).not.to.include("--network");
      expect(source).not.to.include("npm_config_net");
      expect(source).not.to.include("process.argv");
    }
    expect(shared).to.include("chainProfile.mainnet.networkName");
    expect(shared).to.include("chainProfile.mainnet.deploymentDirectoryName");
    expect(shared).to.include('".mainnet-command.lock"');
    expect(shared).to.include("`.mainnet-${kind}-command.lock`");
    expect(shared).to.include("parseMainnetSafeCommandArguments");
    expect(shared).to.include("parseMainnetReleaseCommandArguments");
    expect(shared).to.include('"--approval-file"');
    expect(shared).to.include("PRODUCTION_BUILD_LOCK_PATH");
    expect(shared).to.include("productionBuildLockPath(ROOT)");
    expect(locks).to.include('".production-build.lock"');
    expect(shared).not.to.include("npm_config_net");
  });

  it("documents and enforces chain-specific projection freezing before both release plans", async function () {
    const [runner, espaceRunbook, ethereumRunbook] = await Promise.all([
      fs.readFile("scripts/evm-mainnet-release.mjs", "utf8"),
      fs.readFile("docs/espace-mainnet-release.md", "utf8"),
      fs.readFile("docs/ethereum-mainnet-release.md", "utf8"),
    ]);
    const deriveIndex = runner.indexOf("deriveMainnetPlannedAddresses({");
    const projectionIndex = runner.indexOf(
      "assertPlannedProtocolDeploymentMatchesManifest({",
      deriveIndex,
    );
    const intentIndex = runner.indexOf("buildMainnetReleaseIntents({", projectionIndex);
    expect(deriveIndex).to.be.greaterThan(-1);
    expect(projectionIndex).to.be.greaterThan(deriveIndex);
    expect(intentIndex).to.be.greaterThan(projectionIndex);
    for (const [runbook, command, chainId] of [
      [espaceRunbook, "espace:mainnet:release:projection", "1030"],
      [ethereumRunbook, "ethereum:mainnet:release:projection", "1"],
    ]) {
      expect(runbook).to.include(command);
      expect(runbook).to.include(`chain ID \`${chainId}\``);
      expect(runbook).to.include("stableProjectionSha256");
      expect(runbook).to.include("npm run release:preflight");
      expect(runbook).to.include("EVM_E2E_MODE=release-rehearsal");
    }
    expect(espaceRunbook).to.include("16 ordered transaction intent hashes");
    expect(espaceRunbook).to.include("incomplete 16-step checkpoint");
    expect(espaceRunbook).not.to.match(/14 ordered|14-step/iu);
  });
});
