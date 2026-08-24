export const KDF_DEVICE_MATRIX_SCHEMA_VERSION = 2;
export const KDF_DEVICE_MATRIX_EVIDENCE_TYPE = "deepfamily/kdf-device-matrix-v2";
export const KDF_ATTACKER_STUDY_SCHEMA_VERSION = 2;
export const KDF_ATTACKER_STUDY_EVIDENCE_TYPE = "deepfamily/kdf-attacker-cost-study-v2";
export const KDF_MINIMUM_STRESS_DURATION_SECONDS = 1_800;
export const KDF_MINIMUM_ATTACKER_MEASUREMENT_SECONDS = 60;
export const KDF_REQUIRED_ENVIRONMENT_KINDS = Object.freeze([
  "minimum-mobile",
  "desktop-browser",
  "worker",
]);
export const KDF_BASELINE_CANDIDATE = Object.freeze({
  algorithm: "Argon2id",
  version: 19,
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 1,
  outputBytes: 32,
});

const CANDIDATE_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/u;
const KDF_KEYS = Object.freeze([
  "algorithm",
  "version",
  "memoryKiB",
  "iterations",
  "parallelism",
  "outputBytes",
]);

const fail = (message) => {
  throw new Error(`KDF release evidence: ${message}`);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const assertPlainObject = (value, label) => {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} is missing`,
  );
  return value;
};

const assertExactKeys = (value, expectedKeys, label) => {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assert(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} must contain exactly ${expected.join(", ")}`,
  );
};

const assertNonemptyString = (value, label) => {
  assert(
    typeof value === "string" && value.trim() === value && value.length > 0,
    `${label} is missing`,
  );
  return value;
};

const assertCandidateId = (value, label) => {
  assertNonemptyString(value, label);
  assert(CANDIDATE_ID.test(value), `${label} is not a canonical candidate ID`);
  return value;
};

const assertPositiveNumber = (value, label) => {
  assert(Number.isFinite(value) && value > 0, `${label} must be a positive number`);
  return value;
};

const assertNonnegativeNumber = (value, label) => {
  assert(Number.isFinite(value) && value >= 0, `${label} must be a non-negative number`);
  return value;
};

const assertPositiveInteger = (value, label) => {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
  return value;
};

const assertNonnegativeInteger = (value, label) => {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`);
  return value;
};

const assertStringArray = (value, label) => {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`);
  for (const [index, entry] of value.entries()) {
    assertNonemptyString(entry, `${label}[${index}]`);
  }
  return value;
};

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const assertKdf = (value, label) => {
  assertExactKeys(value, KDF_KEYS, label);
  assert(value.algorithm === "Argon2id", `${label}.algorithm must be Argon2id`);
  assert(value.version === 19, `${label}.version must be 19`);
  for (const field of ["memoryKiB", "iterations", "parallelism", "outputBytes"]) {
    assertPositiveInteger(value[field], `${label}.${field}`);
  }
  assert(value.outputBytes === 32, `${label}.outputBytes must be 32`);
  return value;
};

const assertKdfMatches = (actual, expected, label) => {
  assertKdf(actual, label);
  assert(
    KDF_KEYS.every((key) => actual[key] === expected?.[key]),
    `${label} does not match the selected frozen suite`,
  );
};

const validateLatencyBudgets = (value, label) => {
  assertExactKeys(
    value,
    [
      "identitySingleDerivationP95Milliseconds",
      "fileSingleDerivationP95Milliseconds",
      "completeAddVersionP95Milliseconds",
      "serialUnlock",
    ],
    label,
  );
  for (const field of [
    "identitySingleDerivationP95Milliseconds",
    "fileSingleDerivationP95Milliseconds",
    "completeAddVersionP95Milliseconds",
  ]) {
    assertPositiveNumber(value[field], `${label}.${field}`);
  }
  assertExactKeys(value.serialUnlock, ["versionCount", "p95Milliseconds"], `${label}.serialUnlock`);
  assertPositiveInteger(value.serialUnlock.versionCount, `${label}.serialUnlock.versionCount`);
  assert(
    value.serialUnlock.versionCount >= 2,
    `${label}.serialUnlock.versionCount must cover multiple versions`,
  );
  assertPositiveNumber(value.serialUnlock.p95Milliseconds, `${label}.serialUnlock.p95Milliseconds`);
  return value;
};

