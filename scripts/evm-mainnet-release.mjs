import fs from "node:fs/promises";
import path from "node:path";
import { formatEther } from "ethers";

/**
 * Shared guarded EVM Mainnet initial-release orchestrator.
 *
 * Public eSpace and Ethereum entry files select an immutable profile and document their exact
 * plan and execute/resume commands. Do not invoke this shared engine directly. It never creates a
 * Safe or reads Safe-owner keys; complete the profile-specific Safe bootstrap and real-owner
 * acceptance before using the corresponding release entry.
 */

import hre from "hardhat";

import { deployIntegratedSystem } from "../hardhat/integratedDeployment.mjs";
import { assertImplementationMatchesArtifact } from "../tasks/lib/timelockUpgrade.mjs";
import { readExactTimelockRoleState } from "../tasks/lib/timelockMultisigMigration.mjs";
import { verifyAcceptanceContracts } from "./lib/acceptanceVerification.mjs";
import {
  MAINNET_STATE_SCHEMA_VERSION,
  MAINNET_TRANSACTION_LABELS,
  assertMainnetReleaseSafeAcceptanceNonce,
  assertPlanMatchesCheckpoint,
  buildMainnetPlanApprovalMessage,
  deriveMainnetPlanDigest,
  parseProductionMainnetReleaseConfig,
  parseMainnetAuthorization,
  verifyMainnetPlanApprovals,
} from "./lib/mainnetReleaseSafety.mjs";
import {
  acquireReleaseLock,
  createCheckpointedTransactionExecutor,
  readJsonIfExists,
  revalidateCheckpointTransactions,
  writeJsonAtomic,
} from "./lib/mainnetReleaseState.mjs";
import {
  buildMainnetReleaseIntents,
  deriveMainnetReleaseIntentsDigest,
} from "./lib/mainnetReleaseIntents.mjs";
import {
  gitWorkingTreeState,
  hashReleaseInputs,
  readProductionBuildInfoState,
  verificationEntry,
  waitForFinalizedTransactions,
} from "./lib/releaseEvidence.mjs";
import {
  assertCanonicalSafeOperationalAcceptance,
  assertCanonicalSafeProfile,
} from "./lib/safeGovernance.mjs";
import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { resolveProductionPtauPath } from "./lib/productionPtau.mjs";
import { inspectZkReleaseArtifacts } from "./lib/zkArtifactTrust.mjs";
import { validateTestnetReleaseEvidence } from "./lib/testnetReleaseEvidence.mjs";
import { verifyProductionCeremony } from "./zk-ceremony-verify.mjs";

const TX_TIMEOUT_MS = 10 * 60 * 1000;
const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
let CHAIN_PROFILE = ESPACE_CHAIN_PROFILE;
let MAINNET_PROFILE = CHAIN_PROFILE.mainnet;
let MAINNET_CHAIN_ID = MAINNET_PROFILE.chainId;
let DEPLOYMENTS_DIRECTORY = path.join(
  process.cwd(),
  "deployments",
  MAINNET_PROFILE.deploymentDirectoryName,
);
let STATE_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-release-state.json");
let PLAN_REPORT_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-release-plan.json");
let REPORT_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-release-report.json");
let LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-release.lock");
let SHARED_COMMAND_LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-command.lock");
let COMMAND_LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-release-command.lock");
let WRAPPER_TOKEN_ENV = MAINNET_PROFILE.releaseWrapperTokenEnvironmentName;
let WRAPPER_MODE_ENV = MAINNET_PROFILE.releaseWrapperModeEnvironmentName;
let SHARED_WRAPPER_TOKEN_ENV = MAINNET_PROFILE.sharedWrapperTokenEnvironmentName;

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
  STATE_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-release-state.json");
  PLAN_REPORT_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-release-plan.json");
  REPORT_PATH = path.join(DEPLOYMENTS_DIRECTORY, "mainnet-release-report.json");
  LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-release.lock");
  SHARED_COMMAND_LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-command.lock");
  COMMAND_LOCK_PATH = path.join(DEPLOYMENTS_DIRECTORY, ".mainnet-release-command.lock");
  WRAPPER_TOKEN_ENV = MAINNET_PROFILE.releaseWrapperTokenEnvironmentName;
  WRAPPER_MODE_ENV = MAINNET_PROFILE.releaseWrapperModeEnvironmentName;
  SHARED_WRAPPER_TOKEN_ENV = MAINNET_PROFILE.sharedWrapperTokenEnvironmentName;
};
const CORE_DEPLOYMENT_FILES = [
  "GovernanceTimelock.json",
  "DeepFamilyToken.json",
  "PoseidonT5.json",
  "AdultAgeGate.json",
  "PersonCommitmentVerifier.json",
  "DisclosureBindingVerifier.json",
  "Groth16VerifierAdapter.json",
  "DeepFamily.json",
  "DeepFamilyReader.json",
];
const RELEASE_ARTIFACT_NAMES = Object.freeze([
  "GovernanceTimelock",
  "DeepFamilyToken",
  "PoseidonT5",
  "AdultAgeGate",
  "PersonCommitmentVerifier",
  "DisclosureBindingVerifier",
  "Groth16VerifierAdapter",
  "DeepFamily",
  "UUPSProxy",
  "DeepFamilyReader",
]);

const nowIso = () => new Date().toISOString();
const sameAddress = (left, right) =>
  String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();

export const publicError = (error) => {
  let message = String(error?.shortMessage || error?.reason || error?.message || error || "error");
  for (const [name, replacement] of [
    ["PRIVATE_KEY", "[REDACTED_PRIVATE_KEY]"],
    ["CONFLUX_RPC_URL", "[REDACTED_RPC_URL]"],
    ["ETHEREUM_MAINNET_RPC_URL", "[REDACTED_RPC_URL]"],
    ["INFURA_API_KEY", "[REDACTED_INFURA_KEY]"],
    ["EXPLORER_API_KEY", "[REDACTED_EXPLORER_KEY]"],
  ]) {
    const secret = String(process.env[name] ?? "");
    if (secret.length >= 4) message = message.split(secret).join(replacement);
  }
  return message.replace(/0x[0-9a-fA-F]{130,}/g, "[redacted-calldata]").slice(0, 4_000);
};

const assertReleaseCommandWrapper = async () => {
  const expectedToken = String(process.env[WRAPPER_TOKEN_ENV] ?? "").trim();
  const expectedSharedToken = String(process.env[SHARED_WRAPPER_TOKEN_ENV] ?? "").trim();
  if (expectedToken === "" || expectedSharedToken === "") {
    throw new Error(
      `Use ${MAINNET_PROFILE.releasePlanCommand} or ` +
        `${MAINNET_PROFILE.releaseExecuteCommand}; direct script execution is forbidden`,
    );
  }
  const [commandLock, sharedCommandLock] = await Promise.all([
    readJsonIfExists(COMMAND_LOCK_PATH),
    readJsonIfExists(SHARED_COMMAND_LOCK_PATH),
  ]);
  if (!commandLock || commandLock.token !== expectedToken) {
    throw new Error("Mainnet release command wrapper lock is missing or does not match");
  }
  if (!sharedCommandLock || sharedCommandLock.token !== expectedSharedToken) {
    throw new Error("Shared mainnet command wrapper lock is missing or does not match");
  }
  const mode = String(process.env[WRAPPER_MODE_ENV] ?? "").trim();
  if (mode !== "plan" && mode !== "execute") {
    throw new Error("Mainnet release command wrapper mode is invalid");
  }
  return mode;
};

