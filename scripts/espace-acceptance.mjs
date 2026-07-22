import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import hre from "hardhat";

import { deployIntegratedSystem } from "../hardhat/integratedDeployment.mjs";
import personCommitmentProof from "../lib/personCommitmentProof.js";
import disclosureBindingProof from "../lib/disclosureBindingProof.js";
import {
  assertImplementationMatchesArtifact,
  assertImplementationStorageSafe,
} from "../tasks/lib/timelockUpgrade.mjs";
import {
  deriveAcceptanceWallet,
  parseESpaceAcceptanceConfig,
  runIdReportFileComponent,
  signMultisigExecute,
} from "./lib/espaceAcceptanceSafety.mjs";
import { verifyAcceptanceContracts } from "./lib/espaceAcceptanceVerification.mjs";

const { generatePersonCommitmentProof } = personCommitmentProof;
const { generateDisclosureBindingProof } = disclosureBindingProof;

const EXPECTED_NETWORK = "confluxTestnet";
const EXPECTED_CHAIN_ID = 71n;
const REQUIRED_CONFIRMATION = "conflux-testnet-chain-71";
const TX_TIMEOUT_MS = 10 * 60 * 1000;
const PROOF_TIMEOUT_MS = 5 * 60 * 1000;
const READY_GRACE_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;
const ZERO_HASH = `0x${"0".repeat(64)}`;
const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const REPORT_ROOT = path.join(process.cwd(), "tmp", "espace-acceptance");
const DEPLOYMENTS_DIR = path.join(process.cwd(), "deployments", EXPECTED_NETWORK);

const nowIso = () => new Date().toISOString();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const assertCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const defaultRunId = () => {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${timestamp}-${randomBytes(4).toString("hex")}`;
};

const withTimeout = async (promise, timeoutMs, label) => {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const retryBounded = async (operation, { attempts = 3, timeoutMs = 30_000, label }) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTimeout(
        Promise.resolve().then(operation),
        timeoutMs,
        `${label} attempt ${attempt}`,
      );
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1_000);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${safeErrorMessage(lastError)}`);
};

const pollUntil = async (predicate, { timeoutMs, intervalMs = POLL_INTERVAL_MS, label }) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  const detail = lastError ? `; last error: ${safeErrorMessage(lastError)}` : "";
  throw new Error(`${label} timed out after ${timeoutMs}ms${detail}`);
};

const jsonReplacer = (_key, value) => (typeof value === "bigint" ? value.toString() : value);

const redactText = (value, secrets = []) => {
  let text = String(value || "Unknown error");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[redacted-secret]");
  }
  // Ethers errors can embed raw proof calldata or 65-byte signatures. Keep ordinary addresses
  // and 32-byte transaction/operation hashes useful while removing longer opaque payloads.
  text = text.replace(/0x[0-9a-fA-F]{130,}/g, (match) => `[redacted-hex:${match.length - 2}]`);
  return text.slice(0, 4_000);
};

const safeErrorMessage = (error, secrets = []) =>
  redactText(error?.shortMessage || error?.reason || error?.message || error, secrets);

const writeJsonAtomic = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, jsonReplacer, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
};

const gitCommit = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const hashDirectory = async (ethers, directory) => {
  const entries = [];
  const visit = async (current, relative = "") => {
    let children;
    try {
      children = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const childRelative = path.posix.join(relative, child.name);
      const childPath = path.join(current, child.name);
      if (child.isDirectory()) {
        await visit(childPath, childRelative);
      } else if (child.isFile()) {
        const content = await fs.readFile(childPath);
        entries.push(`${childRelative}:${ethers.keccak256(content)}`);
      }
    }
  };
  await visit(directory);
  return {
    fileCount: entries.length,
    digest: ethers.keccak256(ethers.toUtf8Bytes(entries.join("\n"))),
  };
};

const publicReceipt = (receipt) => ({
  hash: receipt.hash,
  blockNumber: receipt.blockNumber,
  blockHash: receipt.blockHash,
  status: Number(receipt.status),
  gasUsed: receipt.gasUsed,
  gasPrice: receipt.gasPrice ?? null,
  contractAddress: receipt.contractAddress ?? null,
});

const implementationAddress = async (ethers, provider, proxyAddress) => {
  const raw = await provider.getStorage(proxyAddress, ERC1967_IMPLEMENTATION_SLOT);
  return ethers.getAddress(ethers.dataSlice(raw, 12));
};

const expectRevert = async (operation, label) => {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
};

const waitForReady = async (timelock, operationId, minDelay) =>
  pollUntil(() => timelock.isOperationReady(operationId), {
    timeoutMs: minDelay * 1_000 + READY_GRACE_MS,
    label: `Timelock operation ${operationId} readiness`,
  });

const verificationEntry = async (
  artifacts,
  name,
  address,
  constructorArgs = [],
  libraries = {},
) => {
  const artifact = await artifacts.readArtifact(name);
  return {
    label: name,
    address,
    contract: `${artifact.sourceName}:${artifact.contractName}`,
    constructorArgs,
    libraries,
  };
};

const verifyEntries = async (entries, report, saveReport) => {
  report.verification.status = "running";
  await saveReport();
  let failures = [];
  try {
    report.verification.contracts = await verifyAcceptanceContracts({
      hre,
      entries,
      timeoutMs: 15 * 60 * 1000,
      attemptTimeoutMs: 2 * 60 * 1000,
      retries: 2,
      logger: console,
    });
    report.verification.status = "passed";
  } catch (error) {
    report.verification.contracts = Array.isArray(error.results) ? error.results : [];
    failures = report.verification.contracts.filter((item) => item.status !== "passed");
    if (failures.length === 0) {
      failures = [{ label: "verification-batch", status: "failed" }];
    }
    report.verification.status = "failed";
    report.verification.error = safeErrorMessage(error);
  }
  await saveReport();
  return failures;
};

