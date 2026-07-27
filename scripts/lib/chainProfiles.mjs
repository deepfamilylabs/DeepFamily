/**
 * Immutable live-chain profiles used by the guarded acceptance and production runners.
 *
 * Public commands select one of these profiles in code. Environment variables may fill in
 * addresses, budgets and approvals, but they can never change the selected network or chain ID.
 */

export const CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE = "conflux-safe-1.3.0-2of3";
export const ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE = "ethereum-safe-1.3.0-2of3";

export const GAS_CHARGING_CONFLUX_THREE_QUARTER = "conflux-three-quarter-gas-limit";
export const GAS_CHARGING_ETHEREUM_RECEIPT = "ethereum-receipt-gas-used";

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const profile = ({
  id,
  displayName,
  nativeSymbol,
  governanceMultisigProfile,
  safeSingletonKind,
  acceptance,
  mainnet,
}) =>
  deepFreeze({
    id,
    displayName,
    nativeSymbol,
    governanceMultisigProfile,
    safe: {
      version: "1.3.0",
      deploymentType: "canonical",
      singletonKind: safeSingletonKind,
      isL1SafeSingleton: safeSingletonKind === "l1",
      ownerCount: 3,
      threshold: 2,
    },
    acceptance: {
      ...acceptance,
      envPrefix: acceptance.envPrefix,
      confirmationEnvironmentName: `${acceptance.envPrefix}_CONFIRM`,
      modeEnvironmentName: `${acceptance.envPrefix}_MODE`,
      minDelayEnvironmentName: `${acceptance.envPrefix}_MIN_DELAY`,
      confirmationsEnvironmentName: `${acceptance.envPrefix}_CONFIRMATIONS`,
      maximumCostEnvironmentName: `${acceptance.envPrefix}_MAX_${nativeSymbol}`,
      runIdEnvironmentName: `${acceptance.envPrefix}_RUN_ID`,
      recoverEnvironmentName: `${acceptance.envPrefix}_RECOVER`,
      verifyEnvironmentName: `${acceptance.envPrefix}_VERIFY`,
      requireFinalityEnvironmentName: `${acceptance.envPrefix}_REQUIRE_FINALITY`,
      finalityTimeoutEnvironmentName: `${acceptance.envPrefix}_FINALITY_TIMEOUT`,
      runIdDigestDomain: `deepfamily:${id}-acceptance:run-id`,
      walletDerivationDomain: `deepfamily:${id}-acceptance:v1`,
    },
    mainnet: {
      ...mainnet,
      envPrefix: mainnet.envPrefix,
      expectedDeployerEnvironmentName: `${mainnet.envPrefix}_EXPECTED_DEPLOYER`,
      safeOwnersEnvironmentName: `${mainnet.envPrefix}_SAFE_OWNERS`,
      safeSaltNonceEnvironmentName: `${mainnet.envPrefix}_SAFE_SALT_NONCE`,
      safeMaximumCostEnvironmentName: `${mainnet.envPrefix}_SAFE_MAX_${nativeSymbol}`,
      safeConfirmationsEnvironmentName: `${mainnet.envPrefix}_SAFE_CONFIRMATIONS`,
      safeFinalityTimeoutEnvironmentName: `${mainnet.envPrefix}_SAFE_FINALITY_TIMEOUT`,
      safeConfirmationEnvironmentName: `${mainnet.envPrefix}_SAFE_CONFIRM`,
      safePlanDigestEnvironmentName: `${mainnet.envPrefix}_SAFE_PLAN_DIGEST`,
      safeRecoveryTransactionEnvironmentName: `${mainnet.envPrefix}_SAFE_RECOVERY_TX`,
      safeAcceptanceTransactionEnvironmentName: `${mainnet.envPrefix}_SAFE_ACCEPTANCE_TX`,
      confirmationEnvironmentName: `${mainnet.envPrefix}_CONFIRM`,
      planDigestEnvironmentName: `${mainnet.envPrefix}_PLAN_DIGEST`,
      maximumCostEnvironmentName: `${mainnet.envPrefix}_MAX_${nativeSymbol}`,
      confirmationsEnvironmentName: `${mainnet.envPrefix}_CONFIRMATIONS`,
      finalityTimeoutEnvironmentName: `${mainnet.envPrefix}_FINALITY_TIMEOUT`,
      recoveryTransactionsEnvironmentName: `${mainnet.envPrefix}_RECOVERY_TXS`,
      verifyEnvironmentName: `${mainnet.envPrefix}_VERIFY`,
      requireFinalityEnvironmentName: `${mainnet.envPrefix}_REQUIRE_FINALITY`,
      safePlanDigestDomain: `deepfamily:${id}-mainnet-safe:v1`,
      releasePlanDigestDomain: `deepfamily:${id}-mainnet-release:v1`,
      safeWrapperTokenEnvironmentName: `DEEPFAMILY_${mainnet.envPrefix}_SAFE_WRAPPER_TOKEN`,
      safeWrapperModeEnvironmentName: `DEEPFAMILY_${mainnet.envPrefix}_SAFE_WRAPPER_MODE`,
      releaseWrapperTokenEnvironmentName: `DEEPFAMILY_${mainnet.envPrefix}_WRAPPER_TOKEN`,
      sharedWrapperTokenEnvironmentName: `DEEPFAMILY_${mainnet.envPrefix}_COMMAND_WRAPPER_TOKEN`,
    },
  });

