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
  ETHEREUM_MAINNET_SAFE_CONFIRMATION,
  buildMainnetSafePlanFingerprint,
  deriveMainnetSafePlanDigest,
  parseEthereumMainnetSafeConfig,
} from "../scripts/lib/mainnetSafeSafety.mjs";
import {
  ETHEREUM_MAINNET_CONFIRMATION,
  parseEthereumMainnetReleaseConfig,
} from "../scripts/lib/mainnetReleaseSafety.mjs";
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

const ethereumSafeEnv = (overrides = {}) => ({
  ETHEREUM_MAINNET_SAFE_CONFIRM: "",
  ETHEREUM_MAINNET_SAFE_PLAN_DIGEST: "",
  ETHEREUM_MAINNET_EXPECTED_DEPLOYER: DEPLOYER,
  ETHEREUM_MAINNET_SAFE_OWNERS: OWNERS.join(","),
  ETHEREUM_MAINNET_SAFE_SALT_NONCE: "42",
  ETHEREUM_MAINNET_SAFE_MAX_ETH: "0.25",
  ETHEREUM_MAINNET_SAFE_CONFIRMATIONS: "2",
  ETHEREUM_MAINNET_SAFE_FINALITY_TIMEOUT: "3600",
  GOVERNANCE_MULTISIG_PROFILE: ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
  ...overrides,
});

