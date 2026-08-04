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

const EVM_E2E_ENV_PREFIX = "EVM_E2E";
const EVM_MAINNET_ENV_PREFIX = "EVM_MAINNET";
const EVM_MAINNET_CONFIRMATIONS_ENVIRONMENT_NAME = "EVM_MAINNET_CONFIRMATIONS";
const EVM_MAINNET_FINALITY_TIMEOUT_ENVIRONMENT_NAME = "EVM_MAINNET_FINALITY_TIMEOUT";

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
      envPrefix: EVM_E2E_ENV_PREFIX,
      confirmationEnvironmentName: `${EVM_E2E_ENV_PREFIX}_CONFIRM`,
      modeEnvironmentName: `${EVM_E2E_ENV_PREFIX}_MODE`,
      minDelayEnvironmentName: `${EVM_E2E_ENV_PREFIX}_MIN_DELAY`,
      confirmationsEnvironmentName: `${EVM_E2E_ENV_PREFIX}_CONFIRMATIONS`,
      maximumCostEnvironmentName: `${EVM_E2E_ENV_PREFIX}_MAX_NATIVE`,
      runIdEnvironmentName: `${EVM_E2E_ENV_PREFIX}_RUN_ID`,
      recoverEnvironmentName: `${EVM_E2E_ENV_PREFIX}_RECOVER`,
      verifyEnvironmentName: `${EVM_E2E_ENV_PREFIX}_VERIFY`,
      requireFinalityEnvironmentName: `${EVM_E2E_ENV_PREFIX}_REQUIRE_FINALITY`,
      finalityTimeoutEnvironmentName: `${EVM_E2E_ENV_PREFIX}_FINALITY_TIMEOUT`,
      runIdDigestDomain: `deepfamily:${id}-acceptance:run-id`,
      walletDerivationDomain: `deepfamily:${id}-acceptance:v1`,
      wrapperTokenEnvironmentName: `DEEPFAMILY_${acceptance.wrapperEnvPrefix}_WRAPPER_TOKEN`,
      commandLockFileName: `.${id}-release-rehearsal-command.lock`,
    },
    mainnet: {
      ...mainnet,
      expectedDeployerEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_EXPECTED_DEPLOYER`,
      safeOwnersEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_SAFE_OWNERS`,
      safeSaltNonceEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_SAFE_SALT_NONCE`,
      safeMaximumCostEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_SAFE_MAX_NATIVE`,
      safeConfirmationsEnvironmentName: EVM_MAINNET_CONFIRMATIONS_ENVIRONMENT_NAME,
      safeFinalityTimeoutEnvironmentName: EVM_MAINNET_FINALITY_TIMEOUT_ENVIRONMENT_NAME,
      safeConfirmationEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_SAFE_CONFIRM`,
      safePlanDigestEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_SAFE_PLAN_DIGEST`,
      safeRecoveryTransactionEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_SAFE_RECOVERY_TX`,
      safeAcceptanceTransactionEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_SAFE_ACCEPTANCE_TX`,
      confirmationEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_CONFIRM`,
      planDigestEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_PLAN_DIGEST`,
      planApprovalSignaturesEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_PLAN_APPROVAL_SIGNATURES`,
      maximumCostEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_MAX_NATIVE`,
      confirmationsEnvironmentName: EVM_MAINNET_CONFIRMATIONS_ENVIRONMENT_NAME,
      finalityTimeoutEnvironmentName: EVM_MAINNET_FINALITY_TIMEOUT_ENVIRONMENT_NAME,
      recoveryTransactionsEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_RECOVERY_TXS`,
      testnetReleaseReportEnvironmentName: `${EVM_MAINNET_ENV_PREFIX}_TESTNET_RELEASE_REPORT`,
      safePlanDigestDomain: `deepfamily:${id}-mainnet-safe:v1`,
      releasePlanDigestDomain: `deepfamily:${id}-mainnet-release:v1`,
      releasePlanApprovalDomain: `deepfamily:${id}-mainnet-release-approval:v1`,
      safeWrapperTokenEnvironmentName: `DEEPFAMILY_${mainnet.wrapperEnvPrefix}_SAFE_WRAPPER_TOKEN`,
      safeWrapperModeEnvironmentName: `DEEPFAMILY_${mainnet.wrapperEnvPrefix}_SAFE_WRAPPER_MODE`,
      releaseWrapperTokenEnvironmentName: `DEEPFAMILY_${mainnet.wrapperEnvPrefix}_WRAPPER_TOKEN`,
      sharedWrapperTokenEnvironmentName: `DEEPFAMILY_${mainnet.wrapperEnvPrefix}_COMMAND_WRAPPER_TOKEN`,
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
    defaultMaximumCost: "5",
    maximumCostCeiling: "5",
    wrapperEnvPrefix: "ESPACE_E2E",
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
    wrapperEnvPrefix: "ESPACE_MAINNET",
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
    defaultMaximumCost: "0.2",
    maximumCostCeiling: "0.2",
    wrapperEnvPrefix: "ETHEREUM_E2E",
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
    wrapperEnvPrefix: "ETHEREUM_MAINNET",
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