const refundWallet = async ({ ethers, provider, wallet, recipient, confirmations }) => {
  const balanceBefore = await provider.getBalance(wallet.address);
  if (balanceBefore === 0n) {
    return { status: "not-needed", balanceBefore, amount: 0n, balanceAfter: 0n };
  }

  const feeData = await provider.getFeeData();
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (!feePerGas || feePerGas <= 0n)
    throw new Error("RPC did not return a usable gas price for refund");
  const estimatedGas = await wallet.estimateGas({ to: recipient, value: 0n });
  const gasLimit = (estimatedGas * 125n + 99n) / 100n;
  const reserve = gasLimit * feePerGas;
  if (balanceBefore <= reserve) {
    throw new Error(
      `Run deployer balance ${balanceBefore} is not enough to pay the estimated refund gas ${reserve}`,
    );
  }
  const amount = balanceBefore - reserve;
  const feeOverrides =
    feeData.maxFeePerGas != null
      ? {
          maxFeePerGas: feeData.maxFeePerGas,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
        }
      : { gasPrice: feeData.gasPrice };
  const tx = await wallet.sendTransaction({
    to: recipient,
    value: amount,
    gasLimit,
    ...feeOverrides,
  });
  const receipt = await tx.wait(confirmations, TX_TIMEOUT_MS);
  assertCondition(receipt, "Run-deployer refund transaction was not confirmed");
  assertCondition(Number(receipt.status) === 1, "Run-deployer refund transaction reverted");
  return {
    status: "passed",
    balanceBefore,
    amount,
    balanceAfter: await provider.getBalance(wallet.address),
    transaction: publicReceipt(receipt),
  };
};

const runRecovery = async ({ ethers, provider, config, funder, runDeployer, baseReportPath }) => {
  const recoveryPath = path.join(
    REPORT_ROOT,
    `${config.reportFileComponent}.recovery-${Date.now().toString(10)}.json`,
  );
  const report = {
    schemaVersion: 2,
    mode: "recovery",
    runId: config.runId,
    status: "running",
    startedAt: nowIso(),
    network: { name: EXPECTED_NETWORK, chainId: EXPECTED_CHAIN_ID },
    addresses: { funder: funder.address, runDeployer: runDeployer.address },
    sourceReport: baseReportPath,
  };
  await writeJsonAtomic(recoveryPath, report);
  try {
    report.refund = await refundWallet({
      ethers,
      provider,
      wallet: runDeployer,
      recipient: funder.address,
      confirmations: config.confirmations,
    });
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = safeErrorMessage(error, [config.privateKey, runDeployer.privateKey]);
    throw error;
  } finally {
    report.finishedAt = nowIso();
    await writeJsonAtomic(recoveryPath, report);
    console.log(`[espace-acceptance] recovery report: ${recoveryPath}`);
  }
};

