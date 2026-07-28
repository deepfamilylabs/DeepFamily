import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";

import {
  TESTNET_RELEASE_READINESS_GATES,
  TESTNET_RELEASE_REQUIRED_STEPS,
  validateTestnetReleaseEvidence,
} from "../scripts/lib/testnetReleaseEvidence.mjs";

const COMMIT = "12".repeat(20);
const INPUT_DIGEST = `0x${"34".repeat(32)}`;
const FINALIZED_BLOCK_HASH = `0x${"56".repeat(32)}`;
const FINALIZED_TRANSACTION_HASH = `0x${"78".repeat(32)}`;
const REFUND_TRANSACTION_HASH = `0x${"9a".repeat(32)}`;
const MIN_DELAY = 172800;
const CHAIN_ID = 71;
const address = (suffix) => `0x${String(suffix).padStart(40, "0")}`;
const PRIMARY_SAFE = address(1);
const REPLACEMENT_SAFE = address(2);
const PRIMARY_TIMELOCK = address(3);
const REPLACEMENT_TIMELOCK = address(4);
const DEEP_FAMILY = address(5);
const DEEP_FAMILY_V2 = address(6);
const TOKEN = address(7);
const GOVERNED_VERIFIER = address(8);
const DISCLOSURE_ADAPTER = address(9);
const PRIMARY_OWNERS = [address(11), address(12), address(13)];
const REPLACEMENT_OWNERS = [address(14), address(15), address(16)];
const COMPONENT_HASH = `0x${"ab".repeat(32)}`;
const ROLE_HASH = `0x${"bc".repeat(32)}`;
const ZERO_ADDRESS = `0x${"00".repeat(20)}`;
const ZERO_HASH = `0x${"00".repeat(32)}`;
const VERIFIED_CONTRACTS = [
  ["initial-deployment", "GovernanceTimelock"],
  ["initial-deployment", "DeepFamilyToken"],
  ["initial-deployment", "PoseidonT5"],
  ["initial-deployment", "AdultAgeGate"],
  ["initial-deployment", "PersonCommitmentVerifier"],
  ["initial-deployment", "DisclosureBindingVerifier"],
  ["initial-deployment", "Groth16VerifierAdapter"],
  ["initial-deployment", "GovernedVerifierCandidate"],
  ["initial-deployment", "DeepFamily"],
  ["initial-deployment", "UUPSProxy"],
  ["initial-deployment", "DeepFamilyReader"],
  ["upgrade-candidate", "DeepFamilyV2Mock"],
  ["governance-replacements", "ReplacementGovernanceTimelock"],
];

const terminalSafe = (safeAddress, owners, nonce) => ({
  chainId: String(CHAIN_ID),
  safeAddress,
  safeVersion: "1.3.0",
  singleton: address(20),
  owners,
  threshold: 2,
  nonce: String(nonce),
  modules: [],
  guard: ZERO_ADDRESS,
  fallbackHandler: address(21),
  proxyCodeHash: COMPONENT_HASH,
  canonicalProxyCodeHash: COMPONENT_HASH,
  componentCodeHashes: {
    singleton: COMPONENT_HASH,
    proxyFactory: COMPONENT_HASH,
    fallbackHandler: COMPONENT_HASH,
  },
});

const terminalTimelock = (timelockAddress, minDelay) => ({
  address: timelockAddress,
  adminRole: ZERO_HASH,
  admin: timelockAddress,
  roles: {
    PROPOSER_ROLE: ROLE_HASH,
    CANCELLER_ROLE: ROLE_HASH,
    EXECUTOR_ROLE: ROLE_HASH,
  },
  currentMultisig: REPLACEMENT_SAFE,
  minDelay: String(minDelay),
});