const validateStressRequirements = (value, label) => {
  assertExactKeys(value, ["minimumDurationSeconds", "minimumIterations"], label);
  assertPositiveInteger(value.minimumDurationSeconds, `${label}.minimumDurationSeconds`);
  assert(
    value.minimumDurationSeconds >= KDF_MINIMUM_STRESS_DURATION_SECONDS,
    `${label}.minimumDurationSeconds must be at least ${KDF_MINIMUM_STRESS_DURATION_SECONDS}`,
  );
  assertPositiveInteger(value.minimumIterations, `${label}.minimumIterations`);
  return value;
};

const validateDeviceManifestBinding = (binding) => {
  assertExactKeys(
    binding,
    [
      "status",
      "schemaVersion",
      "evidenceType",
      "selectedCandidateId",
      "latencyBudgets",
      "stressRequirements",
      "path",
      "sha256",
    ],
    "manifest kdfDeviceMatrix binding",
  );
  assert(binding.status === "passed", "manifest kdfDeviceMatrix status must be passed");
  assert(
    binding.schemaVersion === KDF_DEVICE_MATRIX_SCHEMA_VERSION,
    `manifest kdfDeviceMatrix schemaVersion must be ${KDF_DEVICE_MATRIX_SCHEMA_VERSION}`,
  );
  assert(
    binding.evidenceType === KDF_DEVICE_MATRIX_EVIDENCE_TYPE,
    "manifest kdfDeviceMatrix evidenceType is not production v2",
  );
  assertCandidateId(binding.selectedCandidateId, "manifest kdfDeviceMatrix selectedCandidateId");
  validateLatencyBudgets(binding.latencyBudgets, "manifest kdfDeviceMatrix latencyBudgets");
  validateStressRequirements(
    binding.stressRequirements,
    "manifest kdfDeviceMatrix stressRequirements",
  );
  return binding;
};

const validateEnvironmentSet = (environments) => {
  assert(
    Array.isArray(environments) && environments.length === KDF_REQUIRED_ENVIRONMENT_KINDS.length,
    "kdfDeviceMatrix environments must contain exactly minimum-mobile, desktop-browser and worker",
  );
  const ids = new Set();
  const kinds = new Set();
  for (const [index, environment] of environments.entries()) {
    const label = `kdfDeviceMatrix environments[${index}]`;
    assertExactKeys(
      environment,
      [
        "environmentId",
        "kind",
        "label",
        "hardware",
        "operatingSystem",
        "browser",
        "runtime",
        "workerMode",
      ],
      label,
    );
    assertCandidateId(environment.environmentId, `${label}.environmentId`);
    assert(
      KDF_REQUIRED_ENVIRONMENT_KINDS.includes(environment.kind),
      `${label}.kind is not a required environment kind`,
    );
    for (const field of [
      "label",
      "hardware",
      "operatingSystem",
      "browser",
      "runtime",
      "workerMode",
    ]) {
      assertNonemptyString(environment[field], `${label}.${field}`);
    }
    assert(!ids.has(environment.environmentId), "kdfDeviceMatrix environment IDs must be unique");
    assert(!kinds.has(environment.kind), "kdfDeviceMatrix environment kinds must be unique");
    ids.add(environment.environmentId);
    kinds.add(environment.kind);
  }
  for (const kind of KDF_REQUIRED_ENVIRONMENT_KINDS) {
    assert(kinds.has(kind), `kdfDeviceMatrix is missing ${kind}`);
  }
  return Object.freeze([...ids].sort());
};

const validateBasicLatency = (value, label) => {
  assertExactKeys(value, ["sampleCount", "p50Milliseconds", "p95Milliseconds"], label);
  assert(
    Number.isSafeInteger(value.sampleCount) && value.sampleCount >= 5,
    `${label}.sampleCount must be at least 5`,
  );
  const p50 = assertPositiveNumber(value.p50Milliseconds, `${label}.p50Milliseconds`);
  const p95 = assertPositiveNumber(value.p95Milliseconds, `${label}.p95Milliseconds`);
  assert(p95 >= p50, `${label}.p95Milliseconds must not be below p50Milliseconds`);
};

