import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  inspectProtocolContractInterfaces,
  inspectProtocolReleaseManifest,
  protocolCanonicalJson,
  protocolDeploymentEvidenceFromAcceptanceReport,
  protocolDeploymentEvidenceFromManifest,
  protocolDeploymentEvidenceSha256,
  protocolManifestSha256,
  PROTOCOL_CONTRACT_INTERFACE_ARTIFACTS,
  PROTOCOL_RELEASE_MANIFEST_PATH,
} from "../scripts/lib/protocolReleaseManifest.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const hash = (digit) => digit.repeat(64);
const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;

const HASHES = Object.freeze({
  personSource: hash("1"),
  personR1cs: hash("2"),
  personWasm: hash("3"),
  personZkey: hash("4"),
  personVkey: hash("5"),
  personSolidity: hash("6"),
  disclosureSource: hash("7"),
  disclosureR1cs: hash("8"),
  disclosureWasm: hash("9"),
  disclosureZkey: hash("a"),
  disclosureVkey: hash("b"),
  disclosureSolidity: hash("c"),
  adapterArtifact: hash("d"),
  adapterRuntime: hash("e"),
  archiveArtifact: hash("f"),
  archiveRuntime: hash("1"),
  readerArtifact: hash("2"),
  readerRuntime: hash("3"),
  zkManifest: hash("4"),
  zkTranscript: hash("5"),
});

const ADDRESSES = Object.freeze({
  proxy: address(1),
  implementation: address(2),
  personVerifier: address(3),
  disclosureVerifier: address(4),
  adapter: address(5),
  archive: address(6),
  reader: address(7),
});

const writeCanonicalJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const createContractInterfaceArtifactFixture = () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "deepfamily-contract-interfaces-"),
  );
  const contractInterfaces = structuredClone(
    inspectProtocolReleaseManifest({ root: ROOT }).manifest.contractInterfaces,
  );
  for (const spec of Object.values(PROTOCOL_CONTRACT_INTERFACE_ARTIFACTS)) {
    const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, spec.path), "utf8"));
    writeCanonicalJson(path.join(root, spec.path), {
      contractName: artifact.contractName,
      sourceName: artifact.sourceName,
      abi: artifact.abi,
    });
  }
  const archivePath = path.join(root, PROTOCOL_CONTRACT_INTERFACE_ARTIFACTS.metadataArchiveV1.path);
  return {
    root,
    contractInterfaces,
    mutateArchive(mutator) {
      const archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
      mutator(archive);
      writeCanonicalJson(archivePath, archive);
    },
    inspect() {
      return inspectProtocolContractInterfaces({ root, contractInterfaces });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
};

const KDF_SELECTED_CANDIDATE_ID = "argon2id-m65536-t3-p1-baseline";
const KDF_LATENCY_BUDGETS = Object.freeze({
  identitySingleDerivationP95Milliseconds: 300,
  fileSingleDerivationP95Milliseconds: 300,
  completeAddVersionP95Milliseconds: 2_000,
  serialUnlock: Object.freeze({ versionCount: 3, p95Milliseconds: 2_000 }),
});
const KDF_STRESS_REQUIREMENTS = Object.freeze({
  minimumDurationSeconds: 1_800,
  minimumIterations: 100,
});

const kdfEnvironments = () =>
  ["minimum-mobile", "desktop-browser", "worker"].map((kind) => ({
    environmentId: `${kind}-reference`,
    kind,
    label: `${kind} reference`,
    hardware: `${kind} hardware`,
    operatingSystem: `${kind} operating system`,
    browser: `${kind} browser`,
    runtime: `${kind} runtime`,
    workerMode: "dedicated-worker",
  }));

const basicLatency = (p95Milliseconds) => ({
  sampleCount: 5,
  p50Milliseconds: Math.floor(p95Milliseconds * 0.8),
  p95Milliseconds,
});

const kdfMeasurements = ({ multiplier = 1 } = {}) => ({
  identitySingleDerivation: basicLatency(150 * multiplier),
  fileSingleDerivation: basicLatency(150 * multiplier),
  completeAddVersion: {
    ...basicLatency(1_000 * multiplier),
    identityKdfExecutions: 4,
    fileKdfExecutions: 2,
    proofGenerationExecutions: 1,
    gzipCompressionExecutions: 1,
    gzipDecompressionExecutions: 1,
    aesGcmEncryptions: 2,
    aesGcmDecryptions: 2,
    roundTripDecodeIncluded: true,
    freshInputsPerSample: true,
    reusedIntermediateValues: false,
    componentP95Milliseconds: {
      identityKdf: 400 * multiplier,
      fileKdf: 200 * multiplier,
      proofGeneration: 300 * multiplier,
      gzip: 50 * multiplier,
      aesGcm: 50 * multiplier,
    },
  },
  serialUnlock: {
    versionCount: KDF_LATENCY_BUDGETS.serialUnlock.versionCount,
    ...basicLatency(1_200 * multiplier),
    strictlySerial: true,
    identityKdfExecutionsPerVersion: 1,
    fileKdfExecutionsPerVersion: 1,
    freshInputsPerVersion: true,
    reusedIntermediateValues: false,
  },
});

const kdfEnvironmentResults = ({ memoryKiB, multiplier = 1 } = {}) =>
  kdfEnvironments().map(({ environmentId }) => ({
    environmentId,
    status: "passed",
    stress: {
      durationSeconds: KDF_STRESS_REQUIREMENTS.minimumDurationSeconds,
      iterations: 120,
      peakMemoryMiB: memoryKiB / 1024 + 32,
      oomCount: 0,
      workerCrashCount: 0,
      processCrashCount: 0,
    },
    measurements: kdfMeasurements({ multiplier }),
    failureReason: null,
  }));

const createProductionFixture = () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "deepfamily-production-manifest-"),
  );
  const manifest = structuredClone(inspectProtocolReleaseManifest({ root: ROOT }).manifest);
  manifest.releaseStatus = "production";
  manifest.formats["1"].status = "frozen";
  manifest.identitySuites["1"].status = "frozen";
  manifest.fileKdfSuites["1"].status = "frozen";
  manifest.goldenVectors.status = "frozen";

  const routeHashes = [
    {
      sourceSha256: HASHES.personSource,
      r1csSha256: HASHES.personR1cs,
      wasmSha256: HASHES.personWasm,
      zkeySha256: HASHES.personZkey,
      verificationKeySha256: HASHES.personVkey,
      solidityVerifierSha256: HASHES.personSolidity,
    },
    {
      sourceSha256: HASHES.disclosureSource,
      r1csSha256: HASHES.disclosureR1cs,
      wasmSha256: HASHES.disclosureWasm,
      zkeySha256: HASHES.disclosureZkey,
      verificationKeySha256: HASHES.disclosureVkey,
      solidityVerifierSha256: HASHES.disclosureSolidity,
    },
  ];
  manifest.proofRoutes.forEach((route, index) => {
    route.artifacts = {
      status: "production",
      ...routeHashes[index],
      adapterArtifactSha256: HASHES.adapterArtifact,
      adapterRuntimeSha256: HASHES.adapterRuntime,
    };
  });

  manifest.deployments = {
    status: "production",
    chainId: 1030,
    deepFamilyProxy: ADDRESSES.proxy,
    deepFamilyImplementation: ADDRESSES.implementation,
    groth16VerifierAdapter: {
      address: ADDRESSES.adapter,
      personVerifierImmutable: ADDRESSES.personVerifier,
      disclosureBindingVerifierImmutable: ADDRESSES.disclosureVerifier,
      artifactSha256: HASHES.adapterArtifact,
      runtimeSha256: HASHES.adapterRuntime,
    },
    metadataArchiveV1: {
      address: ADDRESSES.archive,
      deepFamilyImmutable: ADDRESSES.proxy,
      artifactSha256: HASHES.archiveArtifact,
      runtimeSha256: HASHES.archiveRuntime,
    },
    deepFamilyReader: {
      address: ADDRESSES.reader,
      deepFamilyImmutable: ADDRESSES.proxy,
      metadataArchiveImmutable: ADDRESSES.archive,
      artifactSha256: HASHES.readerArtifact,
      runtimeSha256: HASHES.readerRuntime,
    },
  };

  const kdfProfiles = [
    ["identity", manifest.identitySuites["1"].kdf],
    ["file", manifest.fileKdfSuites["1"].kdf],
  ];
  const heavierKdf = {
    ...structuredClone(manifest.identitySuites["1"].kdf),
    memoryKiB: 131_072,
  };
  const deviceMatrix = {
    schemaVersion: 2,
    evidenceType: "deepfamily/kdf-device-matrix-v2",
    protocol: manifest.protocol,
    protocolGeneration: manifest.protocolGeneration,
    status: "passed",
    selectedCandidateId: KDF_SELECTED_CANDIDATE_ID,
    latencyBudgets: structuredClone(KDF_LATENCY_BUDGETS),
    stressRequirements: structuredClone(KDF_STRESS_REQUIREMENTS),
    environments: kdfEnvironments(),
    candidates: [
      {
        candidateId: KDF_SELECTED_CANDIDATE_ID,
        kdf: structuredClone(manifest.identitySuites["1"].kdf),
        environmentResults: kdfEnvironmentResults({
          memoryKiB: manifest.identitySuites["1"].kdf.memoryKiB,
        }),
      },
      {
        candidateId: "argon2id-m131072-t3-p1-heavier",
        kdf: heavierKdf,
        environmentResults: kdfEnvironmentResults({
          memoryKiB: heavierKdf.memoryKiB,
          multiplier: 2,
        }),
      },
    ],
    selection: {
      selectedCandidateId: KDF_SELECTED_CANDIDATE_ID,
      ordering: "memoryKiB-desc-then-iterations-desc",
      allRequiredEnvironmentsReliable: true,
      allRequiredEnvironmentsWithinBudget: true,
    },
  };
  const attackerStudy = {
    schemaVersion: 2,
    evidenceType: "deepfamily/kdf-attacker-cost-study-v2",
    protocol: manifest.protocol,
    protocolGeneration: manifest.protocolGeneration,
    status: "passed",
    selectedCandidateId: KDF_SELECTED_CANDIDATE_ID,
    selectedKdf: structuredClone(manifest.identitySuites["1"].kdf),
    profiles: kdfProfiles.map(([purpose, kdf]) => ({
      purpose,
      suiteId: 1,
      candidateId: KDF_SELECTED_CANDIDATE_ID,
      kdf: structuredClone(kdf),
      implementations: [
        {
          tool: {
            name: "reference tool",
            version: "1.0.0",
            sourceRevision: "0123456789abcdef",
          },
          hardware: {
            description: "reference hardware",
            processor: "reference processor",
            memoryMiB: 16_384,
            accelerator: "none",
          },
          measurement: {
            durationSeconds: 600,
            attemptCount: 600,
            optimizationMode: "optimized-native",
            throughputPerSecond: 1,
            memoryKiBPerAttempt: 65_536,
            memoryTimeProductKiBMilliseconds: 65_536_000,
          },
          assumptions: ["Measurements cover only the declared selected candidate."],
          memoryTimeTradeoff: "Observed memory-time tradeoff recorded directly.",
        },
      ],
    })),
    conclusion: {
      legitimateAndAttackerCostsSeparated: true,
      doesNotClaimSecurityBits: true,
      doesNotEstimatePasswordCrackingYears: true,
    },
  };
  const deviceMatrixPath = "release-evidence/kdf-device-matrix.json";
  const attackerStudyPath = "release-evidence/kdf-attacker-study.json";
  writeCanonicalJson(path.join(temporaryRoot, deviceMatrixPath), deviceMatrix);
  writeCanonicalJson(path.join(temporaryRoot, attackerStudyPath), attackerStudy);
  manifest.releaseEvidence = {
    kdfDeviceMatrix: {
      status: "passed",
      schemaVersion: 2,
      evidenceType: "deepfamily/kdf-device-matrix-v2",
      selectedCandidateId: KDF_SELECTED_CANDIDATE_ID,
      latencyBudgets: structuredClone(KDF_LATENCY_BUDGETS),
      stressRequirements: structuredClone(KDF_STRESS_REQUIREMENTS),
      path: deviceMatrixPath,
      sha256: protocolManifestSha256(fs.readFileSync(path.join(temporaryRoot, deviceMatrixPath))),
    },
    kdfAttackerCostStudy: {
      status: "passed",
      schemaVersion: 2,
      evidenceType: "deepfamily/kdf-attacker-cost-study-v2",
      selectedCandidateId: KDF_SELECTED_CANDIDATE_ID,
      path: attackerStudyPath,
      sha256: protocolManifestSha256(fs.readFileSync(path.join(temporaryRoot, attackerStudyPath))),
    },
    trustedSetup: {
      status: "production",
      manifestSha256: HASHES.zkManifest,
      transcriptSha256: HASHES.zkTranscript,
    },
  };

  const goldenVectorPath = path.join(temporaryRoot, manifest.goldenVectors.path);
  fs.mkdirSync(path.dirname(goldenVectorPath), { recursive: true });
  fs.copyFileSync(path.join(ROOT, manifest.goldenVectors.path), goldenVectorPath);
  writeCanonicalJson(path.join(temporaryRoot, PROTOCOL_RELEASE_MANIFEST_PATH), manifest);

  const zkEvidence = {
    status: "passed",
    productionReady: true,
    trustedSetupStatus: "production",
    manifestSha256: HASHES.zkManifest,
    transcriptSha256: HASHES.zkTranscript,
    artifacts: {
      person_commitment: {
        source: { sha256: HASHES.personSource },
        r1cs: { sha256: HASHES.personR1cs },
        wasm: { sha256: HASHES.personWasm },
        zkey: { sha256: HASHES.personZkey },
        verificationKey: { sha256: HASHES.personVkey },
        solidityVerifier: { sha256: HASHES.personSolidity },
      },
      disclosure_binding: {
        source: { sha256: HASHES.disclosureSource },
        r1cs: { sha256: HASHES.disclosureR1cs },
        wasm: { sha256: HASHES.disclosureWasm },
        zkey: { sha256: HASHES.disclosureZkey },
        verificationKey: { sha256: HASHES.disclosureVkey },
        solidityVerifier: { sha256: HASHES.disclosureSolidity },
      },
    },
  };
  const deploymentArtifacts = {
    groth16VerifierAdapter: {
      artifactSha256: HASHES.adapterArtifact,
      runtimeSha256: HASHES.adapterRuntime,
    },
    metadataArchiveV1: {
      artifactSha256: HASHES.archiveArtifact,
      runtimeSha256: HASHES.archiveRuntime,
    },
    deepFamilyReader: {
      artifactSha256: HASHES.readerArtifact,
      runtimeSha256: HASHES.readerRuntime,
    },
  };
  const contractInterfaceEvidence = { status: "passed" };

  execFileSync("git", ["-C", temporaryRoot, "init", "--quiet"]);
  execFileSync("git", ["-C", temporaryRoot, "add", "--", "."]);

  const writeManifest = () =>
    writeCanonicalJson(path.join(temporaryRoot, PROTOCOL_RELEASE_MANIFEST_PATH), manifest);
  const writeDeviceMatrix = () => {
    const evidencePath = path.join(temporaryRoot, deviceMatrixPath);
    writeCanonicalJson(evidencePath, deviceMatrix);
    manifest.releaseEvidence.kdfDeviceMatrix.sha256 = protocolManifestSha256(
      fs.readFileSync(evidencePath),
    );
    writeManifest();
  };
  const writeAttackerStudy = () => {
    const evidencePath = path.join(temporaryRoot, attackerStudyPath);
    writeCanonicalJson(evidencePath, attackerStudy);
    manifest.releaseEvidence.kdfAttackerCostStudy.sha256 = protocolManifestSha256(
      fs.readFileSync(evidencePath),
    );
    writeManifest();
  };
  const inspect = (overrides = {}) =>
    inspectProtocolReleaseManifest({
      root: temporaryRoot,
      requireProduction: true,
      zkArtifactInspector: () => structuredClone(zkEvidence),
      deploymentArtifactInspector: () => structuredClone(deploymentArtifacts),
      contractInterfaceInspector: () => structuredClone(contractInterfaceEvidence),
      protocolImplementationStatus: {
        releaseStatus: "production",
        identitySuite1: "frozen",
        fileKdfSuite1: "frozen",
        productionFrozen: true,
      },
      ...overrides,
    });
  return {
    temporaryRoot,
    manifest,
    deviceMatrix,
    deviceMatrixPath,
    attackerStudy,
    attackerStudyPath,
    zkEvidence,
    deploymentArtifacts,
    contractInterfaceEvidence,
    writeManifest,
    writeDeviceMatrix,
    writeAttackerStudy,
    inspect,
  };
};