export const ESPACE_CHAIN_PROFILE = profile({
  id: "espace",
  displayName: "Conflux eSpace",
  nativeSymbol: "CFX",
  governanceMultisigProfile: CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE,
  safeSingletonKind: "l2",
  acceptance: {
    networkName: "confluxTestnet",
    chainId: 71n,
    productionNetworkName: "conflux",
    productionChainId: 1030n,
    confirmation: "conflux-testnet-chain-71",
    envPrefix: "ESPACE_E2E",
    reportDirectoryName: "espace-acceptance",
    command: "npm run espace:acceptance",
    verificationProvider: "etherscan",
    explorerName: "ConfluxScan",
  },
  mainnet: {
    networkName: "conflux",
    chainId: 1030n,
    confirmation: "conflux-mainnet-chain-1030",
    safeConfirmation: "conflux-mainnet-safe-chain-1030",
    envPrefix: "ESPACE_MAINNET",
    deploymentDirectoryName: "conflux",
    gasChargingPolicy: GAS_CHARGING_CONFLUX_THREE_QUARTER,
    safeCommand: "npm run espace:mainnet:safe",
    safeStatusCommand: "npm run espace:mainnet:safe:status",
    releaseCommand: "npm run espace:mainnet:release",
    verificationProvider: "etherscan",
    explorerName: "ConfluxScan",
  },
});

export const ETHEREUM_CHAIN_PROFILE = profile({
  id: "ethereum",
  displayName: "Ethereum",
  nativeSymbol: "ETH",
  governanceMultisigProfile: ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
  safeSingletonKind: "l1",
  acceptance: {
    networkName: "sepolia",
    chainId: 11155111n,
    productionNetworkName: "mainnet",
    productionChainId: 1n,
    confirmation: "ethereum-sepolia-chain-11155111",
    envPrefix: "ETHEREUM_E2E",
    reportDirectoryName: "ethereum-acceptance",
    command: "npm run ethereum:acceptance",
    verificationProvider: "blockscout",
    explorerName: "Blockscout",
  },
  mainnet: {
    networkName: "mainnet",
    chainId: 1n,
    confirmation: "ethereum-mainnet-chain-1",
    safeConfirmation: "ethereum-mainnet-safe-chain-1",
    envPrefix: "ETHEREUM_MAINNET",
    deploymentDirectoryName: "mainnet",
    gasChargingPolicy: GAS_CHARGING_ETHEREUM_RECEIPT,
    safeCommand: "npm run ethereum:mainnet:safe",
    safeStatusCommand: "npm run ethereum:mainnet:safe:status",
    releaseCommand: "npm run ethereum:mainnet:release",
    verificationProvider: "etherscan",
    explorerName: "Etherscan",
  },
});

const CHAIN_PROFILES_BY_ID = new Map(
  [ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE].map((item) => [item.id, item]),
);

export const getChainProfile = (id) => {
  const selected = CHAIN_PROFILES_BY_ID.get(String(id ?? ""));
  if (!selected) {
    throw new Error(`Unsupported live-chain profile: ${String(id ?? "unknown")}`);
  }
  return selected;
};

export const getAcceptanceProfileForNetwork = (networkName) => {
  const selected = [...CHAIN_PROFILES_BY_ID.values()].find(
    (item) => item.acceptance.networkName === networkName,
  );
  if (!selected) {
    throw new Error(`No guarded acceptance profile exists for network ${networkName || "unknown"}`);
  }
  return selected;
};

export const getMainnetProfileForNetwork = (networkName) => {
  const selected = [...CHAIN_PROFILES_BY_ID.values()].find(
    (item) => item.mainnet.networkName === networkName,
  );
  if (!selected) {
    throw new Error(`No guarded production profile exists for network ${networkName || "unknown"}`);
  }
  return selected;
};

export const supportedChainProfiles = () => Object.freeze([...CHAIN_PROFILES_BY_ID.values()]);