const validateCompleteAddVersion = (value, label) => {
  assertExactKeys(
    value,
    [
      "sampleCount",
      "p50Milliseconds",
      "p95Milliseconds",
      "identityKdfExecutions",
      "fileKdfExecutions",
      "proofGenerationExecutions",
      "gzipCompressionExecutions",
      "gzipDecompressionExecutions",
      "aesGcmEncryptions",
      "aesGcmDecryptions",
      "roundTripDecodeIncluded",
      "freshInputsPerSample",
      "reusedIntermediateValues",
      "componentP95Milliseconds",
    ],
    label,
  );
  validateBasicLatency(
    {
      sampleCount: value.sampleCount,
      p50Milliseconds: value.p50Milliseconds,
      p95Milliseconds: value.p95Milliseconds,
    },
    label,
  );
  for (const [field, expected] of [
    ["identityKdfExecutions", 4],
    ["fileKdfExecutions", 2],
    ["proofGenerationExecutions", 1],
    ["gzipCompressionExecutions", 1],
    ["gzipDecompressionExecutions", 1],
    ["aesGcmEncryptions", 2],
    ["aesGcmDecryptions", 2],
  ]) {
    assert(value[field] === expected, `${label}.${field} must be ${expected}`);
  }
  assert(
    value.roundTripDecodeIncluded === true,
    `${label} must include production decode round-trip`,
  );
  assert(value.freshInputsPerSample === true, `${label} must use fresh inputs for every sample`);
  assert(
    value.reusedIntermediateValues === false,
    `${label} must not reuse KDF outputs, KEKs, DEKs or derived secrets`,
  );
  assertExactKeys(
    value.componentP95Milliseconds,
    ["identityKdf", "fileKdf", "proofGeneration", "gzip", "aesGcm"],
    `${label}.componentP95Milliseconds`,
  );
  for (const [component, duration] of Object.entries(value.componentP95Milliseconds)) {
    assertPositiveNumber(duration, `${label}.componentP95Milliseconds.${component}`);
  }
};

const validateSerialUnlock = (value, budgets, label) => {
  assertExactKeys(
    value,
    [
      "versionCount",
      "sampleCount",
      "p50Milliseconds",
      "p95Milliseconds",
      "strictlySerial",
      "identityKdfExecutionsPerVersion",
      "fileKdfExecutionsPerVersion",
      "freshInputsPerVersion",
      "reusedIntermediateValues",
    ],
    label,
  );
  validateBasicLatency(
    {
      sampleCount: value.sampleCount,
      p50Milliseconds: value.p50Milliseconds,
      p95Milliseconds: value.p95Milliseconds,
    },
    label,
  );
  assert(
    value.versionCount === budgets.serialUnlock.versionCount,
    `${label}.versionCount does not match the manifest budget`,
  );
  assert(value.strictlySerial === true, `${label} must execute versions strictly serially`);
  assert(
    value.identityKdfExecutionsPerVersion === 1 && value.fileKdfExecutionsPerVersion === 1,
    `${label} must execute one identity and one file KDF per version`,
  );
  assert(value.freshInputsPerVersion === true, `${label} must use fresh inputs per version`);
  assert(
    value.reusedIntermediateValues === false,
    `${label} must not reuse KDF outputs or intermediate values`,
  );
};

const validateMeasurements = (measurements, budgets, label) => {
  assertExactKeys(
    measurements,
    ["identitySingleDerivation", "fileSingleDerivation", "completeAddVersion", "serialUnlock"],
    label,
  );
  validateBasicLatency(measurements.identitySingleDerivation, `${label}.identitySingleDerivation`);
  validateBasicLatency(measurements.fileSingleDerivation, `${label}.fileSingleDerivation`);
  validateCompleteAddVersion(measurements.completeAddVersion, `${label}.completeAddVersion`);
  validateSerialUnlock(measurements.serialUnlock, budgets, `${label}.serialUnlock`);
};

const isWithinBudgets = (measurements, budgets) =>
  measurements.identitySingleDerivation.p95Milliseconds <=
    budgets.identitySingleDerivationP95Milliseconds &&
  measurements.fileSingleDerivation.p95Milliseconds <=
    budgets.fileSingleDerivationP95Milliseconds &&
  measurements.completeAddVersion.p95Milliseconds <= budgets.completeAddVersionP95Milliseconds &&
  measurements.serialUnlock.p95Milliseconds <= budgets.serialUnlock.p95Milliseconds;

