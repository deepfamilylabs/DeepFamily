import path from "node:path";
import { formatEther } from "ethers";

/**
 * Shared Canonical Safe v1.3.0 production bootstrap engine.
 *
 * Public eSpace and Ethereum entry files select an immutable profile and document their exact
 * plan, execute/resume and status commands. Do not invoke this shared engine directly.
 *
 * The creator reads only public owner addresses. It never generates, imports, signs with, or
 * persists an owner private key.
 */

import hre from "hardhat";

import {
  MAINNET_SAFE_STATE_SCHEMA_VERSION,
  assertMainnetSafePlanMatchesCheckpoint,
  buildMainnetSafePlanFingerprint,
  canonicalMainnetSafePlanJson,
  deriveMainnetSafePlanDigest,
  parseProductionMainnetSafeConfig,
  parseMainnetSafeAuthorization,
} from "./lib/mainnetSafeSafety.mjs";
import {
  acquireReleaseLock,
  createCheckpointedTransactionExecutor,
  readJsonIfExists,
  revalidateCheckpointTransactions,
  writeJsonAtomic,
} from "./lib/mainnetReleaseState.mjs";
import { gitWorkingTreeState, waitForFinalizedTransactions } from "./lib/releaseEvidence.mjs";
import { hashMainnetSafeInputs, publicSafeCreatorError } from "./lib/mainnetSafeEvidence.mjs";
import {
  assertSafeCreationCheckpointIntent,
  buildAndValidateSafeCreationIntent,
} from "./lib/mainnetSafeIntent.mjs";
import {
  assertCanonicalSafeDeploymentReceipt,
  assertCanonicalSafeOperationalAcceptance,
  assertCanonicalSafeProfile,
  createCanonicalSafeProxyFactoryInterface,
  inspectCanonicalSafeInfrastructure,
  prepareCanonicalSafeDeployment,
} from "./lib/safeGovernance.mjs";
import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";

const TRANSACTION_LABEL = "createGovernanceSafe";
const TX_TIMEOUT_MS = 10 * 60 * 1_000;
let CHAIN_PROFILE = ESPACE_CHAIN_PROFILE;
let MAINNET_PROFILE = CHAIN_PROFILE.mainnet;
let MAINNET_CHAIN_ID = MAINNET_PROFILE.chainId;
let DEPLOYMENTS_DIRECTORY = path.join(
  process.cwd(),
  "deployments",
  MAINNET_PROFILE.deploymentDirectoryName,
);
let STATE_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-safe-state.json");
let PLAN_REPORT_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-safe-plan.json");
let REPORT_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-safe-report.json");
let LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-safe.lock");
let SHARED_COMMAND_LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-command.lock");
let COMMAND_LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-safe-command.lock");
let WRAPPER_TOKEN_ENV = MAINNET_PROFILE.safeWrapperTokenEnvironmentName;
let SHARED_WRAPPER_TOKEN_ENV = MAINNET_PROFILE.sharedWrapperTokenEnvironmentName;
let WRAPPER_MODE_ENV = MAINNET_PROFILE.safeWrapperModeEnvironmentName;

const configureChainProfile = (chainProfile) => {
  if (!chainProfile?.mainnet) throw new Error("A guarded production chain profile is required");
  CHAIN_PROFILE = chainProfile;
  MAINNET_PROFILE = chainProfile.mainnet;
  MAINNET_CHAIN_ID = MAINNET_PROFILE.chainId;
  DEPLOYMENTS_DIRECTORY = path.join(
    process.cwd(),
    "deployments",
    MAINNET_PROFILE.deploymentDirectoryName,
  );
  STATE_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-safe-state.json");
  PLAN_REPORT_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-safe-plan.json");
  REPORT_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-safe-report.json");
  LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-safe.lock");
  SHARED_COMMAND_LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-command.lock");
  COMMAND_LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-safe-command.lock");
  WRAPPER_TOKEN_ENV = MAINNET_PROFILE.safeWrapperTokenEnvironmentName;
  SHARED_WRAPPER_TOKEN_ENV = MAINNET_PROFILE.sharedWrapperTokenEnvironmentName;
  WRAPPER_MODE_ENV = MAINNET_PROFILE.safeWrapperModeEnvironmentName;
};

const nowIso = () => new Date().toISOString();
const sameAddress = (left, right) =>
  String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();

const assertSafeCommandWrapper = async () => {
  const expectedToken = String(process.env[WRAPPER_TOKEN_ENV] ?? "").trim();
  const expectedSharedToken = String(process.env[SHARED_WRAPPER_TOKEN_ENV] ?? "").trim();
  if (expectedToken === "" || expectedSharedToken === "") {
    throw new Error(
      `Use ${MAINNET_PROFILE.safeCommand} or ${MAINNET_PROFILE.safeStatusCommand}; ` +
        "direct script execution is forbidden",
    );
  }
  const [commandLock, sharedCommandLock] = await Promise.all([
    readJsonIfExists(COMMAND_LOCK_PATH),
    readJsonIfExists(SHARED_COMMAND_LOCK_PATH),
  ]);
  if (!commandLock || commandLock.token !== expectedToken) {
    throw new Error("Mainnet Safe command wrapper lock is missing or does not match");
  }
  if (!sharedCommandLock || sharedCommandLock.token !== expectedSharedToken) {
    throw new Error("Shared mainnet command wrapper lock is missing or does not match");
  }
  const mode = String(process.env[WRAPPER_MODE_ENV] ?? "").trim();
  if (mode !== "run" && mode !== "status") {
    throw new Error("Mainnet Safe command wrapper mode is invalid");
  }
  return mode;
};