const acceptanceReportForManifest = (manifest) => ({
  protocolManifestEvidence: {
    protocol: manifest.protocol,
    protocolGeneration: manifest.protocolGeneration,
  },
  network: { chainId: String(manifest.deployments.chainId) },
  addresses: { deepFamily: manifest.deployments.deepFamilyProxy },
  terminalGovernanceState: {
    deepFamily: {
      address: manifest.deployments.deepFamilyProxy,
      implementation: manifest.deployments.deepFamilyImplementation,
      metadataArchive: manifest.deployments.metadataArchiveV1.address,
    },
    verifierAdapter: {
      address: manifest.deployments.groth16VerifierAdapter.address,
      personVerifier: manifest.deployments.groth16VerifierAdapter.personVerifierImmutable,
      disclosureBindingVerifier:
        manifest.deployments.groth16VerifierAdapter.disclosureBindingVerifierImmutable,
      artifactSha256: manifest.deployments.groth16VerifierAdapter.artifactSha256,
      runtimeSha256: manifest.deployments.groth16VerifierAdapter.runtimeSha256,
    },
    archive: {
      address: manifest.deployments.metadataArchiveV1.address,
      deepFamily: manifest.deployments.metadataArchiveV1.deepFamilyImmutable,
      artifactSha256: manifest.deployments.metadataArchiveV1.artifactSha256,
      runtimeSha256: manifest.deployments.metadataArchiveV1.runtimeSha256,
    },
    reader: {
      address: manifest.deployments.deepFamilyReader.address,
      deepFamily: manifest.deployments.deepFamilyReader.deepFamilyImmutable,
      metadataArchive: manifest.deployments.deepFamilyReader.metadataArchiveImmutable,
      artifactSha256: manifest.deployments.deepFamilyReader.artifactSha256,
      runtimeSha256: manifest.deployments.deepFamilyReader.runtimeSha256,
    },
    proofRoutes: manifest.proofRoutes.map(
      ({ purpose, purposeOrdinal, circuitId, proofEncodingId }) => ({
        purpose,
        purposeOrdinal,
        circuitId,
        proofEncodingId,
      }),
    ),
  },
});