const validateStress = ({ stress, requirements, kdf, status, label }) => {
  assertExactKeys(
    stress,
    [
      "durationSeconds",
      "iterations",
      "peakMemoryMiB",
      "oomCount",
      "workerCrashCount",
      "processCrashCount",
    ],
    `${label}.stress`,
  );
  assertNonnegativeNumber(stress.durationSeconds, `${label}.stress.durationSeconds`);
  assertNonnegativeInteger(stress.iterations, `${label}.stress.iterations`);
  assertNonnegativeNumber(stress.peakMemoryMiB, `${label}.stress.peakMemoryMiB`);
  for (const field of ["oomCount", "workerCrashCount", "processCrashCount"]) {
    assertNonnegativeInteger(stress[field], `${label}.stress.${field}`);
  }
  const reliable =
    stress.durationSeconds >= requirements.minimumDurationSeconds &&
    stress.iterations >= requirements.minimumIterations &&
    stress.peakMemoryMiB >= kdf.memoryKiB / 1024 &&
    stress.oomCount === 0 &&
    stress.workerCrashCount === 0 &&
    stress.processCrashCount === 0;
  assert(
    status === (reliable ? "passed" : "failed"),
    `${label}.status does not match its stress reliability evidence`,
  );
  return reliable;
};

const candidateRank = (candidate) => [candidate.kdf.memoryKiB, candidate.kdf.iterations];

const compareCandidateRank = (left, right) => {
  const [leftMemory, leftTime] = candidateRank(left);
  const [rightMemory, rightTime] = candidateRank(right);
  return rightMemory - leftMemory || rightTime - leftTime;
};