const assertRawMainnetChain = async (provider) => {
  const rawChainId = await provider.send("eth_chainId", []);
  if (typeof rawChainId !== "string" || BigInt(rawChainId) !== MAINNET_CHAIN_ID) {
    throw new Error(
      `Raw ${CHAIN_PROFILE.displayName} mainnet RPC chainId must be ${MAINNET_CHAIN_ID}; got ` +
        String(rawChainId),
    );
  }
};

const assertExternallyOwnedControllers = async ({ provider, config }) => {
  const addresses = [config.expectedDeployer, ...config.expectedSafeOwners];
  for (const [index, address] of addresses.entries()) {
    const code = await provider.getCode(address);
    if (code !== "0x") {
      const label =
        index === 0 ? MAINNET_PROFILE.expectedDeployerEnvironmentName : `Safe owner ${index}`;
      throw new Error(
        `${label} ${address} has deployed code. This pinned production profile supports ` +
          "independent EOA/hardware-wallet controllers only.",
      );
    }
  }
};

const assertConfiguredSafeAddress = (configuredAddress, predictedAddress) => {
  if (configuredAddress && !sameAddress(configuredAddress, predictedAddress)) {
    throw new Error(
      `GOVERNANCE_MULTISIG=${configuredAddress} differs from predicted Safe ${predictedAddress}`,
    );
  }
};

const simulateFactoryCreation = async ({ ethers, provider, expectedDeployer, preparedSafe }) => {
  let result;
  try {
    result = await provider.call({
      from: expectedDeployer,
      ...preparedSafe.deploymentTransaction,
    });
  } catch (error) {
    throw new Error(`Canonical Safe factory simulation failed: ${publicSafeCreatorError(error)}`);
  }
  const factoryInterface = createCanonicalSafeProxyFactoryInterface(MAINNET_CHAIN_ID);
  let simulatedAddress;
  try {
    [simulatedAddress] = factoryInterface.decodeFunctionResult("createProxyWithNonce", result);
  } catch {
    throw new Error("Canonical Safe factory simulation returned malformed data");
  }
  const normalizedAddress = ethers.getAddress(simulatedAddress);
  if (!sameAddress(normalizedAddress, preparedSafe.safeAddress)) {
    throw new Error(
      `Canonical Safe factory simulation returned ${normalizedAddress}; Protocol Kit predicted ` +
        preparedSafe.safeAddress,
    );
  }
  return normalizedAddress;
};

const publicTransactionReport = (transactions = {}) =>
  Object.fromEntries(
    Object.entries(transactions).map(([label, entry]) => [
      label,
      {
        status: entry.status,
        from: entry.from,
        nonce: entry.request?.nonce,
        to: entry.request?.to,
        value: entry.request?.value,
        dataHash: entry.dataHash,
        hash: entry.hash,
        receipt: entry.receipt,
        maximumCostWei: entry.maximumCostWei,
        actualCostWei: entry.actualCostWei ?? null,
        recoveredHash: entry.recoveredHash === true,
      },
    ]),
  );

const buildReportProvenance = ({ checkpoint, sourceState, safeToolInputs }) => {
  if (!sourceState || !safeToolInputs) {
    throw new Error("Current Safe report validator provenance is required");
  }
  const approvedCommit = checkpoint?.fingerprint?.releaseCommit ?? null;
  const approvedInputs = checkpoint?.fingerprint?.safeToolInputs ?? null;
  const commitMatches =
    approvedCommit !== null &&
    String(sourceState.commit).toLowerCase() === String(approvedCommit).toLowerCase();
  const toolInputsMatch =
    approvedInputs?.digest !== undefined &&
    String(safeToolInputs.digest).toLowerCase() === String(approvedInputs.digest).toLowerCase();
  return {
    approvedPlan: {
      releaseCommit: approvedCommit,
      safeToolInputs: approvedInputs,
    },
    currentValidator: {
      releaseCommit: sourceState.commit,
      workingTreeClean: sourceState.clean,
      changedPathCount: sourceState.changedPathCount,
      safeToolInputs,
      commitMatchesApprovedPlan: commitMatches,
      toolInputsMatchApprovedPlan: toolInputsMatch,
      exactlyMatchesApprovedPlan: sourceState.clean && commitMatches && toolInputsMatch,
    },
  };
};