describe("protocol release manifest", function () {
  it("freezes v1 constants, public signals and contract ABI selectors/events", function () {
    const evidence = inspectProtocolReleaseManifest({ root: ROOT });
    const interfaceEvidence = inspectProtocolContractInterfaces({
      root: ROOT,
      contractInterfaces: evidence.manifest.contractInterfaces,
    });

    assert.match(evidence.manifestSha256, /^[0-9a-f]{64}$/);
    assert.equal(interfaceEvidence.status, "passed");
    assert.equal(interfaceEvidence.contracts.metadataArchiveV1.checkedFragments, 6);
    assert.equal(interfaceEvidence.contracts.deepFamilyReader.checkedFragments, 4);
    assert.equal(interfaceEvidence.contracts.deepFamily.checkedFragments, 3);
    assert.equal(
      interfaceEvidence.contracts.metadataArchiveV1.abiPolicy.nonErrorFragments,
      "exact-set",
    );
    assert.equal(
      interfaceEvidence.contracts.deepFamilyReader.abiPolicy.nonErrorFragments,
      "declared-subset",
    );
    assert.equal(
      interfaceEvidence.contracts.deepFamily.abiPolicy.nonErrorFragments,
      "declared-subset",
    );
    assert.equal(
      interfaceEvidence.contracts.metadataArchiveV1.abiPolicy.errorFragments,
      "excluded",
    );
    assert.equal(interfaceEvidence.contracts.metadataArchiveV1.artifactNonErrorFragments, 6);
    assert.equal(interfaceEvidence.contracts.metadataArchiveV1.selectors.store, "0xd02205d7");
    assert.equal(
      interfaceEvidence.contracts.metadataArchiveV1.eventTopics.MetadataStored,
      "0x659dc472666e26894f6256eab4c8837831e964f4ebaf5e269f1342708a1d1a80",
    );
    assert.equal(
      interfaceEvidence.contracts.deepFamilyReader.selectors.getVersionMetadataRef,
      "0x72b543c4",
    );
    assert.equal(interfaceEvidence.contracts.deepFamily.selectors.setMetadataArchive, "0x7ed53f66");
    assert.equal(evidence.manifest.proofRoutes[0].publicSignals.length, 5);
    assert.equal(evidence.manifest.proofRoutes[1].publicSignals.length, 4);
    assert.equal(
      evidence.manifest.goldenVectors.sha256,
      "89b29f59e1ad209386505b0abc0410c539019bae6bf937866115b347458fd6dd",
    );
  });

  it("fails the production gate while benchmark, ceremony, artifacts and deployment are pending", function () {
    assert.throws(
      () => inspectProtocolReleaseManifest({ root: ROOT, requireProduction: true }),
      /releaseStatus is not production/,
    );
  });

  it("rejects a moved universal self-suite offset", function () {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-protocol-manifest-"));
    try {
      const manifest = structuredClone(inspectProtocolReleaseManifest({ root: ROOT }).manifest);
      manifest.envelope.universalPrefix.selfIdentitySuiteId.offset = 17;
      fs.writeFileSync(
        path.join(directory, PROTOCOL_RELEASE_MANIFEST_PATH),
        `${JSON.stringify(manifest)}\n`,
      );
      assert.throws(
        () => inspectProtocolReleaseManifest({ root: directory }),
        /self identity suite offset must be 16/,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a compiled contract ABI that drifts from the frozen projection", function () {
    const fixture = createContractInterfaceArtifactFixture();
    try {
      fixture.mutateArchive((archive) => {
        archive.abi.find(
          (fragment) => fragment.type === "function" && fragment.name === "store",
        ).inputs[1].type = "uint32";
      });

      assert.throws(() => fixture.inspect(), /MetadataArchiveV1 function store ABI does not match/);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects an extra MetadataArchiveV1 external mutator", function () {
    const fixture = createContractInterfaceArtifactFixture();
    try {
      fixture.mutateArchive((archive) => {
        archive.abi.push({
          type: "function",
          name: "setOperator",
          stateMutability: "nonpayable",
          inputs: [{ name: "operator", type: "address", internalType: "address" }],
          outputs: [],
        });
      });

      assert.throws(
        () => fixture.inspect(),
        /MetadataArchiveV1 non-error ABI fragment set changed/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects an extra MetadataArchiveV1 event", function () {
    const fixture = createContractInterfaceArtifactFixture();
    try {
      fixture.mutateArchive((archive) => {
        archive.abi.push({
          type: "event",
          name: "OperatorSet",
          anonymous: false,
          inputs: [{ name: "operator", type: "address", internalType: "address", indexed: true }],
        });
      });

      assert.throws(
        () => fixture.inspect(),
        /MetadataArchiveV1 non-error ABI fragment set changed/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("allows MetadataArchiveV1 custom errors under the explicit excluded-error policy", function () {
    const fixture = createContractInterfaceArtifactFixture();
    try {
      fixture.mutateArchive((archive) => {
        archive.abi.push({
          type: "error",
          name: "DiagnosticOnly",
          inputs: [{ name: "code", type: "uint256", internalType: "uint256" }],
        });
      });

      assert.equal(fixture.inspect().status, "passed");
    } finally {
      fixture.cleanup();
    }
  });
});

describe("production protocol release manifest evidence", function () {
  let fixture;

  beforeEach(function () {
    fixture = createProductionFixture();
  });

  afterEach(function () {
    fs.rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  });

  it("binds suites, ZK bytes, contract interfaces, deployments and KDF evidence", function () {
    const inspected = fixture.inspect();

    assert.equal(inspected.manifest.releaseStatus, "production");
    assert.equal(inspected.zkArtifactEvidence.productionReady, true);
    assert.deepEqual(inspected.contractInterfaceEvidence, fixture.contractInterfaceEvidence);
    assert.deepEqual(inspected.deploymentArtifacts, fixture.deploymentArtifacts);
    assert.equal(
      inspected.deploymentEvidence.sha256,
      protocolDeploymentEvidenceSha256(protocolDeploymentEvidenceFromManifest(fixture.manifest)),
    );
    assert.equal(inspected.kdfEvidence.deviceMatrix.report.status, "passed");
    assert.equal(inspected.kdfEvidence.attackerStudy.report.status, "passed");
    assert.equal(inspected.kdfEvidence.selection.selectedCandidateId, KDF_SELECTED_CANDIDATE_ID);
  });

  for (const [label, mutate, pattern] of [
    [
      "data-contract STOP boundary",
      (manifest) => {
        manifest.envelope.dataContract.payloadHashIncludesStop = true;
      },
      /envelope definition does not match/,
    ],
    [
      "format selector",
      (manifest) => {
        manifest.formats["1"].selectors.cipherSuite = 2;
      },
      /format 1 definition does not match/,
    ],
    [
      "format offset",
      (manifest) => {
        manifest.formats["1"].offsets.wrappedDEKTag = 95;
      },
      /format 1 definition does not match/,
    ],
    [
      "format field length",
      (manifest) => {
        manifest.formats["1"].lengths.fileSalt = 32;
      },
      /format 1 definition does not match/,
    ],
    [
      "AAD domain hash",
      (manifest) => {
        manifest.formats["1"].aad.contentDomain.keccak256 = `0x${hash("0")}`;
      },
      /format 1 definition does not match/,
    ],
    [
      "identity normalization",
      (manifest) => {
        manifest.identitySuites["1"].normalization = "NFC";
      },
      /identity suite 1 definition does not match/,
    ],
    [
      "identity KDF parameter",
      (manifest) => {
        manifest.identitySuites["1"].kdf.parallelism = 2;
      },
      /identity suite 1 definition does not match/,
    ],
    [
      "file password domain",
      (manifest) => {
        manifest.fileKdfSuites["1"].passwordDomain = "DeepFamily:IdentityKDF:v1";
      },
      /file KDF suite 1 definition does not match/,
    ],
    [
      "commitment domain",
      (manifest) => {
        manifest.commitments.domains.version = 1005;
      },
      /commitment definition does not match/,
    ],
    [
      "contract interface field deletion",
      (manifest) => {
        delete manifest.contractInterfaces.metadataArchiveV1.semantics.reference.payloadHash;
      },
      /contract interface definition does not match/,
    ],
    [
      "contract interface constant",
      (manifest) => {
        manifest.contractInterfaces.metadataArchiveV1.semantics.constants.MAX_PAYLOAD_LENGTH.value = 16_383;
      },
      /contract interface definition does not match/,
    ],
    [
      "contract ABI completeness policy",
      (manifest) => {
        manifest.contractInterfaces.metadataArchiveV1.abiPolicy.nonErrorFragments =
          "declared-subset";
      },
      /contract interface definition does not match/,
    ],
    [
      "contract function selector",
      (manifest) => {
        const store = manifest.contractInterfaces.metadataArchiveV1.abi.find(
          (fragment) => fragment.type === "function" && fragment.name === "store",
        );
        store.selector = "0x00000000";
      },
      /contract interface definition does not match/,
    ],
    [
      "MetadataRef field order",
      (manifest) => {
        const fields = manifest.contractInterfaces.types.MetadataRef;
        [fields[0], fields[1]] = [fields[1], fields[0]];
      },
      /contract interface definition does not match/,
    ],
    [
      "MetadataStored indexed field",
      (manifest) => {
        const event = manifest.contractInterfaces.metadataArchiveV1.abi.find(
          (fragment) => fragment.type === "event" && fragment.name === "MetadataStored",
        );
        event.inputs[1].indexed = false;
      },
      /contract interface definition does not match/,
    ],
    [
      "Reader immutable binding",
      (manifest) => {
        manifest.contractInterfaces.deepFamilyReader.semantics.immutableBindings.METADATA_ARCHIVE =
          "constructor.archive";
      },
      /contract interface definition does not match/,
    ],
    [
      "DeepFamily metadataArchive setter ABI",
      (manifest) => {
        const setter = manifest.contractInterfaces.deepFamily.abi.find(
          (fragment) => fragment.type === "function" && fragment.name === "setMetadataArchive",
        );
        setter.inputs[0].type = "bytes32";
      },
      /contract interface definition does not match/,
    ],
    [
      "relation circuit ID",
      (manifest) => {
        manifest.proofRoutes[0].circuitId = 2;
      },
      /PersonRelation route definition does not match/,
    ],
    [
      "disclosure signal bit width",
      (manifest) => {
        manifest.proofRoutes[1].publicSignals[2].bits = 161;
      },
      /DisclosureBinding route definition does not match/,
    ],
    [
      "unreviewed format ID",
      (manifest) => {
        manifest.formats["2"] = structuredClone(manifest.formats["1"]);
      },
      /format ID set must contain exactly 1/,
    ],
    [
      "unreviewed identity suite ID",
      (manifest) => {
        manifest.identitySuites["2"] = structuredClone(manifest.identitySuites["1"]);
      },
      /identity suite ID set must contain exactly 1/,
    ],
    [
      "unreviewed file KDF suite ID",
      (manifest) => {
        manifest.fileKdfSuites["2"] = structuredClone(manifest.fileKdfSuites["1"]);
      },
      /file KDF suite ID set must contain exactly 1/,
    ],
    [
      "unreviewed proof route",
      (manifest) => {
        manifest.proofRoutes.push(structuredClone(manifest.proofRoutes[0]));
      },
      /v1 proof route set must contain exactly two routes/,
    ],
  ]) {
    it(`rejects a frozen ${label} drift`, function () {
      mutate(fixture.manifest);
      fixture.writeManifest();

      assert.throws(() => fixture.inspect(), pattern);
    });
  }

  it("rejects production while shared protocol-core still marks its constants provisional", function () {
    assert.throws(
      () =>
        fixture.inspect({
          protocolImplementationStatus: {
            releaseStatus: "development",
            identitySuite1: "candidate-awaiting-device-benchmark",
            fileKdfSuite1: "candidate-awaiting-device-benchmark",
            productionFrozen: false,
          },
        }),
      /shared protocol implementation constants are not production-frozen/,
    );
  });

  for (const [label, relativePath] of [
    ["manifest", PROTOCOL_RELEASE_MANIFEST_PATH],
    ["golden vectors", "protocol-vectors/onchain-biography-v1.json"],
    ["device matrix", "release-evidence/kdf-device-matrix.json"],
    ["attacker study", "release-evidence/kdf-attacker-study.json"],
  ]) {
    it(`requires the ${label} file to be version-controlled`, function () {
      execFileSync("git", [
        "-C",
        fixture.temporaryRoot,
        "rm",
        "--cached",
        "--quiet",
        "--",
        relativePath,
      ]);

      assert.throws(() => fixture.inspect(), /must be a version-controlled repository file/);
    });
  }

  it("rejects non-canonical KDF evidence even when its declared byte hash matches", function () {
    const evidencePath = path.join(fixture.temporaryRoot, fixture.deviceMatrixPath);
    fs.writeFileSync(evidencePath, JSON.stringify(fixture.deviceMatrix));
    fixture.manifest.releaseEvidence.kdfDeviceMatrix.sha256 = protocolManifestSha256(
      fs.readFileSync(evidencePath),
    );
    fixture.writeManifest();

    assert.throws(() => fixture.inspect(), /must use canonical two-space JSON/);
  });

  it("rejects changed KDF evidence bytes", function () {
    fixture.deviceMatrix.candidates[0].environmentResults[0].measurements.identitySingleDerivation.p95Milliseconds += 1;
    writeCanonicalJson(
      path.join(fixture.temporaryRoot, fixture.deviceMatrixPath),
      fixture.deviceMatrix,
    );

    assert.throws(() => fixture.inspect(), /evidence file hash does not match the manifest/);
  });

  it("rejects legacy KDF device-matrix schema bindings in production", function () {
    fixture.manifest.releaseEvidence.kdfDeviceMatrix.schemaVersion = 1;
    fixture.writeManifest();

    assert.throws(() => fixture.inspect(), /kdfDeviceMatrix schemaVersion must be 2/);
  });

  for (const [label, mutate, pattern] of [
    [
      "legacy device-matrix report schema",
      (report) => {
        report.schemaVersion = 1;
      },
      /kdfDeviceMatrix schemaVersion must be 2/,
    ],
    [
      "latency budget not frozen by the manifest",
      (report) => {
        report.latencyBudgets.completeAddVersionP95Milliseconds += 1;
      },
      /latency budgets do not match the manifest/,
    ],
    [
      "single-version unlock budget",
      (report, productionFixture) => {
        report.latencyBudgets.serialUnlock.versionCount = 1;
        productionFixture.manifest.releaseEvidence.kdfDeviceMatrix.latencyBudgets.serialUnlock.versionCount = 1;
      },
      /versionCount must cover multiple versions/,
    ],
    [
      "candidate missing a shared environment ID",
      (report) => {
        report.candidates[0].environmentResults.pop();
      },
      /complete shared environment ID set/,
    ],
    [
      "incomplete AddVersion identity KDF execution count",
      (report) => {
        report.candidates[0].environmentResults[0].measurements.completeAddVersion.identityKdfExecutions = 3;
      },
      /identityKdfExecutions must be 4/,
    ],
    [
      "incomplete AddVersion proof execution count",
      (report) => {
        report.candidates[0].environmentResults[0].measurements.completeAddVersion.proofGenerationExecutions = 0;
      },
      /proofGenerationExecutions must be 1/,
    ],
    [
      "AddVersion intermediate-value reuse",
      (report) => {
        report.candidates[0].environmentResults[0].measurements.completeAddVersion.reusedIntermediateValues = true;
      },
      /must not reuse KDF outputs, KEKs, DEKs or derived secrets/,
    ],
    [
      "parallel multi-version unlock",
      (report) => {
        report.candidates[0].environmentResults[0].measurements.serialUnlock.strictlySerial = false;
      },
      /must execute versions strictly serially/,
    ],
    [
      "short stress run",
      (report) => {
        report.candidates[0].environmentResults[0].stress.durationSeconds = 1_799;
      },
      /status does not match its stress reliability evidence/,
    ],
    [
      "stress run with an OOM",
      (report) => {
        report.candidates[0].environmentResults[0].stress.oomCount = 1;
      },
      /status does not match its stress reliability evidence/,
    ],
    [
      "candidate ladder without a heavier candidate",
      (report) => {
        report.candidates.pop();
      },
      /candidate ladder must contain at least baseline and one heavier candidate/,
    ],
    [
      "candidate below the 64 MiB baseline",
      (report) => {
        report.candidates[0].kdf.memoryKiB = 32_768;
      },
      /silently weakens the 64 MiB\/t=3 baseline/,
    ],
    [
      "over-budget heavier candidate selected over the baseline",
      (report, productionFixture) => {
        const selectedCandidateId = report.candidates[1].candidateId;
        report.selectedCandidateId = selectedCandidateId;
        report.selection.selectedCandidateId = selectedCandidateId;
        productionFixture.manifest.releaseEvidence.kdfDeviceMatrix.selectedCandidateId =
          selectedCandidateId;
      },
      /did not select the highest-memory then highest-time reliable candidate/,
    ],
  ]) {
    it(`rejects ${label}`, function () {
      mutate(fixture.deviceMatrix, fixture);
      fixture.writeDeviceMatrix();

      assert.throws(() => fixture.inspect(), pattern);
    });
  }

  it("rejects legacy KDF attacker-study schema bindings in production", function () {
    fixture.manifest.releaseEvidence.kdfAttackerCostStudy.schemaVersion = 1;
    fixture.writeManifest();

    assert.throws(() => fixture.inspect(), /kdfAttackerCostStudy schemaVersion must be 2/);
  });

  for (const [label, mutate, pattern] of [
    [
      "legacy attacker-study report schema",
      (report) => {
        report.schemaVersion = 1;
      },
      /kdfAttackerCostStudy schemaVersion must be 2/,
    ],
    [
      "attacker study for a different candidate",
      (report) => {
        report.selectedCandidateId = "different-candidate";
      },
      /selectedCandidateId does not match the device matrix/,
    ],
    [
      "attacker tool without a source revision",
      (report) => {
        report.profiles[0].implementations[0].tool.sourceRevision = "";
      },
      /tool\.sourceRevision is missing/,
    ],
    [
      "short attacker measurement",
      (report) => {
        report.profiles[0].implementations[0].measurement.durationSeconds = 59;
      },
      /durationSeconds must be at least 60/,
    ],
    [
      "string-typed attacker measurement duration",
      (report) => {
        report.profiles[0].implementations[0].measurement.durationSeconds = "600";
      },
      /durationSeconds must be a positive number/,
    ],
    [
      "attacker measurement without optimization mode",
      (report) => {
        report.profiles[0].implementations[0].measurement.optimizationMode = "";
      },
      /optimizationMode is missing/,
    ],
    [
      "attacker measurement without throughput",
      (report) => {
        report.profiles[0].implementations[0].measurement.throughputPerSecond = 0;
      },
      /throughputPerSecond must be a positive number/,
    ],
    [
      "attacker measurement below the selected KDF allocation",
      (report) => {
        report.profiles[0].implementations[0].measurement.memoryKiBPerAttempt = 32_768;
      },
      /memoryKiBPerAttempt is below the selected KDF allocation/,
    ],
    [
      "attacker study without assumptions",
      (report) => {
        report.profiles[0].implementations[0].assumptions = [];
      },
      /assumptions must be a non-empty array/,
    ],
    [
      "derived attacker security-bit claim",
      (report) => {
        report.profiles[0].implementations[0].securityBits = 40;
      },
      /must contain exactly/,
    ],
    [
      "attacker conclusion that estimates cracking years",
      (report) => {
        report.conclusion.doesNotEstimatePasswordCrackingYears = false;
      },
      /must not estimate password-cracking years/,
    ],
    [
      "attacker estimate hidden in free text",
      (report) => {
        report.profiles[0].implementations[0].memoryTimeTradeoff = "This implies 40 security bits.";
      },
      /contains a forbidden derived cracking claim/,
    ],
  ]) {
    it(`rejects ${label}`, function () {
      mutate(fixture.attackerStudy);
      fixture.writeAttackerStudy();

      assert.throws(() => fixture.inspect(), pattern);
    });
  }

  it("rejects a ZK artifact hash that differs from the validated production set", function () {
    fixture.manifest.proofRoutes[0].artifacts.r1csSha256 = hash("0");
    fixture.writeManifest();

    assert.throws(
      () => fixture.inspect(),
      /PersonRelation\.r1csSha256 does not match validated ZK artifact bytes/,
    );
  });

  it("rejects a compiled artifact hash drift", function () {
    fixture.deploymentArtifacts.metadataArchiveV1.artifactSha256 = hash("0");

    assert.throws(
      () => fixture.inspect(),
      /MetadataArchiveV1 artifactSha256 does not match the compiled artifact file/,
    );
  });

  it("rejects an immutable-linked runtime hash drift", function () {
    fixture.deploymentArtifacts.deepFamilyReader.runtimeSha256 = hash("0");

    assert.throws(
      () => fixture.inspect(),
      /DeepFamilyReader runtimeSha256 does not match the immutable-linked runtime bytes/,
    );
  });

  it("rejects an Archive immutable that does not bind the declared proxy", function () {
    fixture.manifest.deployments.metadataArchiveV1.deepFamilyImmutable = address(99);
    fixture.writeManifest();

    assert.throws(
      () => fixture.inspect(),
      /MetadataArchiveV1 must bind the declared DeepFamily proxy/,
    );
  });

  it("rejects zero deployment addresses", function () {
    fixture.manifest.deployments.deepFamilyProxy = address(0);
    fixture.writeManifest();

    assert.throws(() => fixture.inspect(), /DeepFamily proxy must not be the zero address/);
  });

  it("rejects aliased deployment addresses", function () {
    fixture.manifest.deployments.deepFamilyReader.address = ADDRESSES.archive;
    fixture.writeManifest();

    assert.throws(() => fixture.inspect(), /production deployment addresses must be distinct/);
  });

  it("rejects undeclared production deployment fields", function () {
    fixture.manifest.deployments.archiveRegistry = ADDRESSES.archive;
    fixture.writeManifest();

    assert.throws(() => fixture.inspect(), /production deployment definition must contain exactly/);
  });

  it("does not accept a production label while format 1 remains mutable", function () {
    fixture.manifest.formats["1"].status = "development";
    fixture.writeManifest();

    assert.throws(() => fixture.inspect(), /format 1 is not frozen/);
  });
});

describe("stable target deployment projection", function () {
  let fixture;

  beforeEach(function () {
    fixture = createProductionFixture();
  });

  afterEach(function () {
    fs.rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  });

  it("matches a same-target acceptance report independent of volatile report fields", function () {
    const expected = protocolDeploymentEvidenceFromManifest(fixture.manifest);
    const report = acceptanceReportForManifest(fixture.manifest);
    report.startedAt = "2026-01-01T00:00:00.000Z";
    report.transactions = [{ hash: `0x${"1".repeat(64)}` }];
    const first = protocolDeploymentEvidenceFromAcceptanceReport(report);
    report.startedAt = "2026-01-02T00:00:00.000Z";
    report.transactions[0].hash = `0x${"2".repeat(64)}`;
    const second = protocolDeploymentEvidenceFromAcceptanceReport(report);

    assert.equal(protocolCanonicalJson(first), protocolCanonicalJson(expected));
    assert.equal(
      protocolDeploymentEvidenceSha256(first),
      protocolDeploymentEvidenceSha256(expected),
    );
    assert.equal(protocolCanonicalJson(second), protocolCanonicalJson(first));
  });

  for (const [label, mutate] of [
    [
      "address",
      (report) => {
        report.terminalGovernanceState.archive.address = address(98);
      },
    ],
    [
      "artifact hash",
      (report) => {
        report.terminalGovernanceState.verifierAdapter.artifactSha256 = hash("0");
      },
    ],
    [
      "runtime hash",
      (report) => {
        report.terminalGovernanceState.reader.runtimeSha256 = hash("0");
      },
    ],
    [
      "immutable",
      (report) => {
        report.terminalGovernanceState.archive.deepFamily = address(97);
      },
    ],
    [
      "DeepFamily reverse Archive binding",
      (report) => {
        report.terminalGovernanceState.deepFamily.metadataArchive = address(96);
      },
    ],
  ]) {
    it(`changes when the acceptance ${label} drifts`, function () {
      const expected = protocolDeploymentEvidenceFromManifest(fixture.manifest);
      const report = acceptanceReportForManifest(fixture.manifest);
      mutate(report);
      const actual = protocolDeploymentEvidenceFromAcceptanceReport(report);

      assert.notEqual(
        protocolDeploymentEvidenceSha256(actual),
        protocolDeploymentEvidenceSha256(expected),
      );
    });
  }

  it("rejects non-canonical string chain IDs", function () {
    const report = acceptanceReportForManifest(fixture.manifest);
    report.network.chainId = "01030";

    assert.throws(
      () => protocolDeploymentEvidenceFromAcceptanceReport(report),
      /acceptance deployment chainId is invalid/,
    );
  });
});