const assertRecoveryClaims = (checkpoint, recoveryTransactions) => {
  const labels = Object.keys(recoveryTransactions);
  if (labels.length === 0) return;
  if (!checkpoint) {
    throw new Error("--recovery-file requires an existing release checkpoint");
  }
  for (const label of labels) {
    const transaction = checkpoint.transactions?.[label];
    if (!transaction || transaction.status !== "planned" || transaction.hash) {
      throw new Error(
        `Recovery hash for ${label} is unnecessary or does not match a hashless planned step`,
      );
    }
  }
};

const assertNoUnmanagedDeployment = async () => {
  const found = [];
  for (const file of CORE_DEPLOYMENT_FILES) {
    try {
      await fs.access(path.join(DEPLOYMENTS_DIRECTORY, file));
      found.push(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (found.length > 0) {
    throw new Error(
      `Found production deployment metadata without a mainnet release checkpoint ` +
        `(${found.join(", ")}). Refusing to adopt or overwrite it automatically.`,
    );
  }
};

const buildFingerprint = ({
  config,
  sourceState,
  releaseInputs,
  buildState,
  safeProfile,
  safeOperationalAcceptance,
  deployerNonce,
  plannedAddresses,
  expectedNonces,
  releaseIntents,
  releaseIntentsDigest,
  zkArtifactTrust,
  zkCeremonyVerification,
  testnetReleaseEvidence,
}) => ({
  schemaVersion: MAINNET_STATE_SCHEMA_VERSION,
  domain: MAINNET_PROFILE.releasePlanDigestDomain,
  chainProfileId: CHAIN_PROFILE.id,
  network: { name: config.networkName, chainId: config.chainId },
  releaseCommit: sourceState.commit,
  releaseInputDigest: releaseInputs.digest,
  artifactDigest: releaseInputs.directories.artifacts.digest,
  zkArtifacts: {
    manifestPath: zkArtifactTrust.manifestPath,
    manifestSha256: zkArtifactTrust.manifestSha256,
    circomVersion: zkArtifactTrust.circomVersion,
    snarkjsVersion: zkArtifactTrust.snarkjsVersion,
    trustedSetupStatus: zkArtifactTrust.trustedSetupStatus,
    trustModel: zkArtifactTrust.trustModel,
    trustWarning: zkArtifactTrust.trustWarning,
    productionReady: zkArtifactTrust.productionReady,
    ceremonyId: zkArtifactTrust.ceremonyId,
    contributorCount: zkArtifactTrust.contributorCount,
    minimumContributors: zkArtifactTrust.minimumContributors,
    phase1Source: zkArtifactTrust.phase1Source,
    phase1Bytes: zkArtifactTrust.phase1Bytes,
    phase1Sha256: zkArtifactTrust.phase1Sha256,
    phase1Blake2b512: zkArtifactTrust.phase1Blake2b512,
    beaconApplied: zkArtifactTrust.beaconApplied,
    transcriptSha256: zkArtifactTrust.transcriptSha256,
    artifacts: zkArtifactTrust.artifacts,
    ceremonyVerification: {
      status: zkCeremonyVerification.status,
      ceremonyId: zkCeremonyVerification.ceremonyId,
      manifestSha256: zkCeremonyVerification.manifestSha256,
      transcriptSha256: zkCeremonyVerification.transcriptSha256,
      trustModel: zkCeremonyVerification.trustModel,
      contributorCount: zkCeremonyVerification.contributorCount,
      minimumContributors: zkCeremonyVerification.minimumContributors,
      ptauSha256: zkCeremonyVerification.ptau.sha256,
      ptauBlake2b512: zkCeremonyVerification.ptau.blake2b512,
    },
  },
  testnetReleaseEvidence: testnetReleaseEvidence.publicSummary,
  buildInfo: {
    productionSettingsMatched: buildState.productionSettingsMatched,
    sourceContentsMatched: buildState.sourceContentsMatched,
    sourceInputDigest: buildState.sourceInputDigest,
    buildInfoOutputsMatched: buildState.buildInfoOutputsMatched,
    buildInfoOutputDigest: buildState.buildInfoOutputDigest,
    artifactProvenanceMatched: buildState.artifactProvenanceMatched,
    artifactProvenance: buildState.artifactProvenance,
    compilerJobs: buildState.compilerJobs.map((job) => ({
      file: job.file,
      digest: job.digest,
      solcVersion: job.solcVersion,
      optimizer: job.optimizer,
      evmVersion: job.evmVersion,
      viaIR: job.viaIR,
      sourceSetDigest: job.sourceSetDigest,
    })),
  },
  deployer: config.expectedDeployer,
  deployerNonce,
  timelock: {
    address: plannedAddresses.timelock,
    constructorArgs: [config.minDelaySeconds, config.governanceMultisig],
    minimumDelaySeconds: config.minDelaySeconds,
  },
  protocolDeployment: {
    addresses: plannedAddresses,
    constructorRelationships: {
      groth16VerifierAdapter: [
        plannedAddresses.personCommitmentVerifier,
        plannedAddresses.disclosureBindingVerifier,
      ],
      deepFamilyImplementationLibraries: {
        PoseidonT5: plannedAddresses.poseidonT5,
        AdultAgeGate: plannedAddresses.adultAgeGate,
      },
      deepFamilyProxyInitializer: {
        token: plannedAddresses.token,
        initialOwner: config.expectedDeployer,
      },
      deepFamilyReader: [plannedAddresses.deepFamily],
    },
  },
  governanceSafe: {
    address: config.governanceMultisig,
    owners: [...config.expectedSafeOwners].sort((a, b) => a.localeCompare(b)),
    threshold: safeProfile.threshold,
    nonce: safeProfile.nonce,
    profile: config.governanceMultisigProfile,
    version: safeProfile.safeVersion,
    singleton: safeProfile.singleton,
    fallbackHandler: safeProfile.fallbackHandler,
    proxyCodeHash: safeProfile.proxyCodeHash,
    canonicalProxyCodeHash: safeProfile.canonicalProxyCodeHash,
    componentCodeHashes: safeProfile.componentCodeHashes,
    modules: safeProfile.modules,
    guard: safeProfile.guard,
    operationalAcceptance: safeOperationalAcceptance,
  },
  executionPolicy: {
    confirmations: config.confirmations,
    finalityTimeoutSeconds: config.finalityTimeoutSeconds,
    finalityRequired: true,
    explorerVerificationRequired: true,
    nativeSymbol: CHAIN_PROFILE.nativeSymbol,
    gasChargingPolicy: MAINNET_PROFILE.gasChargingPolicy,
    maximumCostWei: config.maximumCostWei,
    transactionNonces: expectedNonces,
    transactionIntentsDigest: releaseIntentsDigest,
    transactionIntents: releaseIntents.map(({ data: _data, ...intent }) => intent),
  },
});

const derivePlannedAddresses = ({ ethers, deployer, startingNonce }) => {
  const labels = [
    "timelock",
    "token",
    "poseidonT5",
    "adultAgeGate",
    "personCommitmentVerifier",
    "disclosureBindingVerifier",
    "groth16VerifierAdapter",
    "deepFamilyImplementation",
    "deepFamily",
    "deepFamilyReader",
  ];
  return Object.fromEntries(
    labels.map((label, index) => [
      label,
      ethers.getCreateAddress({ from: deployer, nonce: startingNonce + index }),
    ]),
  );
};

const deriveExpectedNonces = (startingNonce) =>
  Object.fromEntries(
    MAINNET_TRANSACTION_LABELS.map((label, index) => [label, startingNonce + index]),
  );

const assertProductionControllersAreEoas = async ({ provider, config }) => {
  const controllers = [
    [MAINNET_PROFILE.expectedDeployerEnvironmentName, config.expectedDeployer],
    ...config.expectedSafeOwners.map((owner, index) => [`Safe owner ${index + 1}`, owner]),
  ];
  for (const [label, address] of controllers) {
    if ((await provider.getCode(address)) !== "0x") {
      throw new Error(
        `${label} ${address} has deployed code. The pinned production profile supports ` +
          "independent EOA/hardware-wallet controllers only.",
      );
    }
  }
};

const assertFinalizedSafeOperationalAcceptance = async ({ provider, config, safeProfile }) => {
  const evidence = await assertCanonicalSafeOperationalAcceptance({
    provider,
    chainId: MAINNET_CHAIN_ID,
    safeAddress: config.governanceMultisig,
    expectedTarget: config.expectedDeployer,
    transactionHash: config.safeAcceptanceTransaction,
  });
  const finality = await waitForFinalizedTransactions({
    provider,
    transactions: {
      safeOwnerOperationalAcceptance: {
        hash: evidence.transactionHash,
        receipt: evidence.receipt,
      },
    },
    timeoutMs: config.finalityTimeoutSeconds * 1_000,
  });
  assertMainnetReleaseSafeAcceptanceNonce(safeProfile.nonce);
  await assertCanonicalSafeProfile({
    provider,
    chainId: MAINNET_CHAIN_ID,
    safeAddress: config.governanceMultisig,
    expectedOwners: config.expectedSafeOwners,
    expectedNonce: safeProfile.nonce,
  });
  return {
    evidence: {
      status: "passed",
      transactionHash: evidence.transactionHash,
      safeTxHash: evidence.safeTxHash,
      safeAddress: evidence.safeAddress,
      relayer: evidence.relayer,
      innerTarget: evidence.innerTarget,
      operation: evidence.operation,
      value: evidence.value,
      data: evidence.data,
      safeTxGas: evidence.safeTxGas,
      baseGas: evidence.baseGas,
      gasPrice: evidence.gasPrice,
      gasToken: evidence.gasToken,
      refundReceiver: evidence.refundReceiver,
      payment: evidence.payment,
      receiptBlockNumber: evidence.receipt.blockNumber,
      receiptBlockHash: evidence.receipt.blockHash,
    },
    finality,
  };
};

const assertTimelock = async ({ connection, ethers, timelock, address, config }) => {
  await assertImplementationMatchesArtifact({
    connection,
    ethers,
    hre,
    contractName: "GovernanceTimelock",
    implementation: address,
    spec: { needsLibraries: false },
  });
  const [minDelay, roleState] = await Promise.all([
    timelock.getMinDelay(),
    readExactTimelockRoleState({ ethers, timelock, timelockAddress: address }),
  ]);
  if (minDelay !== BigInt(config.minDelaySeconds)) {
    throw new Error(`GovernanceTimelock delay=${minDelay}; expected ${config.minDelaySeconds}`);
  }
  if (!sameAddress(roleState.currentMultisig, config.governanceMultisig)) {
    throw new Error(
      `GovernanceTimelock role holder=${roleState.currentMultisig}; expected ` +
        config.governanceMultisig,
    );
  }
  return { minDelay, roleState };
};

const writeTimelockDeployment = async ({ address, config }) => {
  const artifact = await hre.artifacts.readArtifact("GovernanceTimelock");
  await writeJsonAtomic(path.join(DEPLOYMENTS_DIRECTORY, "GovernanceTimelock.json"), {
    address,
    constructorArgs: [config.minDelaySeconds, config.governanceMultisig],
    abi: artifact.abi,
  });
};

const verifyContracts = async ({ entries, checkpoint, saveCheckpoint }) => {
  checkpoint.phase = "explorer-verification";
  checkpoint.verification = { status: "running", contracts: [] };
  await saveCheckpoint();
  try {
    checkpoint.verification.contracts = await verifyAcceptanceContracts({
      hre,
      entries,
      timeoutMs: 15 * 60 * 1000,
      attemptTimeoutMs: 2 * 60 * 1000,
      retries: 2,
      logger: console,
      verificationProvider: MAINNET_PROFILE.verificationProvider,
      explorerName: MAINNET_PROFILE.explorerName,
    });
    checkpoint.verification.status = "passed";
    await saveCheckpoint();
  } catch (error) {
    checkpoint.verification.status = "pending-retry";
    checkpoint.verification.contracts = Array.isArray(error.results) ? error.results : [];
    checkpoint.verification.error = publicError(error);
    await saveCheckpoint();
    throw error;
  }
};

const implementationAddress = async (ethers, provider, proxyAddress) => {
  const raw = await provider.getStorage(proxyAddress, ERC1967_IMPLEMENTATION_SLOT);
  return ethers.getAddress(ethers.dataSlice(raw, 12));
};

const assertProtocolTerminalState = async ({
  connection,
  ethers,
  config,
  safeProfile,
  timelock,
  timelockAddress,
  deployed,
  addresses,
  checkpoint,
}) => {
  await assertCanonicalSafeProfile({
    provider: ethers.provider,
    chainId: MAINNET_CHAIN_ID,
    safeAddress: config.governanceMultisig,
    expectedOwners: config.expectedSafeOwners,
    expectedNonce: safeProfile.nonce,
  });
  await assertTimelock({ connection, ethers, timelock, address: timelockAddress, config });

  const artifactChecks = [
    ["GovernanceTimelock", timelockAddress, { needsLibraries: false }],
    ["DeepFamilyToken", addresses.token, { needsLibraries: false }],
    ["PoseidonT5", addresses.poseidonT5, { needsLibraries: false, librarySelfAddress: true }],
    ["AdultAgeGate", addresses.adultAgeGate, { needsLibraries: false }],
    ["PersonCommitmentVerifier", addresses.personCommitmentVerifier, { needsLibraries: false }],
    ["DisclosureBindingVerifier", addresses.disclosureBindingVerifier, { needsLibraries: false }],
    ["Groth16VerifierAdapter", addresses.groth16VerifierAdapter, { needsLibraries: false }],
    [
      "DeepFamily",
      addresses.deepFamilyImplementation,
      {
        needsLibraries: true,
        libraryAddresses: {
          PoseidonT5: addresses.poseidonT5,
          AdultAgeGate: addresses.adultAgeGate,
        },
      },
    ],
    ["UUPSProxy", addresses.deepFamily, { needsLibraries: false }],
    ["DeepFamilyReader", addresses.deepFamilyReader, { needsLibraries: false }],
  ];
  for (const [contractName, address, spec] of artifactChecks) {
    await assertImplementationMatchesArtifact({
      connection,
      ethers,
      hre,
      contractName,
      implementation: address,
      spec,
    });
  }

  const { token, deepFamily, deepFamilyReader, groth16VerifierAdapter } = deployed;
  const [
    owner,
    tokenOwner,
    tokenMain,
    mainToken,
    readerMain,
    personRoute,
    disclosureRoute,
    personBackend,
    disclosureBackend,
    currentImplementation,
    totalPersonsCount,
    tokenCounter,
    protocolEndorsementFeeBps,
  ] = await Promise.all([
    deepFamily.owner(),
    token.owner(),
    token.deepFamilyContract(),
    deepFamily.DEEP_FAMILY_TOKEN_CONTRACT(),
    deepFamilyReader.DEEP_FAMILY(),
    deepFamily.verifierRegistry(1, 0),
    deepFamily.verifierRegistry(1, 1),
    groth16VerifierAdapter.personVerifier(),
    groth16VerifierAdapter.disclosureBindingVerifier(),
    implementationAddress(ethers, ethers.provider, addresses.deepFamily),
    deepFamily.totalPersonsCount(),
    deepFamily.tokenCounter(),
    deepFamily.protocolEndorsementFeeBps(),
  ]);
  const invariants = [
    [sameAddress(owner, timelockAddress), "DeepFamily owner is not GovernanceTimelock"],
    [sameAddress(tokenOwner, ethers.ZeroAddress), "DeepFamilyToken bootstrap owner is active"],
    [sameAddress(tokenMain, addresses.deepFamily), "Token is not bound to DeepFamily"],
    [sameAddress(mainToken, addresses.token), "DeepFamily is not bound to Token"],
    [sameAddress(readerMain, addresses.deepFamily), "Reader is not bound to DeepFamily"],
    [sameAddress(personRoute, addresses.groth16VerifierAdapter), "person verifier route mismatch"],
    [
      sameAddress(disclosureRoute, addresses.groth16VerifierAdapter),
      "disclosure verifier route mismatch",
    ],
    [
      sameAddress(personBackend, addresses.personCommitmentVerifier),
      "person verifier backend mismatch",
    ],
    [
      sameAddress(disclosureBackend, addresses.disclosureBindingVerifier),
      "disclosure verifier backend mismatch",
    ],
    [
      sameAddress(currentImplementation, addresses.deepFamilyImplementation),
      "ERC-1967 implementation mismatch",
    ],
  ];
  for (const [passed, message] of invariants) if (!passed) throw new Error(message);
  if (protocolEndorsementFeeBps !== 500n) {
    throw new Error(
      `Initial protocol endorsement fee=${protocolEndorsementFeeBps}; expected 500 bps`,
    );
  }

  const releaseAlreadyCompleted =
    checkpoint.status === "passed" && checkpoint.phase === "complete" && checkpoint.completedAt;
  if (!releaseAlreadyCompleted && (totalPersonsCount !== 0n || tokenCounter !== 0n)) {
    throw new Error("Initial release unexpectedly contains person or NFT business data");
  }
  if (!checkpoint.initialBusinessState) {
    if (totalPersonsCount !== 0n || tokenCounter !== 0n) {
      throw new Error("Initial business-state evidence is missing from a non-empty deployment");
    }
    checkpoint.initialBusinessState = {
      totalPersonsCount: totalPersonsCount.toString(),
      tokenCounter: tokenCounter.toString(),
      observedAt: nowIso(),
    };
  }
  return {
    safeAddress: safeProfile.safeAddress,
    timelockAddress,
    deepFamilyOwner: owner,
    tokenOwner,
    implementation: currentImplementation,
    totalPersonsCount,
    tokenCounter,
    protocolEndorsementFeeBps,
  };
};

const publicTransactionReport = (transactions = {}) =>
  Object.fromEntries(
    Object.entries(transactions).map(([label, entry]) => [
      label,
      {
        kind: entry.kind,
        status: entry.status,
        from: entry.from,
        nonce: entry.request?.nonce,
        to: entry.request?.to,
        value: entry.request?.value,
        dataHash: entry.dataHash,
        predictedAddress: entry.predictedAddress,
        hash: entry.hash,
        receipt: entry.receipt,
        maximumCostWei: entry.maximumCostWei,
        actualCostWei: entry.actualCostWei ?? null,
      },
    ]),
  );

const writeReport = async ({
  checkpoint,
  config,
  sourceState,
  releaseInputs,
  buildState,
  safeOperationalAcceptance = null,
  reportPath = REPORT_PATH,
}) => {
  const transactions = publicTransactionReport(checkpoint?.transactions);
  const actualCostWei = Object.values(transactions).reduce(
    (total, transaction) => total + BigInt(transaction.actualCostWei ?? 0),
    0n,
  );
  await writeJsonAtomic(reportPath, {
    schemaVersion: MAINNET_STATE_SCHEMA_VERSION,
    mode: config.mode,
    status: checkpoint?.status ?? "planned",
    phase: checkpoint?.phase ?? "preflight",
    planDigest: checkpoint?.planDigest ?? null,
    fingerprint: checkpoint?.fingerprint ?? null,
    generatedAt: nowIso(),
    network: { name: config.networkName, chainId: config.chainId },
    releaseCommit: sourceState.commit,
    releaseInputDigest: releaseInputs.digest,
    buildState,
    addresses: checkpoint?.addresses ?? {},
    transactions,
    actualCostWei,
    actualCostNative: formatEther(actualCostWei),
    nativeSymbol: CHAIN_PROFILE.nativeSymbol,
    ...(CHAIN_PROFILE.id === "espace" ? { actualCostCfx: formatEther(actualCostWei) } : {}),
    maximumCostWei: config.maximumCostWei,
    verification: checkpoint?.verification ?? { status: "not-started", contracts: [] },
    finality: checkpoint?.finality ?? { status: "not-started" },
    terminalState: checkpoint?.terminalState ?? { status: "not-started" },
    governanceSafeOperationalAcceptance: checkpoint?.fingerprint?.governanceSafe
      ?.operationalAcceptance
      ? {
          ...checkpoint.fingerprint.governanceSafe.operationalAcceptance,
          finality:
            safeOperationalAcceptance?.finality ??
            checkpoint?.safeOperationalAcceptance?.finality ??
            null,
        }
      : null,
    error: checkpoint?.error ?? null,
    secretsPersisted: false,
    safeOwnerSignaturesPersisted: false,
  });
};

const revalidateCompletedRelease = async ({
  connection,
  ethers,
  provider,
  config,
  safeProfile,
  checkpoint,
  sourceState,
  releaseInputs,
}) => {
  if (
    checkpoint.phase !== "complete" ||
    !checkpoint.completedAt ||
    checkpoint.verification?.status !== "passed" ||
    checkpoint.finality?.status !== "passed" ||
    checkpoint.terminalState?.status !== "passed" ||
    !checkpoint.initialBusinessState
  ) {
    throw new Error("Completed mainnet checkpoint is missing required release evidence");
  }

  const recordedLabels = Object.keys(checkpoint.transactions ?? {}).sort();
  const expectedLabels = [...MAINNET_TRANSACTION_LABELS].sort();
  if (
    recordedLabels.length !== expectedLabels.length ||
    recordedLabels.some((label, index) => label !== expectedLabels[index]) ||
    expectedLabels.some((label) => checkpoint.transactions[label]?.status !== "finalized")
  ) {
    throw new Error("Completed mainnet checkpoint does not contain exactly 14 finalized steps");
  }
  const verifiedContracts = checkpoint.verification.contracts ?? [];
  if (
    verifiedContracts.length !== RELEASE_ARTIFACT_NAMES.length ||
    verifiedContracts.some((entry) => entry.status !== "passed")
  ) {
    throw new Error("Completed mainnet checkpoint does not contain complete source verification");
  }

  await revalidateCheckpointTransactions({
    provider,
    checkpoint,
    confirmations: config.confirmations,
    timeoutMs: TX_TIMEOUT_MS,
    maxCostWei: config.maximumCostWei,
    budgetEnvironmentName: MAINNET_PROFILE.maximumCostEnvironmentName,
    nativeSymbol: CHAIN_PROFILE.nativeSymbol,
    gasChargingPolicy: MAINNET_PROFILE.gasChargingPolicy,
  });
  await waitForFinalizedTransactions({
    provider,
    transactions: checkpoint.transactions,
    timeoutMs: config.finalityTimeoutSeconds * 1_000,
  });

  const addresses = checkpoint.addresses;
  const timelock = await ethers.getContractAt("GovernanceTimelock", addresses.timelock);
  const deployed = {
    token: await ethers.getContractAt("DeepFamilyToken", addresses.token),
    deepFamily: await ethers.getContractAt("DeepFamily", addresses.deepFamily),
    deepFamilyReader: await ethers.getContractAt("DeepFamilyReader", addresses.deepFamilyReader),
    groth16VerifierAdapter: await ethers.getContractAt(
      "Groth16VerifierAdapter",
      addresses.groth16VerifierAdapter,
    ),
  };
  await assertProtocolTerminalState({
    connection,
    ethers,
    config,
    safeProfile,
    timelock,
    timelockAddress: addresses.timelock,
    deployed,
    addresses,
    checkpoint,
  });

  const [finishedSourceState, finishedInputs] = await Promise.all([
    Promise.resolve(gitWorkingTreeState()),
    hashReleaseInputs(ethers),
  ]);
  if (
    !finishedSourceState.clean ||
    finishedSourceState.commit !== sourceState.commit ||
    finishedInputs.digest !== releaseInputs.digest
  ) {
    throw new Error("Release source inputs changed during completed-state revalidation");
  }
};

export const main = async (chainProfile) => {
  configureChainProfile(chainProfile);
  const wrapperMode = await assertReleaseCommandWrapper();
  // Invalid approval input and wrapper/child mode mismatches fail before opening the configured RPC.
  const authorization = parseMainnetAuthorization(process.env, CHAIN_PROFILE, {
    planDigestLabel: "--approval-file planDigest",
  });
  if (authorization.mode !== wrapperMode) {
    throw new Error("Mainnet release command mode does not match its approval input");
  }

  const connection = await hre.network.connect();
  const { ethers } = connection;
  const provider = ethers.provider;
  const rawChainId = await provider.send("eth_chainId", []);
  if (typeof rawChainId !== "string" || BigInt(rawChainId) !== MAINNET_CHAIN_ID) {
    throw new Error(
      `Raw ${CHAIN_PROFILE.displayName} mainnet RPC chainId must be ${MAINNET_CHAIN_ID}; got ` +
        String(rawChainId),
    );
  }
  const network = await provider.getNetwork();
  const config = parseProductionMainnetReleaseConfig({
    chainProfile: CHAIN_PROFILE,
    env: process.env,
    networkName: connection.networkName,
    chainId: network.chainId,
    commandInputLabels: {
      planDigest: "--approval-file planDigest",
      planApprovalSignatures: "--approval-file signatures",
      recoveryTransactions: "--recovery-file",
    },
  });
  if (hre.globalOptions?.buildProfile !== "production") {
    throw new Error(
      `${CHAIN_PROFILE.displayName} mainnet release requires Hardhat --build-profile production`,
    );
  }
  if (CHAIN_PROFILE.id === "ethereum" && config.mode === "execute") {
    const explorerApiKey = String(process.env.EXPLORER_API_KEY ?? "").trim();
    if (explorerApiKey === "" || explorerApiKey === "espace") {
      throw new Error(
        "Ethereum mainnet execution requires a real EXPLORER_API_KEY before any broadcast",
      );
    }
  }
  const zkCeremonyVerification = await verifyProductionCeremony({
    root: process.cwd(),
    ptauPath: resolveProductionPtauPath(),
  });
  const zkArtifactTrust = inspectZkReleaseArtifacts({
    root: process.cwd(),
    requireProduction: true,
    requireBuiltR1cs: true,
  });

  const [sourceState, releaseInputs, buildState, safeProfile, existingCheckpoint] =
    await Promise.all([
      Promise.resolve(gitWorkingTreeState()),
      hashReleaseInputs(ethers),
      readProductionBuildInfoState(ethers, process.cwd(), {
        artifacts: hre.artifacts,
        releaseArtifactNames: RELEASE_ARTIFACT_NAMES,
      }),
      assertCanonicalSafeProfile({
        provider,
        chainId: MAINNET_CHAIN_ID,
        safeAddress: config.governanceMultisig,
        expectedOwners: config.expectedSafeOwners,
      }),
      readJsonIfExists(STATE_PATH),
    ]);
  if (!sourceState.clean) {
    throw new Error(
      `${CHAIN_PROFILE.displayName} mainnet release requires a clean Git working tree`,
    );
  }
  if (
    !buildState.productionSettingsMatched ||
    !buildState.sourceContentsMatched ||
    !buildState.buildInfoOutputsMatched ||
    !buildState.artifactProvenanceMatched ||
    buildState.releaseArtifactCount !== RELEASE_ARTIFACT_NAMES.length ||
    releaseInputs.directories.artifacts.fileCount === 0
  ) {
    throw new Error(
      "Compiled artifacts/build-info do not match current sources and pinned production settings",
    );
  }
  const testnetReleaseEvidence = await validateTestnetReleaseEvidence({
    reportPath: config.testnetReleaseReportPath,
    repositoryRoot: process.cwd(),
    expectedTestnetChainId: CHAIN_PROFILE.acceptance.chainId,
    expectedTestnetNetworkName: CHAIN_PROFILE.acceptance.networkName,
    mainnetMinDelaySeconds: config.minDelaySeconds,
    currentCommit: sourceState.commit,
    expectedAcceptanceInputDigest: releaseInputs.digest,
  });
  await assertProductionControllersAreEoas({ provider, config });
  const safeOperationalAcceptance = await assertFinalizedSafeOperationalAcceptance({
    provider,
    config,
    safeProfile,
  });

  if (Object.keys(config.recoveryTransactions).length > 0 && config.mode !== "execute") {
    throw new Error("--recovery-file is accepted only by the explicit execute command");
  }
  assertRecoveryClaims(existingCheckpoint, config.recoveryTransactions);

  if (!existingCheckpoint) await assertNoUnmanagedDeployment();
  const startingNonce = existingCheckpoint
    ? Number(existingCheckpoint.fingerprint?.deployerNonce)
    : await provider.getTransactionCount(config.expectedDeployer, "pending");
  if (!Number.isSafeInteger(startingNonce) || startingNonce < 0) {
    throw new Error("Checkpoint deployer nonce is invalid");
  }
  const plannedAddresses = derivePlannedAddresses({
    ethers,
    deployer: config.expectedDeployer,
    startingNonce,
  });
  const expectedNonces = deriveExpectedNonces(startingNonce);
  const releaseIntents = await buildMainnetReleaseIntents({
    ethers,
    artifacts: hre.artifacts,
    deployer: config.expectedDeployer,
    startingNonce,
    chainId: config.chainId,
    minDelaySeconds: config.minDelaySeconds,
    governanceMultisig: config.governanceMultisig,
  });
  const releaseIntentsDigest = deriveMainnetReleaseIntentsDigest(ethers, releaseIntents);
  const fingerprint = buildFingerprint({
    config,
    sourceState,
    releaseInputs,
    buildState,
    safeProfile,
    safeOperationalAcceptance: safeOperationalAcceptance.evidence,
    deployerNonce: startingNonce,
    plannedAddresses,
    expectedNonces,
    releaseIntents,
    releaseIntentsDigest,
    zkArtifactTrust,
    zkCeremonyVerification,
    testnetReleaseEvidence,
  });
  const planDigest = deriveMainnetPlanDigest(fingerprint);
  const planApprovalMessage = buildMainnetPlanApprovalMessage({
    chainProfile: CHAIN_PROFILE,
    planDigest,
    governanceMultisig: config.governanceMultisig,
  });

  if (existingCheckpoint) {
    assertPlanMatchesCheckpoint({ checkpoint: existingCheckpoint, fingerprint, planDigest });
  }
  if (config.mode === "plan") {
    if (existingCheckpoint) {
      if (existingCheckpoint.status !== "passed") {
        throw new Error(
          `An incomplete protocol release checkpoint (${existingCheckpoint.status}/` +
            `${existingCheckpoint.phase}) already exists at ${STATE_PATH}. A blank plan digest ` +
            "cannot create a new plan or claim that no transaction was broadcast. Review and " +
            `resume the existing checkpoint with ${MAINNET_PROFILE.releaseExecuteCommand} -- ` +
            "--approval-file <path> and the approved digest and owner signatures.",
        );
      }
      await revalidateCompletedRelease({
        connection,
        ethers,
        provider,
        config,
        safeProfile,
        checkpoint: existingCheckpoint,
        sourceState,
        releaseInputs,
      });
      console.log(
        `${CHAIN_PROFILE.displayName} Mainnet release is already complete; read-only ` +
          "revalidation passed:",
      );
      console.log(`  DeepFamily: ${existingCheckpoint.addresses.deepFamily}`);
      console.log(`  Timelock:   ${existingCheckpoint.addresses.timelock}`);
      console.log(`  Safe:       ${config.governanceMultisig}`);
      console.log(`  state:      ${STATE_PATH}`);
      console.log(`  report:     ${REPORT_PATH}`);
      return;
    }
    const plan = {
      schemaVersion: MAINNET_STATE_SCHEMA_VERSION,
      status: "planned",
      phase: "preflight",
      planDigest,
      fingerprint,
      approvalRequest: {
        scheme: "EIP-191",
        message: planApprovalMessage,
        messageHash: ethers.hashMessage(planApprovalMessage),
        requiredSafeOwnerApprovals: safeProfile.threshold,
      },
      addresses: { governanceSafe: config.governanceMultisig, ...plannedAddresses },
      transactions: {},
    };
    await writeReport({
      checkpoint: plan,
      config,
      sourceState,
      releaseInputs,
      buildState,
      safeOperationalAcceptance,
      reportPath: PLAN_REPORT_PATH,
    });
    console.log(
      `${CHAIN_PROFILE.displayName} Mainnet release plan passed ` +
        "(no transaction was broadcast):",
    );
    console.log(`  deployer:       ${config.expectedDeployer}`);
    console.log(`  governance Safe:${config.governanceMultisig}`);
    console.log(`  Timelock:       ${plannedAddresses.timelock}`);
    console.log(`  minDelay:       ${config.minDelaySeconds}s`);
    console.log(`  testnet report: ${testnetReleaseEvidence.publicSummary.evidenceFile.sha256}`);
    console.log(`  maximum budget: ${config.maximumCost} ${CHAIN_PROFILE.nativeSymbol}`);
    console.log(`  plan digest:    ${plan.planDigest}`);
    console.log(`  report:         ${PLAN_REPORT_PATH}`);
    console.log("\nRequired EIP-191 message for at least two Safe owners to sign:");
    console.log(planApprovalMessage);
    console.log(
      "\nAfter reviewing the report and collecting the required signatures, create an approval JSON file:",
    );
    console.log(`  {"planDigest":"${plan.planDigest}","signatures":["0x...","0x..."]}`);
    console.log("Then execute or resume with:");
    console.log(`  ${MAINNET_PROFILE.releaseExecuteCommand} -- --approval-file <path>`);
    return;
  }

  if (config.configuredPlanDigest !== planDigest.toLowerCase()) {
    throw new Error(
      "The approval file planDigest does not match the current reviewed release plan",
    );
  }
  const planApproval = verifyMainnetPlanApprovals({
    chainProfile: CHAIN_PROFILE,
    planDigest,
    governanceMultisig: config.governanceMultisig,
    expectedOwners: config.expectedSafeOwners,
    requiredApprovals: safeProfile.threshold,
    signatures: config.planApprovalSignatures,
  });
  if (existingCheckpoint?.status === "passed") {
    await revalidateCompletedRelease({
      connection,
      ethers,
      provider,
      config,
      safeProfile,
      checkpoint: existingCheckpoint,
      sourceState,
      releaseInputs,
    });
    console.log(
      `${CHAIN_PROFILE.displayName} Mainnet release is already complete; read-only ` +
        "revalidation passed:",
    );
    console.log(`  DeepFamily: ${existingCheckpoint.addresses.deepFamily}`);
    console.log(`  Timelock:   ${existingCheckpoint.addresses.timelock}`);
    console.log(`  Safe:       ${config.governanceMultisig}`);
    console.log(`  state:      ${STATE_PATH}`);
    console.log(`  report:     ${REPORT_PATH}`);
    return;
  }
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer is configured; set PRIVATE_KEY");
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
      `Release deployer balance ${formatEther(deployerBalance)} ${CHAIN_PROFILE.nativeSymbol} ` +
        `is below the approved ${MAINNET_PROFILE.maximumCostEnvironmentName} ceiling ` +
        `${config.maximumCost} ${CHAIN_PROFILE.nativeSymbol}`,
    );
  }

  const releaseLock = await acquireReleaseLock(LOCK_PATH, {
    chainId: MAINNET_CHAIN_ID.toString(),
    planDigest,
    deployer: deployerAddress,
  });
  let checkpoint = existingCheckpoint;
  try {
    const lockedCheckpoint = await readJsonIfExists(STATE_PATH);
    if (!checkpoint && lockedCheckpoint) {
      throw new Error(
        "Release checkpoint appeared during preflight; restart so its on-chain state is revalidated",
      );
    }
    if (checkpoint && !lockedCheckpoint) {
      throw new Error("Release checkpoint disappeared during preflight; refusing to recreate it");
    }
    if (lockedCheckpoint) {
      assertPlanMatchesCheckpoint({ checkpoint: lockedCheckpoint, fingerprint, planDigest });
      assertRecoveryClaims(lockedCheckpoint, config.recoveryTransactions);
      checkpoint = lockedCheckpoint;
    } else {
      await assertNoUnmanagedDeployment();
    }
    await assertCanonicalSafeProfile({
      provider,
      chainId: MAINNET_CHAIN_ID,
      safeAddress: config.governanceMultisig,
      expectedOwners: config.expectedSafeOwners,
      expectedNonce: safeProfile.nonce,
    });
    if (!checkpoint) {
      checkpoint = {
        schemaVersion: MAINNET_STATE_SCHEMA_VERSION,
        status: "running",
        phase: "preflight-complete",
        planDigest,
        fingerprint,
        planApproval: {
          scheme: "EIP-191",
          messageHash: planApproval.messageHash,
          requiredApprovals: planApproval.requiredApprovals,
          approvedOwners: planApproval.approvedOwners,
        },
        createdAt: nowIso(),
        updatedAt: nowIso(),
        addresses: {
          governanceSafe: config.governanceMultisig,
          ...plannedAddresses,
        },
        transactions: {},
        verification: { status: "not-started", contracts: [] },
        finality: { status: "not-started" },
        terminalState: { status: "not-started" },
        safeOperationalAcceptance,
        error: null,
      };
      await writeJsonAtomic(STATE_PATH, checkpoint);
    } else {
      checkpoint.status = "running";
      checkpoint.error = null;
      checkpoint.planApproval = {
        scheme: "EIP-191",
        messageHash: planApproval.messageHash,
        requiredApprovals: planApproval.requiredApprovals,
        approvedOwners: planApproval.approvedOwners,
      };
      checkpoint.updatedAt = nowIso();
      await writeJsonAtomic(STATE_PATH, checkpoint);
    }
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
      recoveryTransactions: config.recoveryTransactions,
      expectedNonces,
      expectedIntents: releaseIntents,
      budgetEnvironmentName: MAINNET_PROFILE.maximumCostEnvironmentName,
      recoveryEnvironmentName: "--recovery-file",
      nativeSymbol: CHAIN_PROFILE.nativeSymbol,
      gasChargingPolicy: MAINNET_PROFILE.gasChargingPolicy,
    });
    // Recovery hashes must be adopted before protocol-state reconciliation. Several idempotent
    // calls are intentionally skipped when their on-chain effect already exists; without this
    // independent adoption pass, a crash after mining but before hash persistence could leave the
    // corresponding planned journal entry unreachable forever.
    for (const label of Object.keys(config.recoveryTransactions)) {
      const entry = checkpoint.transactions[label];
      await transactionExecutor({
        label,
        kind: entry.kind,
        transactionRequest: null,
        transactionConfirmations: config.confirmations,
        transactionTimeoutMs: TX_TIMEOUT_MS,
      });
    }
    await revalidateCheckpointTransactions({
      provider,
      checkpoint,
      confirmations: config.confirmations,
      timeoutMs: TX_TIMEOUT_MS,
      maxCostWei: config.maximumCostWei,
      budgetEnvironmentName: MAINNET_PROFILE.maximumCostEnvironmentName,
      nativeSymbol: CHAIN_PROFILE.nativeSymbol,
      gasChargingPolicy: MAINNET_PROFILE.gasChargingPolicy,
      saveCheckpoint,
    });
    if (Object.keys(config.recoveryTransactions).length > 0) {
      checkpoint.status = "paused";
      checkpoint.error = null;
      delete checkpoint.failedPhase;
      await saveCheckpoint();
      await writeReport({
        checkpoint,
        config,
        sourceState,
        releaseInputs,
        buildState,
        safeOperationalAcceptance,
      });
      console.log(
        `${CHAIN_PROFILE.displayName} Mainnet recovery evidence was adopted; no new transaction ` +
          "was broadcast by this run.",
      );
      console.log(`  state:  ${STATE_PATH}`);
      console.log(`  report: ${REPORT_PATH}`);
      console.log(
        `Resume with ${MAINNET_PROFILE.releaseExecuteCommand} -- --approval-file <path> and ` +
          "omit --recovery-file.",
      );
      return;
    }

    checkpoint.phase = "timelock-deployment";
    await saveCheckpoint();
    if (!checkpoint.transactions.governanceTimelock) {
      const currentPendingNonce = await provider.getTransactionCount(deployerAddress, "pending");
      if (currentPendingNonce !== startingNonce) {
        throw new Error(
          `Release deployer nonce changed from approved ${startingNonce} to ` +
            `${currentPendingNonce} before the first transaction`,
        );
      }
    }
    const TimelockFactory = await ethers.getContractFactory("GovernanceTimelock", deployer);
    const timelockReceipt = await transactionExecutor({
      label: "governanceTimelock",
      kind: "deployment",
      transactionRequest: await TimelockFactory.getDeployTransaction(
        config.minDelaySeconds,
        config.governanceMultisig,
      ),
      transactionConfirmations: config.confirmations,
      transactionTimeoutMs: TX_TIMEOUT_MS,
    });
    const timelockAddress = ethers.getAddress(timelockReceipt.contractAddress);
    if (!sameAddress(timelockAddress, plannedAddresses.timelock)) {
      throw new Error(
        `Timelock deployed at ${timelockAddress}, expected ${plannedAddresses.timelock}`,
      );
    }
    const timelock = TimelockFactory.attach(timelockAddress);
    await assertTimelock({ connection, ethers, timelock, address: timelockAddress, config });
    await writeTimelockDeployment({ address: timelockAddress, config });
    checkpoint.addresses.timelock = timelockAddress;
    await saveCheckpoint();

    if (checkpoint.verification?.timelock !== "passed") {
      checkpoint.phase = "timelock-verification";
      await saveCheckpoint();
      const [entry] = [
        await verificationEntry(hre.artifacts, "GovernanceTimelock", timelockAddress, [
          config.minDelaySeconds,
          config.governanceMultisig,
        ]),
      ];
      await verifyAcceptanceContracts({
        hre,
        entries: [entry],
        timeoutMs: 15 * 60 * 1000,
        attemptTimeoutMs: 2 * 60 * 1000,
        retries: 2,
        logger: console,
        verificationProvider: MAINNET_PROFILE.verificationProvider,
        explorerName: MAINNET_PROFILE.explorerName,
      });
      checkpoint.verification = {
        ...(checkpoint.verification ?? {}),
        timelock: "passed",
        status: "timelock-passed",
        contracts: checkpoint.verification?.contracts ?? [],
      };
      await saveCheckpoint();
    }

    await assertCanonicalSafeProfile({
      provider,
      chainId: MAINNET_CHAIN_ID,
      safeAddress: config.governanceMultisig,
      expectedOwners: config.expectedSafeOwners,
      expectedNonce: safeProfile.nonce,
    });

    checkpoint.phase = "protocol-deployment";
    await saveCheckpoint();
    const deployed = await deployIntegratedSystem(connection, {
      writeDeployments: true,
      signer: deployer,
      artifacts: hre.artifacts,
      transactionConfirmations: config.confirmations,
      transactionTimeoutMs: TX_TIMEOUT_MS,
      transactionExecutor,
      governanceOwner: timelockAddress,
      governanceMultisig: config.governanceMultisig,
      governanceMultisigProfile: config.governanceMultisigProfile,
    });
    const addresses = {
      governanceSafe: config.governanceMultisig,
      timelock: timelockAddress,
      token: await deployed.token.getAddress(),
      poseidonT5: await deployed.poseidonT5.getAddress(),
      adultAgeGate: await deployed.adultAgeGate.getAddress(),
      personCommitmentVerifier: await deployed.personCommitmentVerifier.getAddress(),
      disclosureBindingVerifier: await deployed.nameDisclosureVerifier.getAddress(),
      groth16VerifierAdapter: await deployed.groth16VerifierAdapter.getAddress(),
      deepFamily: await deployed.deepFamily.getAddress(),
      deepFamilyImplementation: deployed.deepFamilyImplementationAddress,
      deepFamilyReader: await deployed.deepFamilyReader.getAddress(),
    };
    for (const [label, plannedAddress] of Object.entries(plannedAddresses)) {
      if (!sameAddress(addresses[label], plannedAddress)) {
        throw new Error(
          `${label} deployed at ${addresses[label] ?? "missing"}, expected ${plannedAddress}`,
        );
      }
    }
    checkpoint.addresses = addresses;
    await saveCheckpoint();

    const deepFamilyFactory = await ethers.getContractFactory("DeepFamily", {
      signer: deployer,
      libraries: { PoseidonT5: addresses.poseidonT5, AdultAgeGate: addresses.adultAgeGate },
    });
    const proxyInitData = deepFamilyFactory.interface.encodeFunctionData("initialize", [
      addresses.token,
      deployerAddress,
    ]);
    const verificationEntries = [
      await verificationEntry(hre.artifacts, "GovernanceTimelock", timelockAddress, [
        config.minDelaySeconds,
        config.governanceMultisig,
      ]),
      await verificationEntry(hre.artifacts, "DeepFamilyToken", addresses.token),
      await verificationEntry(hre.artifacts, "PoseidonT5", addresses.poseidonT5),
      await verificationEntry(hre.artifacts, "AdultAgeGate", addresses.adultAgeGate),
      await verificationEntry(
        hre.artifacts,
        "PersonCommitmentVerifier",
        addresses.personCommitmentVerifier,
      ),
      await verificationEntry(
        hre.artifacts,
        "DisclosureBindingVerifier",
        addresses.disclosureBindingVerifier,
      ),
      await verificationEntry(
        hre.artifacts,
        "Groth16VerifierAdapter",
        addresses.groth16VerifierAdapter,
        [addresses.personCommitmentVerifier, addresses.disclosureBindingVerifier],
      ),
      await verificationEntry(hre.artifacts, "DeepFamily", addresses.deepFamilyImplementation, [], {
        PoseidonT5: addresses.poseidonT5,
        AdultAgeGate: addresses.adultAgeGate,
      }),
      await verificationEntry(hre.artifacts, "UUPSProxy", addresses.deepFamily, [
        addresses.deepFamilyImplementation,
        proxyInitData,
      ]),
      await verificationEntry(hre.artifacts, "DeepFamilyReader", addresses.deepFamilyReader, [
        addresses.deepFamily,
      ]),
    ];
    await verifyContracts({ entries: verificationEntries, checkpoint, saveCheckpoint });

    checkpoint.phase = "chain-finality";
    await saveCheckpoint();
    const incompleteTransactions = MAINNET_TRANSACTION_LABELS.filter((label) => {
      const transaction = checkpoint.transactions[label];
      return (
        !transaction?.hash ||
        !transaction.receipt ||
        (transaction.status !== "confirmed" && transaction.status !== "finalized")
      );
    });
    if (incompleteTransactions.length > 0) {
      throw new Error(
        `Release transaction journal is incomplete: ${incompleteTransactions.join(", ")}`,
      );
    }
    checkpoint.finality = await waitForFinalizedTransactions({
      provider,
      transactions: checkpoint.transactions,
      timeoutMs: config.finalityTimeoutSeconds * 1_000,
    });
    for (const transaction of Object.values(checkpoint.transactions)) {
      if (transaction.status === "confirmed") transaction.status = "finalized";
    }
    await saveCheckpoint();

    checkpoint.phase = "terminal-state";
    await saveCheckpoint();
    checkpoint.terminalState = {
      status: "passed",
      ...(await assertProtocolTerminalState({
        connection,
        ethers,
        config,
        safeProfile,
        timelock,
        timelockAddress,
        deployed,
        addresses,
        checkpoint,
      })),
    };
    await saveCheckpoint();

    await revalidateCheckpointTransactions({
      provider,
      checkpoint,
      confirmations: config.confirmations,
      timeoutMs: TX_TIMEOUT_MS,
      maxCostWei: config.maximumCostWei,
      budgetEnvironmentName: MAINNET_PROFILE.maximumCostEnvironmentName,
      nativeSymbol: CHAIN_PROFILE.nativeSymbol,
      gasChargingPolicy: MAINNET_PROFILE.gasChargingPolicy,
      saveCheckpoint,
    });
    const [finishedSourceState, finishedInputs] = await Promise.all([
      Promise.resolve(gitWorkingTreeState()),
      hashReleaseInputs(ethers),
    ]);
    if (
      !finishedSourceState.clean ||
      finishedSourceState.commit !== sourceState.commit ||
      finishedInputs.digest !== releaseInputs.digest
    ) {
      throw new Error("Release source inputs changed while mainnet deployment was running");
    }

    checkpoint.status = "passed";
    checkpoint.phase = "complete";
    checkpoint.completedAt ??= nowIso();
    checkpoint.error = null;
    await saveCheckpoint();
    await writeReport({
      checkpoint,
      config,
      sourceState,
      releaseInputs,
      buildState,
      safeOperationalAcceptance,
    });
    console.log(`${CHAIN_PROFILE.displayName} Mainnet release completed successfully:`);
    console.log(`  DeepFamily: ${addresses.deepFamily}`);
    console.log(`  Timelock:   ${timelockAddress}`);
    console.log(`  Safe:       ${config.governanceMultisig}`);
    console.log(`  state:      ${STATE_PATH}`);
    console.log(`  report:     ${REPORT_PATH}`);
  } catch (error) {
    if (checkpoint) {
      checkpoint.status = "paused";
      checkpoint.error = publicError(error);
      checkpoint.failedPhase = checkpoint.phase;
      checkpoint.updatedAt = nowIso();
      await writeJsonAtomic(STATE_PATH, checkpoint);
      await writeReport({
        checkpoint,
        config,
        sourceState,
        releaseInputs,
        buildState,
        safeOperationalAcceptance,
      });
    }
    throw error;
  } finally {
    await releaseLock();
  }
};