const validReport = () => ({
  schemaVersion: 3,
  mode: "acceptance",
  acceptanceMode: "release-rehearsal",
  status: "passed",
  releaseReady: true,
  failedStep: null,
  error: null,
  runId: "release-rehearsal-20260728",
  startedAt: "2026-07-28T01:00:00.000Z",
  finishedAt: "2026-07-28T02:00:00.000Z",
  releaseCommit: COMMIT,
  sourceState: {
    commit: COMMIT,
    clean: true,
    changedPathCount: 0,
    unchanged: true,
    acceptanceInputDigest: INPUT_DIGEST,
    acceptanceInputs: { digest: INPUT_DIGEST },
    after: {
      commit: COMMIT,
      clean: true,
      changedPathCount: 0,
      acceptanceInputDigest: INPUT_DIGEST,
      acceptanceInputs: { digest: INPUT_DIGEST },
    },
  },
  network: {
    name: "confluxTestnet",
    chainId: String(CHAIN_ID),
    confirmations: 2,
    finality: {
      required: true,
      status: "passed",
      lastCriticalBlock: 100,
      finalizedBlockNumber: 105,
      finalizedBlockHash: FINALIZED_BLOCK_HASH,
      revalidatedTransactionCount: 1,
      revalidatedTransactions: [
        {
          label: "critical-transaction",
          hash: FINALIZED_TRANSACTION_HASH,
          blockNumber: 100,
          blockHash: FINALIZED_BLOCK_HASH,
          status: 1,
        },
      ],
    },
  },
  transactions: {
    "critical-transaction": {
      hash: FINALIZED_TRANSACTION_HASH,
      blockNumber: 100,
      blockHash: FINALIZED_BLOCK_HASH,
      status: 1,
    },
  },
  addresses: {
    governanceSafe: PRIMARY_SAFE,
    replacementGovernanceSafe: REPLACEMENT_SAFE,
    safeOwners: PRIMARY_OWNERS,
    replacementSafeOwners: REPLACEMENT_OWNERS,
    timelock: PRIMARY_TIMELOCK,
    replacementTimelock: REPLACEMENT_TIMELOCK,
    deepFamily: DEEP_FAMILY,
    deepFamilyV2: DEEP_FAMILY_V2,
    token: TOKEN,
    governedVerifierCandidate: GOVERNED_VERIFIER,
    groth16VerifierAdapter: DISCLOSURE_ADAPTER,
  },
  timelockDeployment: { minDelaySeconds: MIN_DELAY },
  buildState: {
    hardhatBuildProfile: "production",
    artifactsFileCount: 49,
    buildInfoFileCount: 2,
    productionSettingsMatched: true,
  },
  isolatedDeploymentArtifacts: {
    productionWriterExercised: true,
  },
  zkArtifactTrust: {
    status: "passed",
    trustedSetupStatus: "production",
    productionReady: true,
    ceremonyId: "deepfamily-production-2026-01",
    manifestSha256: "11".repeat(32),
    transcriptSha256: "22".repeat(32),
    phase1Sha256: "33".repeat(32),
    contributorCount: 3,
  },
  zkCeremonyVerification: {
    status: "passed",
    ceremonyId: "deepfamily-production-2026-01",
    manifestSha256: "11".repeat(32),
    transcriptSha256: "22".repeat(32),
    contributorCount: 3,
    ptau: { sha256: "33".repeat(32) },
  },
  productionParity: {
    canonicalSafeImplementationMatched: true,
    sameSafeManifestOnTestnetAndMainnet: true,
    mainnetCanonicalSafeInfrastructureMatched: true,
    sameTimelockArtifactAndConfigResolver: true,
    sameProtocolDeploymentHelper: true,
    sameDeploymentMetadataWriter: true,
    sharedGovernanceOperationBuildersMatched: true,
    criticalTransactionsFinalized: true,
    cleanReleaseCommit: true,
    productionBuildProfileMatched: true,
    productionSafeProfileMatched: true,
    artifactManifestCaptured: true,
    productionCompilerSettingsMatched: true,
    productionTrustedSetupMatched: true,
    productionCeremonyVerified: true,
  },
  releaseReadinessGates: Object.fromEntries(
    TESTNET_RELEASE_READINESS_GATES.map((name) => [name, true]),
  ),
  verification: {
    enabled: true,
    status: "passed",
    gateBeforeUpgradeSchedule: true,
    contracts: VERIFIED_CONTRACTS.map(([phase, label], index) => ({
      phase,
      label,
      address: address(100 + index),
      attempts: 1,
      status: "passed",
    })),
    phases: [
      { phase: "initial-deployment", status: "passed" },
      { phase: "upgrade-candidate", status: "passed" },
      { phase: "governance-replacements", status: "passed" },
    ],
  },
  terminalGovernanceState: {
    status: "passed",
    observedAfterFinality: true,
    observedAtBlock: 106,
    safes: {
      primary: terminalSafe(PRIMARY_SAFE, PRIMARY_OWNERS, 18),
      replacement: terminalSafe(REPLACEMENT_SAFE, REPLACEMENT_OWNERS, 3),
    },
    timelocks: {
      retired: terminalTimelock(PRIMARY_TIMELOCK, MIN_DELAY + 1),
      replacement: terminalTimelock(REPLACEMENT_TIMELOCK, MIN_DELAY),
    },
    deepFamily: {
      address: DEEP_FAMILY,
      owner: REPLACEMENT_TIMELOCK,
      implementation: DEEP_FAMILY_V2,
      personCommitmentVerifier: GOVERNED_VERIFIER,
      disclosureBindingVerifier: DISCLOSURE_ADAPTER,
      protocolEndorsementFeeBps: "502",
    },
    token: {
      address: TOKEN,
      owner: ZERO_ADDRESS,
      deepFamilyContract: DEEP_FAMILY,
      deepFamilyTokenFromProtocol: TOKEN,
    },
    retiredTimelockTreasuryBalance: "0",
  },
  budget: {
    refund: {
      status: "passed",
      transaction: { hash: REFUND_TRANSACTION_HASH, status: 1 },
    },
  },
  onchain: { status: "passed" },
  deploymentsDirectory: { unchanged: true },
  steps: TESTNET_RELEASE_REQUIRED_STEPS.map((name) => ({ name, status: "passed" })),
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

describe("schema v3 testnet release-rehearsal evidence", function () {
  let repositoryRoot;
  let reportPath;

  const validate = (overrides = {}) =>
    validateTestnetReleaseEvidence({
      reportPath,
      repositoryRoot,
      expectedTestnetChainId: CHAIN_ID,
      expectedTestnetNetworkName: "confluxTestnet",
      mainnetMinDelaySeconds: MIN_DELAY,
      currentCommit: COMMIT,
      ...overrides,
    });

  const writeReport = async (report = validReport(), target = reportPath) => {
    const raw = `${JSON.stringify(report, null, 2)}\n`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, raw);
    return raw;
  };

  beforeEach(async function () {
    repositoryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "deepfamily-testnet-release-evidence-"),
    );
    reportPath = path.join(repositoryRoot, "archive", "release-rehearsal.json");
  });

  afterEach(async function () {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  });

  it("accepts an explicit in-repository report and returns a frozen public summary and SHA-256", async function () {
    const raw = await writeReport();
    const result = await validate();

    expect(result.reportPath).to.equal(reportPath);
    expect(result.reportSha256).to.equal(createHash("sha256").update(raw).digest("hex"));
    expect(result.publicSummary.evidenceFile).to.deep.include({
      fileName: "release-rehearsal.json",
      location: "repository",
      repositoryRelativePath: "archive/release-rehearsal.json",
      sha256: result.reportSha256,
    });
    expect(result.publicSummary).to.deep.include({
      schemaVersion: 3,
      acceptanceMode: "release-rehearsal",
      releaseReady: true,
      releaseCommit: COMMIT,
      minDelaySeconds: MIN_DELAY,
      readinessGateCount: TESTNET_RELEASE_READINESS_GATES.length,
      passedStepCount: TESTNET_RELEASE_REQUIRED_STEPS.length,
    });
    expect(result.publicSummary.network).to.deep.equal({
      name: "confluxTestnet",
      chainId: "71",
      confirmations: 2,
    });
    expect(result.publicSummary.verification.verifiedContractCount).to.equal(
      VERIFIED_CONTRACTS.length,
    );
    expect(result.publicSummary.zkArtifacts).to.deep.equal({
      status: "passed",
      trustedSetupStatus: "production",
      productionReady: true,
    });
    expect(result.publicSummary.finality.revalidatedTransactionCount).to.equal(1);
    expect(result.publicSummary.refund.transactionHash).to.equal(REFUND_TRANSACTION_HASH);
    expect(Object.isFrozen(result)).to.equal(true);
    expect(Object.isFrozen(result.publicSummary)).to.equal(true);
    expect(Object.isFrozen(result.publicSummary.finality)).to.equal(true);
  });

  it("uses caller-selected chain evidence and is not hard-coded to eSpace", async function () {
    const sepoliaChainId = 11155111;
    const report = validReport();
    report.network.name = "sepolia";
    report.network.chainId = String(sepoliaChainId);
    report.terminalGovernanceState.safes.primary.chainId = String(sepoliaChainId);
    report.terminalGovernanceState.safes.replacement.chainId = String(sepoliaChainId);
    await writeReport(report);

    const result = await validate({
      expectedTestnetChainId: sepoliaChainId,
      expectedTestnetNetworkName: "sepolia",
    });
    expect(result.publicSummary.network).to.deep.equal({
      name: "sepolia",
      chainId: String(sepoliaChainId),
      confirmations: 2,
    });
  });

  it("requires an explicit regular JSON file and rejects symlinks", async function () {
    await writeReport();
    await expectRejected(
      () => validate({ reportPath: undefined }),
      /reportPath must be supplied explicitly/iu,
    );

    const textPath = path.join(repositoryRoot, "report.txt");
    await fs.writeFile(textPath, "{}");
    await expectRejected(() => validate({ reportPath: textPath }), /explicit \.json file/iu);

    const directoryPath = path.join(repositoryRoot, "directory.json");
    await fs.mkdir(directoryPath);
    await expectRejected(() => validate({ reportPath: directoryPath }), /must be a regular file/iu);

    const symlinkPath = path.join(repositoryRoot, "linked-report.json");
    await fs.symlink(reportPath, symlinkPath);
    await expectRejected(
      () => validate({ reportPath: symlinkPath }),
      /must not be a symbolic link/iu,
    );

    const symlinkedDirectory = path.join(repositoryRoot, "linked-archive");
    await fs.symlink(path.dirname(reportPath), symlinkedDirectory, "dir");
    await expectRejected(
      () =>
        validate({
          reportPath: path.join(symlinkedDirectory, path.basename(reportPath)),
        }),
      /must not traverse a symbolic link/iu,
    );

    const invalidJsonPath = path.join(repositoryRoot, "invalid.json");
    await fs.writeFile(invalidJsonPath, "{not-json");
    await expectRejected(
      () => validate({ reportPath: invalidJsonPath }),
      /must contain valid JSON/iu,
    );
  });

  it("rejects an external archive by default and accepts one only through the explicit opt-in", async function () {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    const externalRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "deepfamily-external-release-archive-"),
    );
    const externalReportPath = path.join(externalRoot, "release.json");
    try {
      await writeReport(validReport(), externalReportPath);
      await expectRejected(
        () => validate({ reportPath: externalReportPath }),
        /inside repositoryRoot unless allowExternalArchive=true/iu,
      );
      const result = await validate({
        reportPath: externalReportPath,
        allowExternalArchive: true,
      });
      expect(result.publicSummary.evidenceFile.location).to.equal("external-archive");
      expect(result.publicSummary.evidenceFile.repositoryRelativePath).to.equal(null);
    } finally {
      await fs.rm(externalRoot, { recursive: true, force: true });
    }
  });

  it("strictly requires the release report identity and exact target chain", async function () {
    const mutations = [
      ["schemaVersion", 2, /schemaVersion must be 3/iu],
      ["mode", "recovery", /mode must be "acceptance"/iu],
      ["acceptanceMode", "diagnostic", /acceptanceMode must be "release-rehearsal"/iu],
      ["status", "failed", /status must be "passed"/iu],
      ["releaseReady", false, /releaseReady must be true/iu],
    ];
    for (const [field, value, pattern] of mutations) {
      const report = validReport();
      report[field] = value;
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }

    await writeReport(validReport());
    await expectRejected(
      () => validate({ expectedTestnetChainId: 11155111 }),
      /network\.chainId must be 11155111/iu,
    );
    await expectRejected(
      () => validate({ expectedTestnetNetworkName: "sepolia" }),
      /network\.name must be "sepolia"/iu,
    );
  });

  it("binds releaseCommit and both source snapshots to the current clean commit and digest", async function () {
    const cases = [
      [(report) => (report.releaseCommit = "ab".repeat(20)), /releaseCommit must be "1212/iu],
      [(report) => (report.sourceState.clean = false), /sourceState\.clean must be true/iu],
      [(report) => (report.sourceState.unchanged = false), /sourceState\.unchanged must be true/iu],
      [
        (report) => (report.sourceState.after.commit = "ab".repeat(20)),
        /sourceState\.after\.commit/iu,
      ],
      [
        (report) => (report.sourceState.after.acceptanceInputDigest = `0x${"cd".repeat(32)}`),
        /sourceState\.after\.acceptanceInputDigest/iu,
      ],
      [
        (report) => (report.sourceState.after.acceptanceInputs.digest = `0x${"ef".repeat(32)}`),
        /sourceState\.after\.acceptanceInputs\.digest/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }

    await writeReport(validReport());
    await expectRejected(
      () =>
        validate({
          expectedAcceptanceInputDigest: `0x${"fe".repeat(32)}`,
        }),
      /sourceState\.acceptanceInputDigest must be "0xfefe/iu,
    );
    const result = await validate({ expectedAcceptanceInputDigest: INPUT_DIGEST });
    expect(result.publicSummary.sourceInputDigest).to.equal(INPUT_DIGEST);
  });

  it("requires report and terminal Timelock delays to equal the Mainnet MIN_DELAY", async function () {
    const deploymentMismatch = validReport();
    deploymentMismatch.timelockDeployment.minDelaySeconds = MIN_DELAY + 1;
    await writeReport(deploymentMismatch);
    await expectRejected(() => validate(), /timelockDeployment\.minDelaySeconds must be 172800/iu);

    const terminalMismatch = validReport();
    terminalMismatch.terminalGovernanceState.timelocks.replacement.minDelay = String(MIN_DELAY + 1);
    await writeReport(terminalMismatch);
    await expectRejected(
      () => validate(),
      /terminalGovernanceState\.timelocks\.replacement\.minDelay must be 172800/iu,
    );

    await writeReport(validReport());
    await expectRejected(
      () => validate({ mainnetMinDelaySeconds: 30 }),
      /mainnetMinDelaySeconds must be a safe integer >= 86400/iu,
    );
  });

  it("requires the exact schema v3 readiness gate set and every gate to be true", async function () {
    const failedGate = validReport();
    failedGate.releaseReadinessGates.refundCompleted = false;
    await writeReport(failedGate);
    await expectRejected(() => validate(), /releaseReadinessGates\.refundCompleted must be true/iu);

    const missingGate = validReport();
    delete missingGate.releaseReadinessGates.cleanReleaseCommit;
    await writeReport(missingGate);
    await expectRejected(() => validate(), /exactly the schema v3 gate set/iu);

    const extraGate = validReport();
    extraGate.releaseReadinessGates.unrecognizedGate = true;
    await writeReport(extraGate);
    await expectRejected(() => validate(), /exactly the schema v3 gate set/iu);
  });

  it("requires production Trusted Setup evidence behind the production configuration gate", async function () {
    const cases = [
      [(report) => (report.zkArtifactTrust.status = "failed"), /zkArtifactTrust\.status/iu],
      [
        (report) => (report.zkArtifactTrust.trustedSetupStatus = "development"),
        /zkArtifactTrust\.trustedSetupStatus/iu,
      ],
      [
        (report) => (report.zkArtifactTrust.productionReady = false),
        /zkArtifactTrust\.productionReady/iu,
      ],
      [
        (report) => (report.productionParity.productionTrustedSetupMatched = false),
        /productionParity\.productionTrustedSetupMatched/iu,
      ],
      [
        (report) => (report.releaseReadinessGates.productionConfigurationMatched = false),
        /releaseReadinessGates\.productionConfigurationMatched/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });

  it("cross-checks readiness gates against their production parity and build inputs", async function () {
    const cases = [
      [
        (report) => (report.productionParity.canonicalSafeImplementationMatched = false),
        /productionParity\.canonicalSafeImplementationMatched/iu,
      ],
      [
        (report) => (report.productionParity.sameProtocolDeploymentHelper = false),
        /productionParity\.sameProtocolDeploymentHelper/iu,
      ],
      [
        (report) => (report.productionParity.productionCompilerSettingsMatched = false),
        /productionParity\.productionCompilerSettingsMatched/iu,
      ],
      [
        (report) => (report.buildState.hardhatBuildProfile = "default"),
        /buildState\.hardhatBuildProfile/iu,
      ],
      [(report) => (report.buildState.artifactsFileCount = 0), /buildState\.artifactsFileCount/iu],
      [
        (report) => (report.isolatedDeploymentArtifacts.productionWriterExercised = false),
        /isolatedDeploymentArtifacts\.productionWriterExercised/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });

  it("fails closed when verification, finality, terminal governance or refund evidence is weak", async function () {
    const cases = [
      [(report) => (report.verification.status = "failed"), /verification\.status/iu],
      [
        (report) => (report.verification.contracts[0].status = "pending"),
        /verification\.contracts\[0\]\.status/iu,
      ],
      [(report) => (report.network.finality.status = "pending"), /network\.finality\.status/iu],
      [
        (report) => (report.network.finality.revalidatedTransactionCount = 2),
        /transactions must be non-empty and match/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.status = "pending"),
        /terminalGovernanceState\.status/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.observedAfterFinality = false),
        /observedAfterFinality/iu,
      ],
      [(report) => (report.budget.refund.status = "failed"), /budget\.refund\.status/iu],
      [
        (report) => (report.budget.refund.transaction.status = 0),
        /budget\.refund\.transaction\.status/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });

  it("accepts a schema-valid not-needed refund and rejects inconsistent zero-balance claims", async function () {
    const report = validReport();
    report.budget.refund = {
      status: "not-needed",
      balanceBefore: "0",
      amount: "0",
      balanceAfter: "0",
    };
    await writeReport(report);
    const result = await validate();
    expect(result.publicSummary.refund).to.deep.equal({
      status: "not-needed",
      transactionHash: null,
    });

    report.budget.refund.transaction = { hash: REFUND_TRANSACTION_HASH, status: 1 };
    await writeReport(report);
    await expectRejected(
      () => validate(),
      /transaction must be absent when refund is not-needed/iu,
    );
  });

  it("requires complete transaction finality, verification, step and terminal state evidence", async function () {
    const cases = [
      [
        (report) => delete report.transactions["critical-transaction"],
        /transactions must be non-empty and match/iu,
      ],
      [
        (report) => (report.network.finality.revalidatedTransactions[0].blockNumber = 99),
        /revalidatedTransactions\[0\]\.blockNumber/iu,
      ],
      [
        (report) => report.verification.contracts.pop(),
        /exactly the schema v3 release contract set/iu,
      ],
      [
        (report) =>
          (report.steps = report.steps.filter(
            (step) => step.name !== "terminal-governance-state-verified",
          )),
        /missing required schema v3 steps/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.safes.primary.threshold = 1),
        /safes\.primary\.threshold/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.token.owner = address(999)),
        /terminalGovernanceState\.token\.owner/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.retiredTimelockTreasuryBalance = "1"),
        /retiredTimelockTreasuryBalance/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });

  it("enforces a bounded report size before parsing", async function () {
    await writeReport();
    await expectRejected(() => validate({ maxReportBytes: 10 }), /exceeds maxReportBytes/iu);
  });
});