const writeSafeReport = async ({
  checkpoint,
  config,
  sourceState,
  safeToolInputs,
  decodedSetup,
  safeProfile = null,
  deploymentEvidence = null,
  operationalAcceptance = null,
  reportPath = REPORT_PATH,
  mode = config.mode,
}) => {
  const transactions = publicTransactionReport(checkpoint?.transactions);
  const provenance = buildReportProvenance({ checkpoint, sourceState, safeToolInputs });
  const actualCostWei = Object.values(transactions).reduce(
    (total, transaction) => total + BigInt(transaction.actualCostWei ?? 0),
    0n,
  );
  const acceptance = operationalAcceptance ?? {
    status: "pending",
    governanceReady: false,
    reason:
      "A real 2-of-3 owner transaction has not yet been supplied through " +
      `${MAINNET_PROFILE.safeAcceptanceTransactionEnvironmentName}.`,
  };
  await writeJsonAtomic(reportPath, {
    schemaVersion: MAINNET_SAFE_STATE_SCHEMA_VERSION,
    mode,
    status: checkpoint?.status ?? "planned",
    phase: checkpoint?.phase ?? "preflight",
    generatedAt: nowIso(),
    planDigest: checkpoint?.planDigest ?? null,
    fingerprint: checkpoint?.fingerprint ?? null,
    provenance,
    network: {
      name: MAINNET_PROFILE.networkName,
      chainId: MAINNET_CHAIN_ID,
    },
    addresses: checkpoint?.addresses ?? {},
    orderedOwners: checkpoint?.fingerprint?.governanceSafe?.owners ?? [],
    threshold: 2,
    decodedSetup,
    transactions,
    actualCostWei,
    actualCostNative: formatEther(actualCostWei),
    nativeSymbol: CHAIN_PROFILE.nativeSymbol,
    ...(CHAIN_PROFILE.id === "espace" ? { actualCostCfx: formatEther(actualCostWei) } : {}),
    maximumCostWei:
      checkpoint?.fingerprint?.executionPolicy?.maximumCostWei ?? config.maximumCostWei,
    finality: checkpoint?.finality ?? { status: "not-started" },
    deploymentEvidence,
    safeProfile,
    deployed: checkpoint?.status === "passed" && safeProfile !== null,
    ownerOperationalAcceptance: acceptance,
    governanceReady: acceptance.governanceReady === true,
    error: checkpoint?.error ?? null,
    ownerPrivateKeysRead: false,
    ownerPrivateKeysPersisted: false,
    ownerSignaturesPersisted: false,
  });
  return provenance;
};

const recoveryTransactionsFor = (config) =>
  config.recoveryTransaction
    ? Object.freeze({ [TRANSACTION_LABEL]: config.recoveryTransaction })
    : Object.freeze({});

const assertRecoveryClaim = (checkpoint, config) => {
  if (!config.recoveryTransaction) return;
  const entry = checkpoint?.transactions?.[TRANSACTION_LABEL];
  if (!entry || entry.status !== "planned" || entry.hash) {
    throw new Error(
      `${MAINNET_PROFILE.safeRecoveryTransactionEnvironmentName} requires a hashless planned ` +
        "createGovernanceSafe " +
        "checkpoint entry",
    );
  }
};

const assertStatusConfigurationMatchesCheckpoint = ({ config, checkpoint }) => {
  const fingerprint = checkpoint?.fingerprint;
  if (!fingerprint) throw new Error("Mainnet Safe checkpoint fingerprint is missing");
  if (!sameAddress(config.expectedDeployer, fingerprint.deployer?.address)) {
    throw new Error(
      `${MAINNET_PROFILE.expectedDeployerEnvironmentName} differs from the completed Safe ` +
        "checkpoint",
    );
  }
  const expectedOwners = config.expectedSafeOwners;
  const recordedOwners = fingerprint.governanceSafe?.owners ?? [];
  if (
    expectedOwners.length !== recordedOwners.length ||
    expectedOwners.some((owner, index) => !sameAddress(owner, recordedOwners[index]))
  ) {
    throw new Error(
      `${MAINNET_PROFILE.safeOwnersEnvironmentName} order differs from the completed Safe ` +
        "checkpoint",
    );
  }
  if (String(config.saltNonce) !== String(fingerprint.governanceSafe?.saltNonce)) {
    throw new Error(
      `${MAINNET_PROFILE.safeSaltNonceEnvironmentName} differs from the completed Safe checkpoint`,
    );
  }
  if (config.governanceMultisigProfile !== fingerprint.governanceSafe?.profile) {
    throw new Error("GOVERNANCE_MULTISIG_PROFILE differs from the completed Safe checkpoint");
  }
  assertConfiguredSafeAddress(config.governanceMultisig, checkpoint.safeAddress);
};

const assertCompletedCheckpointShape = (checkpoint) => {
  if (
    checkpoint?.status !== "passed" ||
    checkpoint.phase !== "complete" ||
    !checkpoint.completedAt ||
    checkpoint.finality?.status !== "passed" ||
    checkpoint.terminalProfile?.status !== "passed" ||
    checkpoint.transactions?.[TRANSACTION_LABEL]?.status !== "finalized"
  ) {
    throw new Error("Completed mainnet Safe checkpoint is missing required deployment evidence");
  }
};

const inspectDeploymentEvidence = async ({ provider, checkpoint, intent }) => {
  const entry = checkpoint.transactions[TRANSACTION_LABEL];
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(entry.hash),
    provider.getTransactionReceipt(entry.hash),
  ]);
  return assertCanonicalSafeDeploymentReceipt({
    receipt,
    transaction,
    chainId: MAINNET_CHAIN_ID,
    expectedDeployer: intent.from,
    expectedNonce: intent.nonce,
    expectedSafeAddress: checkpoint.safeAddress,
    expectedDeploymentTransaction: {
      to: intent.to,
      value: intent.value,
      data: intent.data,
    },
  });
};

const inspectOperationalAcceptance = async ({ provider, config, safeAddress, safeProfile }) => {
  if (!config.acceptanceTransaction) {
    return {
      status: "pending",
      governanceReady: false,
      expectedTarget: config.expectedDeployer,
      reason:
        `Have two real owners execute a refund-free 0 ${CHAIN_PROFILE.nativeSymbol} CALL with ` +
        `empty calldata to the approved deployer, then set ` +
        `${MAINNET_PROFILE.safeAcceptanceTransactionEnvironmentName} to the outer hash.`,
    };
  }
  const evidence = await assertCanonicalSafeOperationalAcceptance({
    provider,
    chainId: MAINNET_CHAIN_ID,
    safeAddress,
    expectedTarget: config.expectedDeployer,
    transactionHash: config.acceptanceTransaction,
  });
  const finality = await waitForFinalizedTransactions({
    provider,
    transactions: {
      ownerOperationalAcceptance: {
        hash: evidence.transactionHash,
        receipt: evidence.receipt,
      },
    },
    timeoutMs: config.finalityTimeoutSeconds * 1_000,
  });
  if (BigInt(safeProfile.nonce) < 1n) {
    throw new Error("Operational acceptance passed but the current Safe nonce is still zero");
  }
  return {
    status: "passed",
    governanceReady: true,
    expectedTarget: config.expectedDeployer,
    ...evidence,
    finality,
  };
};