export const validateKdfDeviceMatrixV2Evidence = ({
  report,
  manifest,
  manifestBinding,
  identitySuite,
  fileSuite,
}) => {
  const binding = validateDeviceManifestBinding(manifestBinding);
  assertExactKeys(
    report,
    [
      "schemaVersion",
      "evidenceType",
      "protocol",
      "protocolGeneration",
      "status",
      "selectedCandidateId",
      "latencyBudgets",
      "stressRequirements",
      "environments",
      "candidates",
      "selection",
    ],
    "kdfDeviceMatrix report",
  );
  assert(
    report.schemaVersion === KDF_DEVICE_MATRIX_SCHEMA_VERSION,
    `kdfDeviceMatrix schemaVersion must be ${KDF_DEVICE_MATRIX_SCHEMA_VERSION}`,
  );
  assert(
    report.evidenceType === KDF_DEVICE_MATRIX_EVIDENCE_TYPE,
    "unexpected kdfDeviceMatrix production evidence type",
  );
  assert(report.protocol === manifest.protocol, "kdfDeviceMatrix protocol does not match");
  assert(
    report.protocolGeneration === manifest.protocolGeneration,
    "kdfDeviceMatrix protocolGeneration does not match",
  );
  assert(report.status === "passed", "kdfDeviceMatrix report status is not passed");
  assertCandidateId(report.selectedCandidateId, "kdfDeviceMatrix selectedCandidateId");
  assert(
    report.selectedCandidateId === binding.selectedCandidateId,
    "kdfDeviceMatrix selectedCandidateId does not match the manifest",
  );
  validateLatencyBudgets(report.latencyBudgets, "kdfDeviceMatrix latencyBudgets");
  validateStressRequirements(report.stressRequirements, "kdfDeviceMatrix stressRequirements");
  assert(
    sameJson(report.latencyBudgets, binding.latencyBudgets),
    "kdfDeviceMatrix latency budgets do not match the manifest",
  );
  assert(
    sameJson(report.stressRequirements, binding.stressRequirements),
    "kdfDeviceMatrix stress requirements do not match the manifest",
  );
  const environmentIds = validateEnvironmentSet(report.environments);
  assert(
    Array.isArray(report.candidates) && report.candidates.length >= 2,
    "kdfDeviceMatrix candidate ladder must contain at least baseline and one heavier candidate",
  );
  const candidateIds = new Set();
  const costPairs = new Set();
  const viability = new Map();
  for (const [candidateIndex, candidate] of report.candidates.entries()) {
    const label = `kdfDeviceMatrix candidates[${candidateIndex}]`;
    assertExactKeys(candidate, ["candidateId", "kdf", "environmentResults"], label);
    assertCandidateId(candidate.candidateId, `${label}.candidateId`);
    assert(
      !candidateIds.has(candidate.candidateId),
      "kdfDeviceMatrix candidate IDs must be unique",
    );
    candidateIds.add(candidate.candidateId);
    assertKdf(candidate.kdf, `${label}.kdf`);
    assert(
      candidate.kdf.memoryKiB >= KDF_BASELINE_CANDIDATE.memoryKiB &&
        candidate.kdf.iterations >= KDF_BASELINE_CANDIDATE.iterations,
      `${label}.kdf silently weakens the 64 MiB/t=3 baseline`,
    );
    const costPair = `${candidate.kdf.memoryKiB}:${candidate.kdf.iterations}`;
    assert(
      !costPairs.has(costPair),
      "kdfDeviceMatrix candidates must have distinct memory/time cost pairs",
    );
    costPairs.add(costPair);
    assert(
      Array.isArray(candidate.environmentResults) &&
        candidate.environmentResults.length === environmentIds.length,
      `${label} must use the complete shared environment ID set`,
    );
    const resultIds = new Set();
    let viable = true;
    for (const [resultIndex, result] of candidate.environmentResults.entries()) {
      const resultLabel = `${label}.environmentResults[${resultIndex}]`;
      assertExactKeys(
        result,
        ["environmentId", "status", "stress", "measurements", "failureReason"],
        resultLabel,
      );
      assertCandidateId(result.environmentId, `${resultLabel}.environmentId`);
      assert(
        environmentIds.includes(result.environmentId),
        `${resultLabel} uses an unknown environment ID`,
      );
      assert(!resultIds.has(result.environmentId), `${label} repeats an environment ID`);
      resultIds.add(result.environmentId);
      assert(["passed", "failed"].includes(result.status), `${resultLabel}.status is invalid`);
      const reliable = validateStress({
        stress: result.stress,
        requirements: report.stressRequirements,
        kdf: candidate.kdf,
        status: result.status,
        label: resultLabel,
      });
      if (reliable) {
        assert(
          result.failureReason === null,
          `${resultLabel}.failureReason must be null when passed`,
        );
        validateMeasurements(
          result.measurements,
          report.latencyBudgets,
          `${resultLabel}.measurements`,
        );
        viable &&= isWithinBudgets(result.measurements, report.latencyBudgets);
      } else {
        assertNonemptyString(result.failureReason, `${resultLabel}.failureReason`);
        assert(
          result.measurements === null,
          `${resultLabel}.measurements must be null when stress failed`,
        );
        viable = false;
      }
    }
    assert(
      sameJson([...resultIds].sort(), environmentIds),
      `${label} identity/file measurements do not use the shared environment ID set`,
    );
    viability.set(candidate.candidateId, viable);
  }
  const baseline = report.candidates.find((candidate) =>
    KDF_KEYS.every((key) => candidate.kdf[key] === KDF_BASELINE_CANDIDATE[key]),
  );
  assert(baseline, "kdfDeviceMatrix candidate ladder is missing the 64 MiB/t=3/p=1 baseline");
  assert(
    report.candidates.some(
      (candidate) =>
        candidate.kdf.memoryKiB > KDF_BASELINE_CANDIDATE.memoryKiB ||
        (candidate.kdf.memoryKiB === KDF_BASELINE_CANDIDATE.memoryKiB &&
          candidate.kdf.iterations > KDF_BASELINE_CANDIDATE.iterations),
    ),
    "kdfDeviceMatrix candidate ladder is missing a heavier candidate",
  );
  const viableCandidates = report.candidates
    .filter((candidate) => viability.get(candidate.candidateId) === true)
    .sort(compareCandidateRank);
  assert(
    viableCandidates.length > 0,
    "kdfDeviceMatrix has no reliable candidate within every budget",
  );
  const selected = report.candidates.find(
    (candidate) => candidate.candidateId === report.selectedCandidateId,
  );
  assert(selected, "kdfDeviceMatrix selected candidate is missing from the ladder");
  assert(
    selected.candidateId === viableCandidates[0].candidateId,
    "kdfDeviceMatrix did not select the highest-memory then highest-time reliable candidate within every environment budget",
  );
  assertKdfMatches(selected.kdf, identitySuite.kdf, "selected identity KDF candidate");
  assertKdfMatches(selected.kdf, fileSuite.kdf, "selected file KDF candidate");
  assertExactKeys(
    report.selection,
    [
      "selectedCandidateId",
      "ordering",
      "allRequiredEnvironmentsReliable",
      "allRequiredEnvironmentsWithinBudget",
    ],
    "kdfDeviceMatrix selection",
  );
  assert(
    report.selection.selectedCandidateId === selected.candidateId,
    "kdfDeviceMatrix selection candidate does not match",
  );
  assert(
    report.selection.ordering === "memoryKiB-desc-then-iterations-desc",
    "kdfDeviceMatrix selection ordering must prioritize memory then time",
  );
  assert(
    report.selection.allRequiredEnvironmentsReliable === true &&
      report.selection.allRequiredEnvironmentsWithinBudget === true,
    "kdfDeviceMatrix selected candidate readiness flags must both be true",
  );
  return Object.freeze({
    selectedCandidateId: selected.candidateId,
    selectedKdf: Object.freeze({ ...selected.kdf }),
    environmentIds,
  });
};