export const main = async () => {
  // Fail closed without touching the RPC when the explicit live-test acknowledgement is absent.
  if (process.env.ESPACE_E2E_CONFIRM !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Set ESPACE_E2E_CONFIRM=${REQUIRED_CONFIRMATION} to authorize testnet transactions`,
    );
  }
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const provider = ethers.provider;
  const network = await retryBounded(() => provider.getNetwork(), { label: "RPC chain-id query" });
  // The tested safety parser evaluates the network name, chain ID and explicit confirmation
  // together before report creation, funding, or any other transaction.
  const parsedConfig = parseESpaceAcceptanceConfig({
    env: process.env,
    networkName: connection.networkName,
    chainId: network.chainId,
  });
  const privateKey = String(process.env.PRIVATE_KEY || "").trim();
  const runId = parsedConfig.runId || defaultRunId();
  const config = {
    privateKey,
    minDelay: parsedConfig.minDelaySeconds,
    confirmations: parsedConfig.confirmations,
    maxCfx: parsedConfig.maxCfxWei,
    maxCfxText: parsedConfig.maxCfx,
    runId,
    reportFileComponent: runIdReportFileComponent(runId),
    recover: parsedConfig.recover,
    verify: parsedConfig.verify,
  };

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey) || /^0x0{64}$/i.test(privateKey)) {
    throw new Error("PRIVATE_KEY must be a valid non-zero 0x-prefixed private key");
  }
  const funder = new ethers.Wallet(privateKey, provider);
  const runDeployer = deriveAcceptanceWallet({
    basePrivateKey: privateKey,
    runId,
    label: "run-deployer",
    provider,
  });

  const reportPath = path.join(REPORT_ROOT, `${config.reportFileComponent}.json`);
  if (config.recover) {
    await runRecovery({
      ethers,
      provider,
      config,
      funder,
      runDeployer,
      baseReportPath: reportPath,
    });
    return;
  }

  const ownerA = deriveAcceptanceWallet({
    basePrivateKey: privateKey,
    runId,
    label: "multisig-owner-a",
    provider,
  });
  const ownerB = deriveAcceptanceWallet({
    basePrivateKey: privateKey,
    runId,
    label: "multisig-owner-b",
    provider,
  });
  const ownerC = deriveAcceptanceWallet({
    basePrivateKey: privateKey,
    runId,
    label: "multisig-owner-c",
    provider,
  });
  assertCondition(
    new Set([funder.address, runDeployer.address, ownerA.address, ownerB.address, ownerC.address])
      .size === 5,
    "Derived test accounts must all be distinct",
  );

  try {
    await fs.access(reportPath);
    throw new Error(
      `Report ${reportPath} already exists; choose a new ESPACE_E2E_RUN_ID or use ESPACE_E2E_RECOVER=1`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const runBalanceBefore = await provider.getBalance(runDeployer.address);
  assertCondition(
    runBalanceBefore === 0n,
    `Derived run deployer ${runDeployer.address} already holds ${runBalanceBefore} wei; use ESPACE_E2E_RECOVER=1 before a new run`,
  );
  const funderBalanceBefore = await provider.getBalance(funder.address);
  const feeData = await provider.getFeeData();
  const fundingGasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  assertCondition(fundingGasPrice > 0n, "RPC did not return a usable gas price");
  assertCondition(
    funderBalanceBefore > config.maxCfx + 21_000n * fundingGasPrice,
    `Funder balance is below the ${config.maxCfxText} CFX test budget plus funding gas`,
  );

  const deploymentsBefore = await hashDirectory(ethers, DEPLOYMENTS_DIR);
  const report = {
    schemaVersion: 2,
    mode: "acceptance",
    runId: config.runId,
    status: "running",
    failedStep: null,
    error: null,
    startedAt: nowIso(),
    finishedAt: null,
    releaseCommit: gitCommit(),
    network: {
      name: connection.networkName,
      chainId: network.chainId,
      confirmations: config.confirmations,
      latestBlockAtStart: await provider.getBlockNumber(),
    },
    safety: {
      confirmationMatched: true,
      isolatedDeployment: true,
      privateKeysPersisted: false,
      reportContainsProofsOrSignatures: false,
      recoveryCommand:
        `ESPACE_E2E_CONFIRM=${REQUIRED_CONFIRMATION} ESPACE_E2E_RUN_ID=${config.runId} ` +
        "ESPACE_E2E_RECOVER=1 npm run espace:acceptance",
    },
    addresses: {
      funder: funder.address,
      runDeployer: runDeployer.address,
      multisigOwners: [ownerA.address, ownerB.address, ownerC.address],
    },
    multisigPolicy: {
      policy: "2-of-3",
      ownerCount: 3,
      threshold: 2,
      oneSignatureRejected: false,
      duplicateSignatureRejected: false,
      nonOwnerSignatureRejected: false,
      twoSignaturePairsExecuted: [],
      threeSignatureExecuted: false,
      replayRejected: false,
    },
    steps: [],
    transactions: {},
    onchain: { status: "running" },
    governance: {},
    business: {},
    treasury: {},
    upgrade: {},
    verification: {
      enabled: config.verify,
      status: config.verify ? "pending" : "skipped",
      contracts: [],
    },
    budget: {
      capWei: config.maxCfx,
      capCfx: config.maxCfxText,
      funderBalanceBefore,
      runBalanceBefore,
      refund: { status: "pending" },
    },
    deploymentsDirectory: {
      path: DEPLOYMENTS_DIR,
      before: deploymentsBefore,
      after: null,
      unchanged: null,
    },
  };
  const saveReport = () => writeJsonAtomic(reportPath, report);
  await saveReport();
  console.log(`[espace-acceptance] run ID: ${config.runId}`);
  console.log(`[espace-acceptance] report initialized: ${reportPath}`);

  let currentStep = "funding";
  let originalError = null;
  let funded = false;
  const secretValues = [
    config.privateKey,
    runDeployer.privateKey,
    ownerA.privateKey,
    ownerB.privateKey,
    ownerC.privateKey,
  ];
  const addStep = async (name, evidence = {}) => {
    report.steps.push({ name, status: "passed", at: nowIso(), ...evidence });
    await saveReport();
    console.log(`[espace-acceptance] PASS ${name}`);
  };
  const recordTx = async (label, tx) => {
    const receipt = await tx.wait(config.confirmations, TX_TIMEOUT_MS);
    assertCondition(receipt, `${label} transaction was not confirmed`);
    assertCondition(Number(receipt.status) === 1, `${label} transaction reverted`);
    report.transactions[label] = publicReceipt(receipt);
    await saveReport();
    return receipt;
  };
  const deploy = async (contractName, signer, args = [], factoryOptions = {}) => {
    const factory = await ethers.getContractFactory(contractName, { signer, ...factoryOptions });
    const contract = await factory.deploy(...args);
    const transaction = contract.deploymentTransaction();
    assertCondition(transaction, `${contractName} deployment transaction is unavailable`);
    await recordTx(`deploy-${contractName}`, transaction);
    const address = await contract.getAddress();
    assertCondition(
      (await provider.getCode(address)) !== "0x",
      `${contractName} has no deployed code`,
    );
    return contract;
  };

  let oldGovernanceOwner = process.env.GOVERNANCE_OWNER;
  let oldGovernanceMultisig = process.env.GOVERNANCE_MULTISIG;

  try {
    const fundingTx = await funder.sendTransaction({
      to: runDeployer.address,
      value: config.maxCfx,
    });
    funded = true;
    await recordTx("fund-run-deployer", fundingTx);
    assertCondition(
      (await provider.getBalance(runDeployer.address)) <= config.maxCfx,
      "Run deployer received more than the configured hard budget",
    );
    await addStep("fund-isolated-run-deployer", { amountWei: config.maxCfx });

    currentStep = "deploy-multisig-timelock";
    const multisig = await deploy("E2ETestnetMultisig", runDeployer, [
      ownerA.address,
      ownerB.address,
      ownerC.address,
    ]);
    const multisigAddress = await multisig.getAddress();
    const timelock = await deploy("GovernanceTimelock", runDeployer, [
      config.minDelay,
      multisigAddress,
    ]);
    const timelockAddress = await timelock.getAddress();
    report.addresses.multisig = multisigAddress;
    report.addresses.timelock = timelockAddress;

    const owners = await multisig.getOwners();
    assertCondition((await multisig.getThreshold()) === 2n, "Test multisig threshold is not 2");
    assertCondition(
      owners
        .map((item) => item.toLowerCase())
        .sort()
        .join(",") ===
        [ownerA.address, ownerB.address, ownerC.address]
          .map((item) => item.toLowerCase())
          .sort()
          .join(","),
      "Test multisig owner set mismatch",
    );
    assertCondition((await multisig.nonce()) === 0n, "Test multisig initial nonce is not zero");

    const roleChecks = [
      ["admin", await timelock.DEFAULT_ADMIN_ROLE(), timelockAddress],
      ["proposer", await timelock.PROPOSER_ROLE(), multisigAddress],
      ["canceller", await timelock.CANCELLER_ROLE(), multisigAddress],
      ["executor", await timelock.EXECUTOR_ROLE(), multisigAddress],
    ];
    for (const [name, role, expected] of roleChecks) {
      const count = await timelock.getRoleMemberCount(role);
      const member = count === 1n ? await timelock.getRoleMember(role, 0) : ethers.ZeroAddress;
      assertCondition(
        count === 1n && ethers.getAddress(member) === ethers.getAddress(expected),
        `Timelock ${name} role is not exclusively held by ${expected}`,
      );
    }
    assertCondition(
      (await timelock.getMinDelay()) === BigInt(config.minDelay),
      "Timelock delay mismatch",
    );

    const signedExecution = async (target, value, data, wallets = [ownerA, ownerB]) => {
      const nonce = await multisig.nonce();
      const { signatures } = await signMultisigExecute({
        wallets,
        chainId: EXPECTED_CHAIN_ID,
        multisigAddress,
        target,
        value,
        data,
        nonce,
      });
      return { nonce, signatures };
    };
    const executeMultisig = async (label, target, value, data, wallets = [ownerA, ownerB]) => {
      const { nonce, signatures } = await signedExecution(target, value, data, wallets);
      const tx = await multisig.connect(runDeployer).execute(target, value, data, signatures);
      const receipt = await recordTx(label, tx);
      assertCondition(
        (await multisig.nonce()) === nonce + 1n,
        `${label} did not advance multisig nonce`,
      );
      return { receipt, nonce, signatures };
    };

    const singleExecution = await signedExecution(runDeployer.address, 0n, "0x", [ownerA, ownerB]);
    await expectRevert(
      () =>
        multisig.execute.staticCall(runDeployer.address, 0n, "0x", [singleExecution.signatures[0]]),
      "Single-signature multisig execution",
    );
    report.multisigPolicy.oneSignatureRejected = true;

    const duplicateExecution = await signedExecution(runDeployer.address, 0n, "0x", [
      ownerA,
      ownerB,
    ]);
    await expectRevert(
      () =>
        multisig.execute.staticCall(runDeployer.address, 0n, "0x", [
          duplicateExecution.signatures[0],
          duplicateExecution.signatures[0],
        ]),
      "Duplicate-owner multisig execution",
    );
    report.multisigPolicy.duplicateSignatureRejected = true;

    const nonOwnerExecution = await signedExecution(runDeployer.address, 0n, "0x", [
      ownerA,
      runDeployer,
    ]);
    await expectRevert(
      () =>
        multisig.execute.staticCall(runDeployer.address, 0n, "0x", nonOwnerExecution.signatures),
      "Non-owner multisig execution",
    );
    report.multisigPolicy.nonOwnerSignatureRejected = true;

    const abExecution = await executeMultisig(
      "multisig-two-signature-smoke-ab",
      runDeployer.address,
      0n,
      "0x",
      [ownerA, ownerB],
    );
    report.multisigPolicy.twoSignaturePairsExecuted.push("AB");
    await executeMultisig("multisig-two-signature-smoke-ac", runDeployer.address, 0n, "0x", [
      ownerA,
      ownerC,
    ]);
    report.multisigPolicy.twoSignaturePairsExecuted.push("AC");
    await executeMultisig("multisig-two-signature-smoke-bc", runDeployer.address, 0n, "0x", [
      ownerB,
      ownerC,
    ]);
    report.multisigPolicy.twoSignaturePairsExecuted.push("BC");
    await executeMultisig("multisig-three-signature-smoke", runDeployer.address, 0n, "0x", [
      ownerA,
      ownerB,
      ownerC,
    ]);
    report.multisigPolicy.threeSignatureExecuted = true;
    await expectRevert(
      () => multisig.execute.staticCall(runDeployer.address, 0n, "0x", abExecution.signatures),
      "Multisig replay",
    );
    report.multisigPolicy.replayRejected = true;
    await addStep("eip712-two-of-three-multisig", {
      ...report.multisigPolicy,
      nonceAfterSmoke: await multisig.nonce(),
    });

    currentStep = "deploy-protocol";
    process.env.GOVERNANCE_OWNER = timelockAddress;
    process.env.GOVERNANCE_MULTISIG = multisigAddress;
    const deployed = await deployIntegratedSystem(connection, {
      writeDeployments: false,
      signer: runDeployer,
      artifacts: hre.artifacts,
      transactionConfirmations: config.confirmations,
      transactionTimeoutMs: TX_TIMEOUT_MS,
      onTransactionReceipt: async (label, receipt) => {
        report.transactions[`integrated-${label}`] = publicReceipt(receipt);
        await saveReport();
      },
    });
    const {
      token,
      poseidonT5,
      adultAgeGate,
      personCommitmentVerifier,
      nameDisclosureVerifier,
      groth16VerifierAdapter,
      deepFamily,
      deepFamilyReader,
      deepFamilyImplementationAddress,
      transactionReceipts,
    } = deployed;
    const addresses = {
      token: await token.getAddress(),
      poseidonT5: await poseidonT5.getAddress(),
      adultAgeGate: await adultAgeGate.getAddress(),
      personCommitmentVerifier: await personCommitmentVerifier.getAddress(),
      disclosureBindingVerifier: await nameDisclosureVerifier.getAddress(),
      groth16VerifierAdapter: await groth16VerifierAdapter.getAddress(),
      deepFamily: await deepFamily.getAddress(),
      deepFamilyImplementation: deepFamilyImplementationAddress,
      deepFamilyReader: await deepFamilyReader.getAddress(),
    };
    Object.assign(report.addresses, addresses);
    await saveReport();

    // The callback above persists every receipt immediately so a mid-deployment failure still
    // leaves complete evidence. Keep this invariant check against the final returned map.
    for (const label of Object.keys(transactionReceipts)) {
      assertCondition(
        report.transactions[`integrated-${label}`],
        `Integrated deployment receipt ${label} was not persisted`,
      );
    }

    assertCondition(
      (await deepFamily.owner()) === timelockAddress,
      "DeepFamily owner is not Timelock",
    );
    assertCondition(
      (await token.owner()) === ethers.ZeroAddress,
      "DeepFamilyToken bootstrap owner is active",
    );
    assertCondition(
      (await token.deepFamilyContract()) === addresses.deepFamily,
      "Token to DeepFamily binding mismatch",
    );
    assertCondition(
      (await deepFamily.DEEP_FAMILY_TOKEN_CONTRACT()) === addresses.token,
      "DeepFamily to Token binding mismatch",
    );
    assertCondition(
      (await deepFamilyReader.DEEP_FAMILY()) === addresses.deepFamily,
      "Reader to DeepFamily binding mismatch",
    );
    assertCondition(
      (await deepFamily.verifierRegistry(1, 0)) === addresses.groth16VerifierAdapter &&
        (await deepFamily.verifierRegistry(1, 1)) === addresses.groth16VerifierAdapter,
      "DeepFamily verifier route mismatch",
    );
    assertCondition(
      (await groth16VerifierAdapter.personVerifier()) === addresses.personCommitmentVerifier &&
        (await groth16VerifierAdapter.disclosureBindingVerifier()) ===
          addresses.disclosureBindingVerifier,
      "Groth16 adapter backend mismatch",
    );
    assertCondition(
      (await implementationAddress(ethers, provider, addresses.deepFamily)) ===
        ethers.getAddress(deepFamilyImplementationAddress),
      "Initial ERC-1967 implementation mismatch",
    );
    await addStep("isolated-integrated-protocol-wiring", {
      addresses,
      transactionCount: Object.keys(transactionReceipts).length,
      confirmations: config.confirmations,
    });

    const scheduleOperation = async ({ label, target, data, salt, signers = [ownerA, ownerB] }) => {
      const operationId = await timelock.hashOperation(target, 0n, data, ZERO_HASH, salt);
      const scheduleData = timelock.interface.encodeFunctionData("schedule", [
        target,
        0n,
        data,
        ZERO_HASH,
        salt,
        config.minDelay,
      ]);
      await executeMultisig(`${label}-schedule`, timelockAddress, 0n, scheduleData, signers);
      assertCondition(await timelock.isOperationPending(operationId), `${label} is not pending`);
      return { operationId, target, data, salt };
    };
    const executeOperation = async (label, operation, signers = [ownerA, ownerB]) => {
      const executeData = timelock.interface.encodeFunctionData("execute", [
        operation.target,
        0n,
        operation.data,
        ZERO_HASH,
        operation.salt,
      ]);
      await executeMultisig(`${label}-execute`, timelockAddress, 0n, executeData, signers);
      assertCondition(
        await timelock.isOperationDone(operation.operationId),
        `${label} is not done`,
      );
    };

    currentStep = "governance-fee";
    const feeBefore = await deepFamily.protocolEndorsementFeeBps();
    const newFee = feeBefore === 501n ? 502n : 501n;
    const feeData = deepFamily.interface.encodeFunctionData("updateEndorsementFee", [newFee]);
    const feeOperation = await scheduleOperation({
      label: "fee-update",
      target: addresses.deepFamily,
      data: feeData,
      salt: ethers.id(`deepfamily-e2e:${config.runId}:fee-update`),
      signers: [ownerA, ownerB],
    });
    const earlyExecuteData = timelock.interface.encodeFunctionData("execute", [
      feeOperation.target,
      0n,
      feeOperation.data,
      ZERO_HASH,
      feeOperation.salt,
    ]);
    const early = await signedExecution(timelockAddress, 0n, earlyExecuteData, [ownerB, ownerC]);
    const nonceBeforeEarly = await multisig.nonce();
    await expectRevert(
      () => multisig.execute.staticCall(timelockAddress, 0n, earlyExecuteData, early.signatures),
      "Early Timelock execution",
    );
    assertCondition((await multisig.nonce()) === nonceBeforeEarly, "Early execution changed nonce");
    assertCondition(
      (await deepFamily.protocolEndorsementFeeBps()) === feeBefore,
      "Early execution changed endorsement fee",
    );
    await waitForReady(timelock, feeOperation.operationId, config.minDelay);
    await executeOperation("fee-update", feeOperation, [ownerA, ownerC]);
    assertCondition(
      (await deepFamily.protocolEndorsementFeeBps()) === newFee,
      "Governed endorsement fee was not updated",
    );

    const cancelledFee = newFee === 502n ? 503n : 502n;
    const cancelOperation = await scheduleOperation({
      label: "fee-update-cancelled",
      target: addresses.deepFamily,
      data: deepFamily.interface.encodeFunctionData("updateEndorsementFee", [cancelledFee]),
      salt: ethers.id(`deepfamily-e2e:${config.runId}:cancel`),
      signers: [ownerB, ownerC],
    });
    const cancelData = timelock.interface.encodeFunctionData("cancel", [
      cancelOperation.operationId,
    ]);
    await executeMultisig("fee-update-cancel", timelockAddress, 0n, cancelData, [ownerA, ownerB]);
    assertCondition(
      !(await timelock.isOperation(cancelOperation.operationId)),
      "Cancelled operation still exists",
    );
    assertCondition(
      (await deepFamily.protocolEndorsementFeeBps()) === newFee,
      "Cancelled operation changed the endorsement fee",
    );
    const cancelledExecuteData = timelock.interface.encodeFunctionData("execute", [
      cancelOperation.target,
      0n,
      cancelOperation.data,
      ZERO_HASH,
      cancelOperation.salt,
    ]);
    const cancelledExecution = await signedExecution(timelockAddress, 0n, cancelledExecuteData, [
      ownerA,
      ownerC,
    ]);
    await expectRevert(
      () =>
        multisig.execute.staticCall(
          timelockAddress,
          0n,
          cancelledExecuteData,
          cancelledExecution.signatures,
        ),
      "Execution of a cancelled Timelock operation",
    );
    report.governance = {
      feeBefore,
      feeAfter: newFee,
      executedOperationId: feeOperation.operationId,
      cancelledOperationId: cancelOperation.operationId,
      earlyExecutionRejected: true,
      cancelled: true,
      cancelledExecutionRejected: true,
      signaturePairs: {
        feeSchedule: "AB",
        feeExecute: "AC",
        cancelledFeeSchedule: "BC",
        cancel: "AB",
      },
    };
    await addStep("multisig-timelock-schedule-wait-execute-cancel", report.governance);

    currentStep = "real-zk-business";
    const person = {
      fullName: `DeepFamily eSpace E2E ${config.runId}`,
      derivedSecretField: 0n,
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 1,
      birthDay: 1,
      gender: 3,
    };
    const father = {
      fullName: `DeepFamily eSpace E2E Father ${config.runId}`,
      derivedSecretField: 0n,
      isBirthBC: false,
      birthYear: 1960,
      birthMonth: 1,
      birthDay: 1,
      gender: 1,
    };
    const mother = {
      fullName: `DeepFamily eSpace E2E Mother ${config.runId}`,
      derivedSecretField: 0n,
      isBirthBC: false,
      birthYear: 1962,
      birthMonth: 1,
      birthDay: 1,
      gender: 2,
    };
    const personProof = await withTimeout(
      generatePersonCommitmentProof(person, father, mother, runDeployer.address),
      PROOF_TIMEOUT_MS,
      "Person commitment proof generation",
    );
    assertCondition(
      personProof.father && personProof.mother,
      "Complete parent commitments missing",
    );
    const rewardBalanceBefore = await token.balanceOf(runDeployer.address);
    const addPersonTx = await deepFamily
      .connect(runDeployer)
      .addPersonVersion(
        personProof.proofEnvelope,
        personProof.publicSignalsStruct,
        0,
        0,
        "espace-e2e-v1",
        `ipfs://deepfamily-e2e/${config.runId}/person`,
      );
    await recordTx("zk-add-person", addPersonTx);
    const personHash = personProof.person.personHash;
    assertCondition(
      (await deepFamily.personVersionsCount(personHash)) === 1n,
      "Person version missing",
    );
    const reward = await token.recentReward();
    const rewardBalanceAfter = await token.balanceOf(runDeployer.address);
    assertCondition(reward > 0n, "Complete-parent person did not produce a DEEP reward");
    assertCondition(
      rewardBalanceAfter - rewardBalanceBefore === reward,
      "DEEP reward balance delta mismatch",
    );

    await recordTx(
      "endorsement-approve",
      await token.connect(runDeployer).approve(addresses.deepFamily, reward),
    );
    const treasuryBefore = await token.balanceOf(timelockAddress);
    await recordTx(
      "endorse-person-version",
      await deepFamily.connect(runDeployer).endorseVersion(personHash, 1),
    );
    const protocolShare = (reward * newFee) / 10_000n;
    const treasuryAfter = await token.balanceOf(timelockAddress);
    assertCondition(protocolShare > 0n, "Calculated protocol share is zero");
    assertCondition(
      treasuryAfter - treasuryBefore === protocolShare,
      "Protocol endorsement share did not reach Timelock",
    );

    const disclosureProof = await withTimeout(
      generateDisclosureBindingProof(person, runDeployer.address),
      PROOF_TIMEOUT_MS,
      "Disclosure binding proof generation",
    );
    const identityCommitment = ethers.zeroPadValue(
      ethers.toBeHex(personProof.person.identityCommitment),
      32,
    );
    const coreInfo = {
      basicInfo: {
        identityCommitment,
        isBirthBC: person.isBirthBC,
        birthYear: person.birthYear,
        birthMonth: person.birthMonth,
        birthDay: person.birthDay,
        gender: person.gender,
      },
      supplementInfo: {
        fullName: disclosureProof.canonicalFullName,
        birthPlace: "Conflux eSpace Testnet",
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: "",
        story: "DeepFamily automated eSpace acceptance identity",
      },
    };
    await recordTx(
      "zk-mint-person-nft",
      await deepFamily
        .connect(runDeployer)
        .mintPersonVersionNFT(
          disclosureProof.proofEnvelope,
          disclosureProof.publicSignalsStruct,
          1,
          `ipfs://deepfamily-e2e/${config.runId}/nft`,
          coreInfo,
        ),
    );
    const tokenId = await deepFamily.versionToTokenId(personHash, 1);
    assertCondition(tokenId > 0n, "NFT token ID was not assigned");
    assertCondition(
      (await deepFamily.ownerOf(tokenId)) === runDeployer.address,
      "NFT owner mismatch",
    );

    const storyContent = `Conflux eSpace automated acceptance ${config.runId}`;
    const storyHash = ethers.keccak256(ethers.toUtf8Bytes(storyContent));
    await recordTx(
      "story-add-chunk",
      await deepFamily
        .connect(runDeployer)
        .addStoryChunk(tokenId, 0, 0, storyContent, "", storyHash),
    );
    const storyChunk = await deepFamilyReader.getStoryChunk(tokenId, 0);
    assertCondition(storyChunk.content === storyContent, "Reader returned different story content");
    assertCondition(storyChunk.chunkHash === storyHash, "Reader returned different story hash");
    await recordTx("story-seal", await deepFamily.connect(runDeployer).sealStory(tokenId));
    const storyMetadata = await deepFamilyReader.getStoryMetadata(tokenId);
    assertCondition(storyMetadata.isSealed, "Story is not sealed");
    await expectRevert(
      () =>
        deepFamily
          .connect(runDeployer)
          .addStoryChunk.staticCall(tokenId, 1, 0, "after seal", "", ethers.ZeroHash),
      "Writing a sealed story",
    );
    await recordTx(
      "cancel-endorsement",
      await deepFamily.connect(runDeployer).cancelEndorsement(personHash),
    );
    assertCondition(
      (await deepFamily.endorsedVersionIndex(personHash, runDeployer.address)) === 0n,
      "Endorsement cancellation did not clear the index",
    );
    report.business = {
      personHash,
      versionIndex: 1,
      fatherAndMotherCommitments: true,
      parentRecordsRequiredOnChain: false,
      reward,
      protocolShare,
      tokenId,
      storyHash,
      storySealed: true,
      endorsementCancelled: true,
    };
    await addStep("real-zk-endorsement-nft-story", report.business);

    currentStep = "treasury";
    const treasuryAmount = ethers.parseEther("1");
    assertCondition(
      (await token.balanceOf(timelockAddress)) >= treasuryAmount,
      "Timelock treasury has less than 1 DEEP",
    );
    const treasuryRecipient = ownerA.address;
    const recipientBefore = await token.balanceOf(treasuryRecipient);
    const treasuryOperation = await scheduleOperation({
      label: "treasury-transfer",
      target: addresses.token,
      data: token.interface.encodeFunctionData("transfer", [treasuryRecipient, treasuryAmount]),
      salt: ethers.id(`deepfamily-e2e:${config.runId}:treasury`),
      signers: [ownerA, ownerC],
    });
    await waitForReady(timelock, treasuryOperation.operationId, config.minDelay);
    await executeOperation("treasury-transfer", treasuryOperation, [ownerB, ownerC]);
    const recipientAfter = await token.balanceOf(treasuryRecipient);
    assertCondition(
      recipientAfter - recipientBefore === treasuryAmount,
      "Delayed treasury transfer balance delta mismatch",
    );
    report.treasury = {
      operationId: treasuryOperation.operationId,
      recipient: treasuryRecipient,
      amount: treasuryAmount,
      balanceBefore: treasuryBefore,
      balanceAfterEndorsement: treasuryAfter,
      signaturePairs: { schedule: "AC", execute: "BC" },
    };
    await addStep("delayed-deep-treasury-transfer", report.treasury);

    currentStep = "upgrade-candidate";
    await assertImplementationStorageSafe(hre, "DeepFamily", "DeepFamilyV2Mock");
    const v2 = await deploy("DeepFamilyV2Mock", runDeployer, [], {
      libraries: {
        PoseidonT5: addresses.poseidonT5,
        AdultAgeGate: addresses.adultAgeGate,
      },
    });
    const v2Address = await v2.getAddress();
    await assertImplementationMatchesArtifact({
      connection,
      ethers,
      hre,
      contractName: "DeepFamilyV2Mock",
      implementation: v2Address,
      spec: {
        needsLibraries: true,
        libraryAddresses: {
          PoseidonT5: addresses.poseidonT5,
          AdultAgeGate: addresses.adultAgeGate,
        },
      },
    });
    report.addresses.deepFamilyV2 = v2Address;
    await saveReport();

    const deepFamilyFactory = await ethers.getContractFactory("DeepFamily", {
      signer: runDeployer,
      libraries: {
        PoseidonT5: addresses.poseidonT5,
        AdultAgeGate: addresses.adultAgeGate,
      },
    });
    const proxyInitData = deepFamilyFactory.interface.encodeFunctionData("initialize", [
      addresses.token,
      runDeployer.address,
    ]);
    const verificationEntries = [
      await verificationEntry(hre.artifacts, "E2ETestnetMultisig", multisigAddress, [
        ownerA.address,
        ownerB.address,
        ownerC.address,
      ]),
      await verificationEntry(hre.artifacts, "GovernanceTimelock", timelockAddress, [
        config.minDelay,
        multisigAddress,
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
      await verificationEntry(hre.artifacts, "DeepFamilyV2Mock", v2Address, [], {
        PoseidonT5: addresses.poseidonT5,
        AdultAgeGate: addresses.adultAgeGate,
      }),
    ];
    let verificationFailures = [];
    if (config.verify) {
      verificationFailures = await verifyEntries(verificationEntries, report, saveReport);
    }

    currentStep = "timelocked-upgrade";
    await expectRevert(
      () => deepFamily.connect(runDeployer).upgradeToAndCall.staticCall(v2Address, "0x"),
      "Direct deployer UUPS upgrade",
    );
    const implementationBefore = await implementationAddress(
      ethers,
      provider,
      addresses.deepFamily,
    );
    const upgradeOperation = await scheduleOperation({
      label: "uups-upgrade",
      target: addresses.deepFamily,
      data: deepFamily.interface.encodeFunctionData("upgradeToAndCall", [v2Address, "0x"]),
      salt: ethers.id(`deepfamily-e2e:${config.runId}:upgrade`),
      signers: [ownerA, ownerB],
    });
    await waitForReady(timelock, upgradeOperation.operationId, config.minDelay);
    await executeOperation("uups-upgrade", upgradeOperation, [ownerA, ownerC]);
    const implementationAfter = await implementationAddress(ethers, provider, addresses.deepFamily);
    assertCondition(
      implementationAfter === ethers.getAddress(v2Address),
      "ERC-1967 implementation slot was not updated",
    );
    const deepFamilyV2 = await ethers.getContractAt(
      "DeepFamilyV2Mock",
      addresses.deepFamily,
      runDeployer,
    );
    assertCondition((await deepFamilyV2.version()) === "V2", "Upgraded proxy does not expose V2");
    assertCondition(
      (await deepFamilyV2.owner()) === timelockAddress,
      "Upgrade changed DeepFamily owner",
    );
    assertCondition(
      (await deepFamilyV2.personVersionsCount(personHash)) === 1n &&
        (await deepFamilyV2.versionToTokenId(personHash, 1)) === tokenId,
      "Upgrade did not preserve person/NFT state",
    );
    assertCondition(
      (await deepFamilyV2.DEEP_FAMILY_TOKEN_CONTRACT()) === addresses.token &&
        (await token.deepFamilyContract()) === addresses.deepFamily &&
        (await token.owner()) === ethers.ZeroAddress,
      "Upgrade changed Token wiring",
    );
    assertCondition(
      (await deepFamilyV2.verifierRegistry(1, 0)) === addresses.groth16VerifierAdapter &&
        (await deepFamilyV2.verifierRegistry(1, 1)) === addresses.groth16VerifierAdapter,
      "Upgrade changed verifier routes",
    );
    assertCondition(
      (await deepFamilyV2.protocolEndorsementFeeBps()) === newFee,
      "Upgrade changed the governed endorsement fee",
    );
    assertCondition(
      (await deepFamilyV2.endorsedVersionIndex(personHash, runDeployer.address)) === 0n,
      "Upgrade changed the cancelled endorsement state",
    );
    const storyMetadataAfterUpgrade = await deepFamilyReader.getStoryMetadata(tokenId);
    assertCondition(
      storyMetadataAfterUpgrade.isSealed &&
        storyMetadataAfterUpgrade.totalChunks === storyMetadata.totalChunks &&
        storyMetadataAfterUpgrade.fullStoryHash === storyMetadata.fullStoryHash,
      "Upgrade changed the sealed story state",
    );
    await recordTx("v2-set-new-value", await deepFamilyV2.setNewValue(42));
    assertCondition((await deepFamilyV2.newValue()) === 42n, "V2 appended storage is not writable");
    report.upgrade = {
      storageLayoutSafe: true,
      candidateRuntimeArtifactMatch: true,
      operationId: upgradeOperation.operationId,
      implementationBefore,
      implementationAfter,
      version: "V2",
      ownerPreserved: true,
      businessStatePreserved: true,
      keyWiringPreserved: true,
      governedFeePreserved: true,
      sealedStoryPreserved: true,
      newValue: 42,
      signaturePairs: { schedule: "AB", execute: "AC" },
    };
    await addStep("storage-safe-timelocked-uups-upgrade", report.upgrade);
    report.onchain.status = "passed";
    await saveReport();

    // This is an isolated, disposable test system: complete the on-chain upgrade exercise even
    // when ConfluxScan is temporarily unavailable, but fail the overall release acceptance. A
    // production upgrade must never use this exception; its candidate verification is a gate.
    if (config.verify && verificationFailures.length > 0) {
      currentStep = "explorer-verification";
      throw new Error(
        `On-chain acceptance passed, but ${verificationFailures.length} ConfluxScan verification(s) failed; see report`,
      );
    }

    currentStep = "deployment-directory-integrity";
    const deploymentsAfter = await hashDirectory(ethers, DEPLOYMENTS_DIR);
    report.deploymentsDirectory.after = deploymentsAfter;
    report.deploymentsDirectory.unchanged =
      deploymentsBefore.fileCount === deploymentsAfter.fileCount &&
      deploymentsBefore.digest === deploymentsAfter.digest;
    assertCondition(
      report.deploymentsDirectory.unchanged,
      `${DEPLOYMENTS_DIR} changed during isolated acceptance run`,
    );
    await addStep("deployment-directory-unchanged", deploymentsAfter);
    report.status = "passed";
  } catch (error) {
    originalError = error;
    report.status = "failed";
    report.failedStep = currentStep;
    report.error = safeErrorMessage(error, secretValues);
    if (report.onchain.status !== "passed") report.onchain.status = "failed";
  } finally {
    if (oldGovernanceOwner === undefined) delete process.env.GOVERNANCE_OWNER;
    else process.env.GOVERNANCE_OWNER = oldGovernanceOwner;
    if (oldGovernanceMultisig === undefined) delete process.env.GOVERNANCE_MULTISIG;
    else process.env.GOVERNANCE_MULTISIG = oldGovernanceMultisig;

    if (funded) {
      try {
        report.budget.refund = await refundWallet({
          ethers,
          provider,
          wallet: runDeployer,
          recipient: funder.address,
          confirmations: config.confirmations,
        });
      } catch (refundError) {
        report.budget.refund = {
          status: "failed",
          error: safeErrorMessage(refundError, secretValues),
        };
        if (!originalError) {
          originalError = refundError;
          report.status = "failed";
          report.failedStep = "refund";
          report.error = safeErrorMessage(refundError, secretValues);
        }
      }
    } else {
      report.budget.refund = { status: "not-funded" };
    }

    report.budget.funderBalanceAfter = await provider.getBalance(funder.address).catch(() => null);
    report.budget.runBalanceAfter = await provider
      .getBalance(runDeployer.address)
      .catch(() => null);
    if (
      funded &&
      report.budget.runBalanceAfter !== null &&
      typeof report.budget.refund?.amount === "bigint"
    ) {
      report.budget.spentWei =
        config.maxCfx - report.budget.refund.amount - report.budget.runBalanceAfter;
      report.budget.spentCfx = ethers.formatEther(report.budget.spentWei);
    }
    if (!report.deploymentsDirectory.after) {
      try {
        report.deploymentsDirectory.after = await hashDirectory(ethers, DEPLOYMENTS_DIR);
        report.deploymentsDirectory.unchanged =
          deploymentsBefore.fileCount === report.deploymentsDirectory.after.fileCount &&
          deploymentsBefore.digest === report.deploymentsDirectory.after.digest;
      } catch (directoryError) {
        report.deploymentsDirectory.error = safeErrorMessage(directoryError);
      }
    }
    if (report.deploymentsDirectory.unchanged === false && !originalError) {
      originalError = new Error(`${DEPLOYMENTS_DIR} changed during isolated acceptance run`);
      report.status = "failed";
      report.failedStep = "deployment-directory-integrity";
      report.error = originalError.message;
    }
    report.finishedAt = nowIso();
    await saveReport();
    console.log(`[espace-acceptance] report: ${reportPath}`);
  }

  if (originalError) {
    console.error(`[espace-acceptance] FAILED at ${report.failedStep}: ${report.error}`);
    throw new Error(report.error);
  }
  console.log(`[espace-acceptance] PASSED run ${config.runId}`);
};

main().catch((error) => {
  console.error(
    `[espace-acceptance] ${safeErrorMessage(error, [String(process.env.PRIVATE_KEY || "")])}`,
  );
  process.exitCode = 1;
});