const revalidateCompletedSafe = async ({
  provider,
  config,
  checkpoint,
  intent,
  decodedSetup,
  sourceState,
  safeToolInputs,
  reportPath = REPORT_PATH,
  mode = config.mode,
}) => {
  assertCompletedCheckpointShape(checkpoint);
  assertSafeCreationCheckpointIntent({
    checkpoint,
    intent,
    predictedSafeAddress: checkpoint.safeAddress,
  });
  await revalidateCheckpointTransactions({
    provider,
    checkpoint,
    confirmations: config.confirmations,
    timeoutMs: TX_TIMEOUT_MS,
    maxCostWei: BigInt(checkpoint.fingerprint.executionPolicy.maximumCostWei),
    budgetEnvironmentName: MAINNET_PROFILE.safeMaximumCostEnvironmentName,
    nativeSymbol: CHAIN_PROFILE.nativeSymbol,
    gasChargingPolicy: MAINNET_PROFILE.gasChargingPolicy,
  });
  const finality = await waitForFinalizedTransactions({
    provider,
    transactions: checkpoint.transactions,
    timeoutMs: config.finalityTimeoutSeconds * 1_000,
  });
  if (
    Number(finality.lastCriticalBlock) !== Number(checkpoint.finality.lastCriticalBlock) ||
    finality.revalidatedTransactions[0]?.hash?.toLowerCase() !==
      checkpoint.transactions[TRANSACTION_LABEL].hash.toLowerCase()
  ) {
    throw new Error("Current finalized Safe deployment evidence differs from the checkpoint");
  }
  const deploymentEvidence = await inspectDeploymentEvidence({ provider, checkpoint, intent });
  let safeProfile = await assertCanonicalSafeProfile({
    provider,
    chainId: MAINNET_CHAIN_ID,
    safeAddress: checkpoint.safeAddress,
    expectedOwners: config.expectedSafeOwners,
  });
  const operationalAcceptance = await inspectOperationalAcceptance({
    provider,
    config,
    safeAddress: checkpoint.safeAddress,
    safeProfile,
  });
  if (operationalAcceptance.governanceReady) {
    safeProfile = await assertCanonicalSafeProfile({
      provider,
      chainId: MAINNET_CHAIN_ID,
      safeAddress: checkpoint.safeAddress,
      expectedOwners: config.expectedSafeOwners,
    });
  }
  const provenance = await writeSafeReport({
    checkpoint,
    config,
    sourceState,
    safeToolInputs,
    decodedSetup,
    safeProfile,
    deploymentEvidence,
    operationalAcceptance,
    reportPath,
    mode,
  });
  return { safeProfile, deploymentEvidence, operationalAcceptance, provenance };
};

const runStatus = async ({ connection, ethers, provider }) => {
  const statusEnv = {
    ...process.env,
    [MAINNET_PROFILE.safeConfirmationEnvironmentName]: "",
    [MAINNET_PROFILE.safePlanDigestEnvironmentName]: "",
    [MAINNET_PROFILE.safeRecoveryTransactionEnvironmentName]: "",
  };
  const network = await provider.getNetwork();
  const config = parseProductionMainnetSafeConfig({
    chainProfile: CHAIN_PROFILE,
    env: statusEnv,
    networkName: connection.networkName,
    chainId: network.chainId,
  });
  const [checkpoint, sourceState, safeToolInputs] = await Promise.all([
    readJsonIfExists(STATE_PATH),
    Promise.resolve(gitWorkingTreeState()),
    hashMainnetSafeInputs(ethers),
  ]);
  if (!checkpoint) {
    throw new Error(`No production Safe checkpoint exists at ${STATE_PATH}`);
  }
  assertMainnetSafePlanMatchesCheckpoint({
    checkpoint,
    fingerprint: checkpoint.fingerprint,
    planDigest: checkpoint.planDigest,
  });
  assertStatusConfigurationMatchesCheckpoint({ config, checkpoint });
  assertCompletedCheckpointShape(checkpoint);
  await assertExternallyOwnedControllers({ provider, config });
  const currentInfrastructure = await inspectCanonicalSafeInfrastructure({
    provider,
    chainId: MAINNET_CHAIN_ID,
  });
  if (
    canonicalMainnetSafePlanJson(currentInfrastructure) !==
    canonicalMainnetSafePlanJson(checkpoint.fingerprint.canonicalInfrastructure)
  ) {
    throw new Error("Current Canonical Safe infrastructure differs from the deployment checkpoint");
  }
  const deployerNonce = Number(checkpoint.fingerprint?.deployer?.nonce);
  if (!Number.isSafeInteger(deployerNonce) || deployerNonce < 0) {
    throw new Error("Mainnet Safe checkpoint contains an invalid deployer nonce");
  }
  const preparedSafe = await prepareCanonicalSafeDeployment({
    provider,
    chainId: MAINNET_CHAIN_ID,
    owners: config.expectedSafeOwners,
    saltNonce: config.saltNonce,
    allowAlreadyDeployed: true,
  });
  const { intent, predictedSafeAddress, decodedSetup } = buildAndValidateSafeCreationIntent({
    ethers,
    preparedSafe,
    expectedDeployer: config.expectedDeployer,
    deployerNonce,
    chainId: MAINNET_CHAIN_ID,
    orderedOwners: config.expectedSafeOwners,
    saltNonce: config.saltNonce,
    canonicalInfrastructure: currentInfrastructure,
  });
  if (!sameAddress(predictedSafeAddress, checkpoint.safeAddress)) {
    throw new Error(
      `Owner/salt configuration predicts Safe ${predictedSafeAddress}, not checkpoint Safe ` +
        checkpoint.safeAddress,
    );
  }
  const result = await revalidateCompletedSafe({
    provider,
    config,
    checkpoint,
    intent,
    decodedSetup,
    sourceState,
    safeToolInputs,
    mode: "status",
  });
  console.log(`${CHAIN_PROFILE.displayName} Mainnet Safe status revalidation passed:`);
  console.log(`  Safe:              ${checkpoint.safeAddress}`);
  console.log(`  version:           ${result.safeProfile.safeVersion}`);
  console.log(
    `  owners/threshold:  ${result.safeProfile.owners.length}/${result.safeProfile.threshold}`,
  );
  console.log(`  current nonce:     ${result.safeProfile.nonce}`);
  console.log(`  governance ready: ${result.operationalAcceptance.governanceReady ? "yes" : "no"}`);
  console.log(
    `  validator source: ${result.provenance.currentValidator.exactlyMatchesApprovedPlan ? "approved deployment version" : "different version (recorded in report)"}`,
  );
  console.log(`  report:            ${REPORT_PATH}`);
  if (!result.provenance.currentValidator.exactlyMatchesApprovedPlan) {
    console.log(
      "\nThe status validator does not exactly match the clean source used for deployment. " +
        "The report records both provenances; review the current commit and file digest.",
    );
  }
  if (!result.operationalAcceptance.governanceReady) {
    console.log("\nA deployed Safe is not yet proof that the real owners can sign.");
    console.log(
      `Have two owners execute a 0 ${CHAIN_PROFILE.nativeSymbol} / empty-data CALL to ` +
        `${config.expectedDeployer},`,
    );
    console.log(
      `set ${MAINNET_PROFILE.safeAcceptanceTransactionEnvironmentName} to that outer ` +
        `transaction hash, then rerun ${MAINNET_PROFILE.safeStatusCommand}.`,
    );
  }
};