const validateAttackerManifestBinding = (binding, selectedCandidate) => {
  assertExactKeys(
    binding,
    ["status", "schemaVersion", "evidenceType", "selectedCandidateId", "path", "sha256"],
    "manifest kdfAttackerCostStudy binding",
  );
  assert(binding.status === "passed", "manifest kdfAttackerCostStudy status must be passed");
  assert(
    binding.schemaVersion === KDF_ATTACKER_STUDY_SCHEMA_VERSION,
    `manifest kdfAttackerCostStudy schemaVersion must be ${KDF_ATTACKER_STUDY_SCHEMA_VERSION}`,
  );
  assert(
    binding.evidenceType === KDF_ATTACKER_STUDY_EVIDENCE_TYPE,
    "manifest kdfAttackerCostStudy evidenceType is not production v2",
  );
  assert(
    binding.selectedCandidateId === selectedCandidate.selectedCandidateId,
    "manifest attacker study selectedCandidateId does not match the device matrix",
  );
};

const assertNoForbiddenAttackerClaims = (value, path = "kdfAttackerCostStudy") => {
  if (typeof value === "string") {
    assert(
      !/(?:security[ -]?bits?|(?:password[ -]?)?cracking[ -]?years?|years?[ -]?to[ -]?crack)/iu.test(
        value,
      ),
      `${path} contains a forbidden derived cracking claim`,
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenAttackerClaims(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  const forbidden = new Set([
    "securitybits",
    "estimatedsecuritybits",
    "crackingyears",
    "estimatedcrackingyears",
    "passwordcrackingyears",
    "yearstocrack",
  ]);
  for (const [key, child] of Object.entries(value)) {
    assert(
      !forbidden.has(key.toLowerCase()),
      `${path}.${key} is a forbidden derived cracking claim`,
    );
    assertNoForbiddenAttackerClaims(child, `${path}.${key}`);
  }
};

export const validateKdfAttackerStudyV2Evidence = ({
  report,
  manifest,
  manifestBinding,
  identitySuite,
  fileSuite,
  selectedCandidate,
}) => {
  validateAttackerManifestBinding(manifestBinding, selectedCandidate);
  assertExactKeys(
    report,
    [
      "schemaVersion",
      "evidenceType",
      "protocol",
      "protocolGeneration",
      "status",
      "selectedCandidateId",
      "selectedKdf",
      "profiles",
      "conclusion",
    ],
    "kdfAttackerCostStudy report",
  );
  assert(
    report.schemaVersion === KDF_ATTACKER_STUDY_SCHEMA_VERSION,
    `kdfAttackerCostStudy schemaVersion must be ${KDF_ATTACKER_STUDY_SCHEMA_VERSION}`,
  );
  assert(
    report.evidenceType === KDF_ATTACKER_STUDY_EVIDENCE_TYPE,
    "unexpected kdfAttackerCostStudy production evidence type",
  );
  assert(report.protocol === manifest.protocol, "kdfAttackerCostStudy protocol does not match");
  assert(
    report.protocolGeneration === manifest.protocolGeneration,
    "kdfAttackerCostStudy protocolGeneration does not match",
  );
  assert(report.status === "passed", "kdfAttackerCostStudy report status is not passed");
  assert(
    report.selectedCandidateId === selectedCandidate.selectedCandidateId,
    "kdfAttackerCostStudy selectedCandidateId does not match the device matrix",
  );
  assertKdfMatches(report.selectedKdf, selectedCandidate.selectedKdf, "attacker selectedKdf");
  assert(
    Array.isArray(report.profiles) && report.profiles.length === 2,
    "attacker profiles must contain identity and file",
  );
  const seenProfiles = new Set();
  for (const [profileIndex, profile] of report.profiles.entries()) {
    const label = `kdfAttackerCostStudy profiles[${profileIndex}]`;
    assertExactKeys(
      profile,
      ["purpose", "suiteId", "candidateId", "kdf", "implementations"],
      label,
    );
    assert(["identity", "file"].includes(profile.purpose), `${label}.purpose is invalid`);
    assert(profile.suiteId === 1, `${label}.suiteId must be 1`);
    assert(!seenProfiles.has(profile.purpose), "attacker study profiles must be unique");
    seenProfiles.add(profile.purpose);
    assert(
      profile.candidateId === selectedCandidate.selectedCandidateId,
      `${label}.candidateId does not match the selected candidate`,
    );
    const expectedKdf = profile.purpose === "identity" ? identitySuite.kdf : fileSuite.kdf;
    assertKdfMatches(profile.kdf, expectedKdf, `${label}.kdf`);
    assert(
      Array.isArray(profile.implementations) && profile.implementations.length > 0,
      `${label}.implementations must not be empty`,
    );
    for (const [implementationIndex, implementation] of profile.implementations.entries()) {
      const implementationLabel = `${label}.implementations[${implementationIndex}]`;
      assertExactKeys(
        implementation,
        ["tool", "hardware", "measurement", "assumptions", "memoryTimeTradeoff"],
        implementationLabel,
      );
      assertExactKeys(
        implementation.tool,
        ["name", "version", "sourceRevision"],
        `${implementationLabel}.tool`,
      );
      for (const field of ["name", "version", "sourceRevision"]) {
        assertNonemptyString(implementation.tool[field], `${implementationLabel}.tool.${field}`);
      }
      assertExactKeys(
        implementation.hardware,
        ["description", "processor", "memoryMiB", "accelerator"],
        `${implementationLabel}.hardware`,
      );
      for (const field of ["description", "processor", "accelerator"]) {
        assertNonemptyString(
          implementation.hardware[field],
          `${implementationLabel}.hardware.${field}`,
        );
      }
      assertPositiveNumber(
        implementation.hardware.memoryMiB,
        `${implementationLabel}.hardware.memoryMiB`,
      );
      assertExactKeys(
        implementation.measurement,
        [
          "durationSeconds",
          "attemptCount",
          "optimizationMode",
          "throughputPerSecond",
          "memoryKiBPerAttempt",
          "memoryTimeProductKiBMilliseconds",
        ],
        `${implementationLabel}.measurement`,
      );
      assertPositiveNumber(
        implementation.measurement.durationSeconds,
        `${implementationLabel}.measurement.durationSeconds`,
      );
      assert(
        implementation.measurement.durationSeconds >= KDF_MINIMUM_ATTACKER_MEASUREMENT_SECONDS,
        `${implementationLabel}.measurement.durationSeconds must be at least ${KDF_MINIMUM_ATTACKER_MEASUREMENT_SECONDS}`,
      );
      assertPositiveInteger(
        implementation.measurement.attemptCount,
        `${implementationLabel}.measurement.attemptCount`,
      );
      assertNonemptyString(
        implementation.measurement.optimizationMode,
        `${implementationLabel}.measurement.optimizationMode`,
      );
      assertPositiveNumber(
        implementation.measurement.throughputPerSecond,
        `${implementationLabel}.measurement.throughputPerSecond`,
      );
      assertPositiveNumber(
        implementation.measurement.memoryKiBPerAttempt,
        `${implementationLabel}.measurement.memoryKiBPerAttempt`,
      );
      assert(
        implementation.measurement.memoryKiBPerAttempt >= selectedCandidate.selectedKdf.memoryKiB,
        `${implementationLabel}.measurement.memoryKiBPerAttempt is below the selected KDF allocation`,
      );
      assertPositiveNumber(
        implementation.measurement.memoryTimeProductKiBMilliseconds,
        `${implementationLabel}.measurement.memoryTimeProductKiBMilliseconds`,
      );
      assertStringArray(implementation.assumptions, `${implementationLabel}.assumptions`);
      assertNonemptyString(
        implementation.memoryTimeTradeoff,
        `${implementationLabel}.memoryTimeTradeoff`,
      );
    }
  }
  assert(
    seenProfiles.has("identity") && seenProfiles.has("file"),
    "attacker study is missing a suite profile",
  );
  assertExactKeys(
    report.conclusion,
    [
      "legitimateAndAttackerCostsSeparated",
      "doesNotClaimSecurityBits",
      "doesNotEstimatePasswordCrackingYears",
    ],
    "kdfAttackerCostStudy conclusion",
  );
  assert(
    report.conclusion.legitimateAndAttackerCostsSeparated === true,
    "kdfAttackerCostStudy must separate legitimate and attacker costs",
  );
  assert(
    report.conclusion.doesNotClaimSecurityBits === true,
    "kdfAttackerCostStudy must not infer security bits from browser latency",
  );
  assert(
    report.conclusion.doesNotEstimatePasswordCrackingYears === true,
    "kdfAttackerCostStudy must not estimate password-cracking years",
  );
  assertNoForbiddenAttackerClaims(report);
};

const incompleteEnvironment = (kind) => ({
  environmentId: null,
  kind,
  label: null,
  hardware: null,
  operatingSystem: null,
  browser: null,
  runtime: null,
  workerMode: null,
});

export const buildKdfDeviceMatrixV2Template = (manifest) => ({
  schemaVersion: KDF_DEVICE_MATRIX_SCHEMA_VERSION,
  evidenceType: KDF_DEVICE_MATRIX_EVIDENCE_TYPE,
  protocol: manifest.protocol,
  protocolGeneration: manifest.protocolGeneration,
  status: "incomplete",
  selectedCandidateId: null,
  latencyBudgets: structuredClone(
    manifest.releaseEvidence?.kdfDeviceMatrix?.latencyBudgets ?? null,
  ),
  stressRequirements: structuredClone(
    manifest.releaseEvidence?.kdfDeviceMatrix?.stressRequirements ?? {
      minimumDurationSeconds: KDF_MINIMUM_STRESS_DURATION_SECONDS,
      minimumIterations: null,
    },
  ),
  environments: KDF_REQUIRED_ENVIRONMENT_KINDS.map(incompleteEnvironment),
  candidates: [
    {
      candidateId: "argon2id-m65536-t3-p1-baseline",
      kdf: structuredClone(KDF_BASELINE_CANDIDATE),
      environmentResults: [],
    },
    {
      candidateId: null,
      kdf: {
        algorithm: "Argon2id",
        version: 19,
        memoryKiB: null,
        iterations: null,
        parallelism: null,
        outputBytes: 32,
      },
      environmentResults: [],
    },
  ],
  selection: {
    selectedCandidateId: null,
    ordering: "memoryKiB-desc-then-iterations-desc",
    allRequiredEnvironmentsReliable: null,
    allRequiredEnvironmentsWithinBudget: null,
  },
});

export const buildKdfAttackerStudyV2Template = (manifest) => ({
  schemaVersion: KDF_ATTACKER_STUDY_SCHEMA_VERSION,
  evidenceType: KDF_ATTACKER_STUDY_EVIDENCE_TYPE,
  protocol: manifest.protocol,
  protocolGeneration: manifest.protocolGeneration,
  status: "incomplete",
  selectedCandidateId: manifest.releaseEvidence?.kdfAttackerCostStudy?.selectedCandidateId ?? null,
  selectedKdf: null,
  profiles: ["identity", "file"].map((purpose) => ({
    purpose,
    suiteId: 1,
    candidateId: null,
    kdf: structuredClone(
      purpose === "identity"
        ? manifest.identitySuites?.["1"]?.kdf
        : manifest.fileKdfSuites?.["1"]?.kdf,
    ),
    implementations: [],
  })),
  conclusion: {
    legitimateAndAttackerCostsSeparated: null,
    doesNotClaimSecurityBits: null,
    doesNotEstimatePasswordCrackingYears: null,
  },
});

export const canonicalKdfEvidenceJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