const ethereumReleaseEnv = (overrides = {}) => ({
  ETHEREUM_MAINNET_CONFIRM: "",
  ETHEREUM_MAINNET_PLAN_DIGEST: "",
  ETHEREUM_MAINNET_PLAN_APPROVAL_SIGNATURES: "",
  ETHEREUM_MAINNET_EXPECTED_DEPLOYER: DEPLOYER,
  ETHEREUM_MAINNET_SAFE_OWNERS: OWNERS.join(","),
  ETHEREUM_MAINNET_MAX_ETH: "2",
  ETHEREUM_MAINNET_CONFIRMATIONS: "2",
  ETHEREUM_MAINNET_FINALITY_TIMEOUT: "3600",
  ETHEREUM_MAINNET_VERIFY: "1",
  ETHEREUM_MAINNET_REQUIRE_FINALITY: "1",
  ETHEREUM_MAINNET_SAFE_ACCEPTANCE_TX: SAFE_ACCEPTANCE_TX,
  GOVERNANCE_MULTISIG: SAFE,
  GOVERNANCE_MULTISIG_PROFILE: ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
  GOVERNANCE_OWNER: "",
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
      confirmation: "conflux-testnet-chain-71",
      verificationProvider: "etherscan",
      explorerName: "ConfluxScan",
    });
    expect(ESPACE_CHAIN_PROFILE.mainnet).to.include({
      networkName: "conflux",
      chainId: 1030n,
      confirmation: "conflux-mainnet-chain-1030",
      safeConfirmation: "conflux-mainnet-safe-chain-1030",
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
      confirmation: "ethereum-sepolia-chain-11155111",
      verificationProvider: "blockscout",
      explorerName: "Blockscout",
    });
    expect(ETHEREUM_CHAIN_PROFILE.mainnet).to.include({
      networkName: "mainnet",
      chainId: 1n,
      confirmation: "ethereum-mainnet-chain-1",
      safeConfirmation: "ethereum-mainnet-safe-chain-1",
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
      "espace:mainnet:safe": "node scripts/espace-mainnet-safe-command.mjs",
      "espace:mainnet:safe:status": "node scripts/espace-mainnet-safe-command.mjs --status",
      "espace:mainnet:release": "node scripts/espace-mainnet-release-command.mjs",
      "ethereum:acceptance": "node scripts/ethereum-acceptance-command.mjs",
      "ethereum:mainnet:safe": "node scripts/ethereum-mainnet-safe-command.mjs",
      "ethereum:mainnet:safe:status": "node scripts/ethereum-mainnet-safe-command.mjs --status",
      "ethereum:mainnet:release": "node scripts/ethereum-mainnet-release-command.mjs",
    });
    for (const name of [
      "espace:acceptance",
      "espace:mainnet:safe",
      "espace:mainnet:safe:status",
      "espace:mainnet:release",
      "ethereum:acceptance",
      "ethereum:mainnet:safe",
      "ethereum:mainnet:safe:status",
      "ethereum:mainnet:release",
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

  it("documents every Ethereum RPC, acceptance, Safe and release input", async function () {
    const example = await fs.readFile(".env.example", "utf8");
    for (const name of [
      "INFURA_API_KEY",
      "ETHEREUM_SEPOLIA_RPC_URL",
      "ETHEREUM_MAINNET_RPC_URL",
      "EXPLORER_API_KEY",
      "ETHEREUM_E2E_CONFIRM",
      "ETHEREUM_E2E_MODE",
      "ETHEREUM_E2E_MIN_DELAY",
      "ETHEREUM_E2E_CONFIRMATIONS",
      "ETHEREUM_E2E_MAX_ETH",
      "ETHEREUM_E2E_RUN_ID",
      "ETHEREUM_E2E_RECOVER",
      "ETHEREUM_E2E_VERIFY",
      "ETHEREUM_E2E_REQUIRE_FINALITY",
      "ETHEREUM_E2E_FINALITY_TIMEOUT",
      "ETHEREUM_MAINNET_EXPECTED_DEPLOYER",
      "ETHEREUM_MAINNET_SAFE_OWNERS",
      "ETHEREUM_MAINNET_SAFE_SALT_NONCE",
      "ETHEREUM_MAINNET_SAFE_MAX_ETH",
      "ETHEREUM_MAINNET_SAFE_CONFIRMATIONS",
      "ETHEREUM_MAINNET_SAFE_FINALITY_TIMEOUT",
      "ETHEREUM_MAINNET_SAFE_CONFIRM",
      "ETHEREUM_MAINNET_SAFE_PLAN_DIGEST",
      "ETHEREUM_MAINNET_SAFE_RECOVERY_TX",
      "ETHEREUM_MAINNET_SAFE_ACCEPTANCE_TX",
      "ETHEREUM_MAINNET_CONFIRM",
      "ETHEREUM_MAINNET_PLAN_DIGEST",
      "ETHEREUM_MAINNET_PLAN_APPROVAL_SIGNATURES",
      "ETHEREUM_MAINNET_MAX_ETH",
      "ETHEREUM_MAINNET_CONFIRMATIONS",
      "ETHEREUM_MAINNET_FINALITY_TIMEOUT",
      "ETHEREUM_MAINNET_RECOVERY_TXS",
    ]) {
      expect(example, name).to.include(`${name}=`);
    }
  });

  it("isolates testnet confirmations, environment prefixes and deterministic wallets", function () {
    const ethereum = parseEthereumAcceptanceConfig({
      env: {
        ETHEREUM_E2E_CONFIRM: "ethereum-sepolia-chain-11155111",
        ETHEREUM_E2E_MAX_ETH: "0.5",
        ESPACE_E2E_CONFIRM: "conflux-testnet-chain-71",
        ESPACE_E2E_MAX_CFX: "999",
      },
      networkName: "sepolia",
      chainId: 11155111n,
    });
    expect(ethereum.chainProfileId).to.equal("ethereum");
    expect(ethereum.nativeSymbol).to.equal("ETH");
    expect(ethereum.maximumCost).to.equal("0.5");

    expect(() =>
      parseEthereumAcceptanceConfig({
        env: {
          ESPACE_E2E_CONFIRM: "conflux-testnet-chain-71",
          ESPACE_E2E_MAX_CFX: "1",
        },
        networkName: "sepolia",
        chainId: 11155111n,
      }),
    ).to.throw("Set ETHEREUM_E2E_CONFIRM=ethereum-sepolia-chain-11155111");
    expect(() =>
      parseESpaceAcceptanceConfig({
        env: { ETHEREUM_E2E_CONFIRM: "ethereum-sepolia-chain-11155111" },
        networkName: "confluxTestnet",
        chainId: 71n,
      }),
    ).to.throw("Set ESPACE_E2E_CONFIRM=conflux-testnet-chain-71");
    expect(() =>
      parseEthereumAcceptanceConfig({
        env: { ETHEREUM_E2E_CONFIRM: "ethereum-sepolia-chain-11155111" },
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
  });

  it("keeps 30-second diagnostics but enforces the production delay floor for rehearsals", function () {
    const baseEnv = {
      ETHEREUM_E2E_CONFIRM: "ethereum-sepolia-chain-11155111",
      ETHEREUM_E2E_MIN_DELAY: "30",
    };
    const diagnostic = parseEthereumAcceptanceConfig({
      env: {
        ...baseEnv,
        ETHEREUM_E2E_MODE: "diagnostic",
      },
      networkName: "sepolia",
      chainId: 11155111n,
    });
    expect(diagnostic.minDelaySeconds).to.equal(30);

    expect(() =>
      parseEthereumAcceptanceConfig({
        env: {
          ...baseEnv,
          ETHEREUM_E2E_MODE: "release-rehearsal",
          MIN_DELAY: "30",
          GOVERNANCE_MULTISIG_PROFILE: ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
        },
        networkName: "sepolia",
        chainId: 11155111n,
      }),
    ).to.throw(/release-rehearsal requires MIN_DELAY >= 86400 seconds/i);

    const rehearsal = parseEthereumAcceptanceConfig({
      env: {
        ...baseEnv,
        ETHEREUM_E2E_MODE: "release-rehearsal",
        ETHEREUM_E2E_MIN_DELAY: "86400",
        MIN_DELAY: "86400",
        GOVERNANCE_MULTISIG_PROFILE: ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
      },
      networkName: "sepolia",
      chainId: 11155111n,
    });
    expect(rehearsal.minDelaySeconds).to.equal(86400);
    expect(rehearsal.productionMinDelaySeconds).to.equal(86400);
  });

  it("does not let eSpace variables authorize Ethereum mainnet Safe creation", function () {
    const config = parseEthereumMainnetSafeConfig({
      env: ethereumSafeEnv(),
      networkName: "mainnet",
      chainId: 1n,
    });
    expect(config.chainProfileId).to.equal("ethereum");
    expect(config.nativeSymbol).to.equal("ETH");
    expect(config.gasChargingPolicy).to.equal(GAS_CHARGING_ETHEREUM_RECEIPT);
    expect(config.maximumCostWei).to.equal(ethers.parseEther("0.25"));

    expect(() =>
      parseEthereumMainnetSafeConfig({
        env: {
          ESPACE_MAINNET_SAFE_CONFIRM: "conflux-mainnet-safe-chain-1030",
          ESPACE_MAINNET_SAFE_PLAN_DIGEST: PLAN_DIGEST,
          ESPACE_MAINNET_EXPECTED_DEPLOYER: DEPLOYER,
          ESPACE_MAINNET_SAFE_OWNERS: OWNERS.join(","),
          ESPACE_MAINNET_SAFE_SALT_NONCE: "42",
          ESPACE_MAINNET_SAFE_MAX_CFX: "100",
          GOVERNANCE_MULTISIG_PROFILE: CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE,
        },
        networkName: "mainnet",
        chainId: 1n,
      }),
    ).to.throw(`requires GOVERNANCE_MULTISIG_PROFILE=${ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE}`);
    expect(() =>
      parseEthereumMainnetSafeConfig({
        env: ethereumSafeEnv({
          ETHEREUM_MAINNET_SAFE_CONFIRM: "conflux-mainnet-safe-chain-1030",
          ETHEREUM_MAINNET_SAFE_PLAN_DIGEST: PLAN_DIGEST,
        }),
        networkName: "mainnet",
        chainId: 1n,
      }),
    ).to.throw(`must be exactly ${ETHEREUM_MAINNET_SAFE_CONFIRMATION}`);
    expect(() =>
      parseEthereumMainnetSafeConfig({
        env: ethereumSafeEnv(),
        networkName: "conflux",
        chainId: 1030n,
      }),
    ).to.throw("restricted to network mainnet");
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
    expect(
      deriveMainnetSafePlanDigest({
        ...fingerprint,
        domain: ESPACE_MAINNET_SAFE_PLAN_DIGEST_DOMAIN,
      }),
    ).not.to.equal(digest);
  });

  it("does not let eSpace variables authorize an Ethereum mainnet release", function () {
    const config = parseEthereumMainnetReleaseConfig({
      env: ethereumReleaseEnv(),
      networkName: "mainnet",
      chainId: 1n,
    });
    expect(config.chainProfileId).to.equal("ethereum");
    expect(config.nativeSymbol).to.equal("ETH");
    expect(config.gasChargingPolicy).to.equal(GAS_CHARGING_ETHEREUM_RECEIPT);
    expect(config.maximumCostWei).to.equal(ethers.parseEther("2"));

    expect(() =>
      parseEthereumMainnetReleaseConfig({
        env: {
          ESPACE_MAINNET_CONFIRM: "conflux-mainnet-chain-1030",
          ESPACE_MAINNET_PLAN_DIGEST: PLAN_DIGEST,
          ESPACE_MAINNET_EXPECTED_DEPLOYER: DEPLOYER,
          ESPACE_MAINNET_SAFE_OWNERS: OWNERS.join(","),
          ESPACE_MAINNET_MAX_CFX: "100",
          ESPACE_MAINNET_SAFE_ACCEPTANCE_TX: SAFE_ACCEPTANCE_TX,
          GOVERNANCE_MULTISIG: SAFE,
          GOVERNANCE_MULTISIG_PROFILE: CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE,
          GOVERNANCE_OWNER: "",
          MIN_DELAY: "172800",
        },
        networkName: "mainnet",
        chainId: 1n,
      }),
    ).to.throw(`requires GOVERNANCE_MULTISIG_PROFILE=${ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE}`);
    expect(() =>
      parseEthereumMainnetReleaseConfig({
        env: ethereumReleaseEnv({
          ETHEREUM_MAINNET_CONFIRM: "conflux-mainnet-chain-1030",
          ETHEREUM_MAINNET_PLAN_DIGEST: PLAN_DIGEST,
        }),
        networkName: "mainnet",
        chainId: 1n,
      }),
    ).to.throw(ETHEREUM_MAINNET_CONFIRMATION);
    expect(() =>
      parseEthereumMainnetReleaseConfig({
        env: ethereumReleaseEnv(),
        networkName: "conflux",
        chainId: 1030n,
      }),
    ).to.throw("restricted to network mainnet");
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
    expect(shared).to.include("arguments_.length !== 0");
    expect(shared).to.include("PRODUCTION_BUILD_LOCK_PATH");
    expect(shared).to.include("productionBuildLockPath(ROOT)");
    expect(locks).to.include('".production-build.lock"');
    expect(shared).not.to.include("npm_config_net");
  });
});