export const main = async (chainProfile) => {
  configureChainProfile(chainProfile);
  const wrapperMode = await assertSafeCommandWrapper();
  if (wrapperMode === "run") {
    // Reject an incorrect or half-filled authorization pair before opening the configured RPC.
    parseMainnetSafeAuthorization(process.env, CHAIN_PROFILE);
  }

  const connection = await hre.network.connect();
  const { ethers } = connection;
  const provider = ethers.provider;
  await assertRawMainnetChain(provider);
  if (wrapperMode === "status") {
    await runStatus({ connection, ethers, provider });
    return;
  }

  const network = await provider.getNetwork();
  const config = parseProductionMainnetSafeConfig({
    chainProfile: CHAIN_PROFILE,
    env: process.env,
    networkName: connection.networkName,
    chainId: network.chainId,
  });
  const [sourceState, safeToolInputs, canonicalInfrastructure, existingCheckpoint] =
    await Promise.all([
      Promise.resolve(gitWorkingTreeState()),
      hashMainnetSafeInputs(ethers),
      inspectCanonicalSafeInfrastructure({
        provider,
        chainId: MAINNET_CHAIN_ID,
      }),
      readJsonIfExists(STATE_PATH),
    ]);
  if (!sourceState.clean) {
    throw new Error(
      `${CHAIN_PROFILE.displayName} mainnet Safe creation requires a clean Git working tree`,
    );
  }
  await assertExternallyOwnedControllers({ provider, config });

  const preparedSafe = await prepareCanonicalSafeDeployment({
    provider,
    chainId: MAINNET_CHAIN_ID,
    owners: config.expectedSafeOwners,
    saltNonce: config.saltNonce,
    allowAlreadyDeployed: existingCheckpoint !== null,
  });
  assertConfiguredSafeAddress(config.governanceMultisig, preparedSafe.safeAddress);

  const deployerNonce = existingCheckpoint
    ? Number(existingCheckpoint.fingerprint?.deployer?.nonce)
    : await provider.getTransactionCount(config.expectedDeployer, "pending");
  if (!Number.isSafeInteger(deployerNonce) || deployerNonce < 0) {
    throw new Error("Safe deployer nonce is invalid");
  }
  const { intent, predictedSafeAddress, decodedSetup } = buildAndValidateSafeCreationIntent({
    ethers,
    preparedSafe,
    expectedDeployer: config.expectedDeployer,
    deployerNonce,
    chainId: MAINNET_CHAIN_ID,
    orderedOwners: config.expectedSafeOwners,
    saltNonce: config.saltNonce,
    canonicalInfrastructure,
  });
  const fingerprint = buildMainnetSafePlanFingerprint({
    config,
    releaseCommit: sourceState.commit,
    safeToolInputs,
    deployerNonce,
    predictedSafeAddress,
    deploymentTransaction: preparedSafe.deploymentTransaction,
    canonicalInfrastructure,
  });
  const planDigest = deriveMainnetSafePlanDigest(fingerprint);
  if (existingCheckpoint) {
    assertMainnetSafePlanMatchesCheckpoint({
      checkpoint: existingCheckpoint,
      fingerprint,
      planDigest,
    });
    assertSafeCreationCheckpointIntent({
      checkpoint: existingCheckpoint,
      intent,
      predictedSafeAddress,
    });
    assertRecoveryClaim(existingCheckpoint, config);
  } else if (config.recoveryTransaction) {
    throw new Error(
      `${MAINNET_PROFILE.safeRecoveryTransactionEnvironmentName} requires an existing hashless ` +
        "planned checkpoint",
    );
  }

  const predictedCode = await provider.getCode(predictedSafeAddress);
  if (!existingCheckpoint) {
    if (predictedCode !== "0x") {
      throw new Error(
        `Predicted Safe ${predictedSafeAddress} already has code, but no creator checkpoint ` +
          "exists. Refusing to adopt an unmanaged deployment.",
      );
    }
    await simulateFactoryCreation({
      ethers,
      provider,
      expectedDeployer: config.expectedDeployer,
      preparedSafe,
    });
  } else {
    const entry = existingCheckpoint.transactions[TRANSACTION_LABEL];
    if (
      predictedCode !== "0x" &&
      entry.status === "planned" &&
      !entry.hash &&
      !config.recoveryTransaction
    ) {
      throw new Error(
        "The predicted Safe now has code while its checkpoint has no transaction hash. " +
          `Supply the independently verified original hash in ` +
          `${MAINNET_PROFILE.safeRecoveryTransactionEnvironmentName}.`,
      );
    }
    if (["confirmed", "finalized"].includes(entry.status) && predictedCode === "0x") {
      throw new Error("Confirmed Safe deployment checkpoint has no proxy runtime code");
    }
  }

  if (config.mode === "plan") {
    if (existingCheckpoint && existingCheckpoint.status !== "passed") {
      throw new Error(
        `An incomplete Safe deployment checkpoint (${existingCheckpoint.status}/` +
          `${existingCheckpoint.phase}) already exists at ${STATE_PATH}. Blank authorization ` +
          "cannot create a new plan or claim that no transaction was broadcast. Review the " +
          "checkpoint and resume it with its approved digest and confirmation; use the documented " +
          "recovery hash flow when the planned transaction hash was not persisted.",
      );
    }
    const plan = existingCheckpoint ?? {
      schemaVersion: MAINNET_SAFE_STATE_SCHEMA_VERSION,
      status: "planned",
      phase: "preflight",
      planDigest,
      fingerprint,
      safeAddress: predictedSafeAddress,
      addresses: {
        deployer: config.expectedDeployer,
        governanceSafe: predictedSafeAddress,
      },
      transactions: {},
      finality: { status: "not-started" },
      terminalProfile: { status: "not-started" },
    };
    if (existingCheckpoint?.status === "passed") {
      const completed = await revalidateCompletedSafe({
        provider,
        config,
        checkpoint: existingCheckpoint,
        intent,
        decodedSetup,
        sourceState,
        safeToolInputs,
        reportPath: PLAN_REPORT_PATH,
        mode: "plan",
      });
      console.log(
        `${CHAIN_PROFILE.displayName} Mainnet Safe is already deployed; read-only ` +
          "revalidation passed:",
      );
      console.log(`  Safe:              ${predictedSafeAddress}`);
      console.log(
        `  governance ready: ${completed.operationalAcceptance.governanceReady ? "yes" : "no"}`,
      );
      console.log(`  report:            ${PLAN_REPORT_PATH}`);
      return;
    }
    await writeSafeReport({
      checkpoint: plan,
      config,
      sourceState,
      safeToolInputs,
      decodedSetup,
      reportPath: PLAN_REPORT_PATH,
      mode: "plan",
    });
    console.log(
      `${CHAIN_PROFILE.displayName} Mainnet Safe creation plan passed ` +
        "(no transaction was broadcast):",
    );
    console.log(`  deployer:       ${config.expectedDeployer}`);
    console.log(`  ordered owners: ${config.expectedSafeOwners.join(", ")}`);
    console.log(`  threshold:      2 of 3`);
    console.log(`  salt nonce:     ${config.saltNonce}`);
    console.log(`  predicted Safe: ${predictedSafeAddress}`);
    console.log(`  maximum budget: ${config.maximumCost} ${CHAIN_PROFILE.nativeSymbol}`);
    console.log(`  plan digest:    ${planDigest}`);
    console.log(`  report:         ${PLAN_REPORT_PATH}`);
    console.log("\nAfter independent review, deploy or resume with:");
    console.log(
      `  ${MAINNET_PROFILE.safePlanDigestEnvironmentName}=${planDigest} ` +
        `${MAINNET_PROFILE.safeConfirmationEnvironmentName}=${MAINNET_PROFILE.safeConfirmation} ` +
        MAINNET_PROFILE.safeCommand,
    );
    return;
  }

  if (config.configuredPlanDigest !== planDigest.toLowerCase()) {
    throw new Error(
      `${MAINNET_PROFILE.safePlanDigestEnvironmentName} does not match the current reviewed ` +
        "Safe plan",
    );
  }
  if (existingCheckpoint?.status === "passed") {
    const completed = await revalidateCompletedSafe({
      provider,
      config,
      checkpoint: existingCheckpoint,
      intent,
      decodedSetup,
      sourceState,
      safeToolInputs,
    });
    console.log(
      `${CHAIN_PROFILE.displayName} Mainnet Safe is already complete; read-only revalidation ` +
        "passed:",
    );
    console.log(`  Safe:              ${predictedSafeAddress}`);
    console.log(
      `  governance ready: ${completed.operationalAcceptance.governanceReady ? "yes" : "no"}`,
    );
    console.log(`  state:             ${STATE_PATH}`);
    console.log(`  report:            ${REPORT_PATH}`);
    return;
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No Safe deployment signer is configured; set PRIVATE_KEY");
  const deployerAddress = ethers.getAddress(await deployer.getAddress());
  if (!sameAddress(deployerAddress, config.expectedDeployer)) {
    throw new Error(
      `Configured signer ${deployerAddress} does not match ` +
        `${MAINNET_PROFILE.expectedDeployerEnvironmentName} ${config.expectedDeployer}`,
    );
  }
  const deployerBalance = await provider.getBalance(deployerAddress);
  if (deployerBalance < config.maximumCostWei) {
    throw new Error(
      `Safe deployer balance ${formatEther(deployerBalance)} ${CHAIN_PROFILE.nativeSymbol} is ` +
        `below the approved ${MAINNET_PROFILE.safeMaximumCostEnvironmentName} ceiling ` +
        `${config.maximumCost} ${CHAIN_PROFILE.nativeSymbol}`,
    );
  }

  const releaseLock = await acquireReleaseLock(
    LOCK_PATH,
    {
      chainId: MAINNET_CHAIN_ID.toString(),
      planDigest,
      deployer: deployerAddress,
      predictedSafeAddress,
    },
    `${CHAIN_PROFILE.displayName} mainnet Safe`,
  );
  let checkpoint = existingCheckpoint;
  try {
    const lockedCheckpoint = await readJsonIfExists(STATE_PATH);
    if (!checkpoint && lockedCheckpoint) {
      throw new Error(
        "Safe checkpoint appeared during preflight; restart so its state is revalidated",
      );
    }
    if (checkpoint && !lockedCheckpoint) {
      throw new Error("Safe checkpoint disappeared during preflight; refusing to recreate it");
    }
    if (lockedCheckpoint) {
      assertMainnetSafePlanMatchesCheckpoint({
        checkpoint: lockedCheckpoint,
        fingerprint,
        planDigest,
      });
      assertSafeCreationCheckpointIntent({
        checkpoint: lockedCheckpoint,
        intent,
        predictedSafeAddress,
      });
      assertRecoveryClaim(lockedCheckpoint, config);
      const lockedEntry = lockedCheckpoint.transactions[TRANSACTION_LABEL];
      if (
        lockedEntry.status === "planned" &&
        !lockedEntry.hash &&
        !config.recoveryTransaction &&
        (await provider.getCode(predictedSafeAddress)) !== "0x"
      ) {
        throw new Error(
          "The predicted Safe acquired code after preflight while its checkpoint still has no " +
            "transaction hash. Supply the independently verified original hash in " +
            `${MAINNET_PROFILE.safeRecoveryTransactionEnvironmentName}.`,
        );
      }
      checkpoint = lockedCheckpoint;
    } else {
      if ((await provider.getCode(predictedSafeAddress)) !== "0x") {
        throw new Error("Predicted Safe acquired code before checkpoint creation");
      }
      const pendingNonce = await provider.getTransactionCount(deployerAddress, "pending");
      if (pendingNonce !== deployerNonce) {
        throw new Error(
          `Safe deployer nonce changed from approved ${deployerNonce} to ${pendingNonce}`,
        );
      }
      await simulateFactoryCreation({
        ethers,
        provider,
        expectedDeployer: config.expectedDeployer,
        preparedSafe,
      });
      checkpoint = {
        schemaVersion: MAINNET_SAFE_STATE_SCHEMA_VERSION,
        status: "running",
        phase: "factory-deployment",
        planDigest,
        fingerprint,
        safeAddress: predictedSafeAddress,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        addresses: {
          deployer: deployerAddress,
          governanceSafe: predictedSafeAddress,
        },
        decodedSetup,
        transactions: {},
        finality: { status: "not-started" },
        terminalProfile: { status: "not-started" },
        ownerOperationalAcceptance: {
          status: "pending",
          governanceReady: false,
        },
        error: null,
      };
    }

    checkpoint.status = "running";
    checkpoint.error = null;
    const saveCheckpoint = async () => {
      checkpoint.updatedAt = nowIso();
      await writeJsonAtomic(STATE_PATH, checkpoint);
    };
    const transactionExecutor = createCheckpointedTransactionExecutor({
      provider,
      signer: deployer,
      checkpoint,
      saveCheckpoint,
      maxCostWei: config.maximumCostWei,
      recoveryTransactions: recoveryTransactionsFor(config),
      expectedNonces: { [TRANSACTION_LABEL]: deployerNonce },
      expectedIntents: [intent],
      budgetEnvironmentName: MAINNET_PROFILE.safeMaximumCostEnvironmentName,
      recoveryEnvironmentName: MAINNET_PROFILE.safeRecoveryTransactionEnvironmentName,
      nativeSymbol: CHAIN_PROFILE.nativeSymbol,
      gasChargingPolicy: MAINNET_PROFILE.gasChargingPolicy,
    });
    const currentEntry = checkpoint.transactions[TRANSACTION_LABEL];
    if (currentEntry?.status === "planned" && !currentEntry.hash && !config.recoveryTransaction) {
      if ((await provider.getCode(predictedSafeAddress)) !== "0x") {
        throw new Error(
          "The predicted Safe acquired code immediately before factory broadcast. Supply the " +
            `independently verified original hash in ` +
            `${MAINNET_PROFILE.safeRecoveryTransactionEnvironmentName}.`,
        );
      }
      await simulateFactoryCreation({
        ethers,
        provider,
        expectedDeployer: config.expectedDeployer,
        preparedSafe,
      });
    }
    const receipt = await transactionExecutor({
      label: TRANSACTION_LABEL,
      kind: "call",
      transactionRequest: preparedSafe.deploymentTransaction,
      transactionConfirmations: config.confirmations,
      transactionTimeoutMs: TX_TIMEOUT_MS,
    });
    assertSafeCreationCheckpointIntent({
      checkpoint,
      intent,
      predictedSafeAddress,
    });
    const transaction = await provider.getTransaction(
      checkpoint.transactions[TRANSACTION_LABEL].hash,
    );
    const deploymentEvidence = assertCanonicalSafeDeploymentReceipt({
      receipt,
      transaction,
      chainId: MAINNET_CHAIN_ID,
      expectedDeployer: deployerAddress,
      expectedNonce: deployerNonce,
      expectedSafeAddress: predictedSafeAddress,
      expectedDeploymentTransaction: preparedSafe.deploymentTransaction,
    });
    checkpoint.deploymentEvidence = deploymentEvidence;
    checkpoint.terminalProfile = {
      status: "pre-finality-passed",
      ...(await assertCanonicalSafeProfile({
        provider,
        chainId: MAINNET_CHAIN_ID,
        safeAddress: predictedSafeAddress,
        expectedOwners: config.expectedSafeOwners,
        expectedNonce: 0n,
      })),
    };
    await saveCheckpoint();

    checkpoint.phase = "chain-finality";
    await saveCheckpoint();
    checkpoint.finality = await waitForFinalizedTransactions({
      provider,
      transactions: checkpoint.transactions,
      timeoutMs: config.finalityTimeoutSeconds * 1_000,
    });
    checkpoint.transactions[TRANSACTION_LABEL].status = "finalized";
    await saveCheckpoint();

    await revalidateCheckpointTransactions({
      provider,
      checkpoint,
      confirmations: config.confirmations,
      timeoutMs: TX_TIMEOUT_MS,
      maxCostWei: config.maximumCostWei,
      budgetEnvironmentName: MAINNET_PROFILE.safeMaximumCostEnvironmentName,
      nativeSymbol: CHAIN_PROFILE.nativeSymbol,
      gasChargingPolicy: MAINNET_PROFILE.gasChargingPolicy,
      saveCheckpoint,
    });
    checkpoint.deploymentEvidence = await inspectDeploymentEvidence({
      provider,
      checkpoint,
      intent,
    });
    checkpoint.terminalProfile = {
      status: "passed",
      ...(await assertCanonicalSafeProfile({
        provider,
        chainId: MAINNET_CHAIN_ID,
        safeAddress: predictedSafeAddress,
        expectedOwners: config.expectedSafeOwners,
        expectedNonce: 0n,
      })),
    };
    const [finishedSourceState, finishedSafeToolInputs] = await Promise.all([
      Promise.resolve(gitWorkingTreeState()),
      hashMainnetSafeInputs(ethers),
    ]);
    if (
      !finishedSourceState.clean ||
      finishedSourceState.commit !== sourceState.commit ||
      finishedSafeToolInputs.digest !== safeToolInputs.digest
    ) {
      throw new Error("Safe creator source inputs changed while deployment was running");
    }

    checkpoint.status = "passed";
    checkpoint.phase = "complete";
    checkpoint.completedAt ??= nowIso();
    checkpoint.error = null;
    await saveCheckpoint();
    const safeProfile = await assertCanonicalSafeProfile({
      provider,
      chainId: MAINNET_CHAIN_ID,
      safeAddress: predictedSafeAddress,
      expectedOwners: config.expectedSafeOwners,
    });
    const operationalAcceptance = await inspectOperationalAcceptance({
      provider,
      config,
      safeAddress: predictedSafeAddress,
      safeProfile,
    });
    await writeSafeReport({
      checkpoint,
      config,
      sourceState,
      safeToolInputs,
      decodedSetup,
      safeProfile,
      deploymentEvidence: checkpoint.deploymentEvidence,
      operationalAcceptance,
    });
    console.log(
      `${CHAIN_PROFILE.displayName} Mainnet Canonical Safe deployment completed successfully:`,
    );
    console.log(`  Safe:              ${predictedSafeAddress}`);
    console.log(`  owners/threshold:  3/2`);
    console.log(`  transaction:       ${checkpoint.transactions[TRANSACTION_LABEL].hash}`);
    console.log(`  state:             ${STATE_PATH}`);
    console.log(`  report:            ${REPORT_PATH}`);
    console.log(`\nSet GOVERNANCE_MULTISIG=${predictedSafeAddress} after independent review.`);
    if (!operationalAcceptance.governanceReady) {
      console.log(
        `Before protocol release, two real owners must execute the documented 0 ` +
          `${CHAIN_PROFILE.nativeSymbol} smoke ` +
          "transaction and its outer hash must be verified with " +
          `${MAINNET_PROFILE.safeStatusCommand}.`,
      );
    }
  } catch (error) {
    if (checkpoint && checkpoint.status !== "passed") {
      checkpoint.status = "paused";
      checkpoint.failedPhase = checkpoint.phase;
      checkpoint.error = publicSafeCreatorError(error);
      checkpoint.updatedAt = nowIso();
      if (Object.keys(checkpoint.transactions ?? {}).length > 0) {
        await writeJsonAtomic(STATE_PATH, checkpoint);
      }
      await writeSafeReport({
        checkpoint,
        config,
        sourceState,
        safeToolInputs,
        decodedSetup,
        safeProfile: null,
        deploymentEvidence: checkpoint.deploymentEvidence ?? null,
      });
    }
    throw error;
  } finally {
    await releaseLock();
  }
};
