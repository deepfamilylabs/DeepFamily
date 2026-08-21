/*
PersonRelation v1 checker for the person_commitment circuit artifact.

It independently derives the frozen five-signal ABI, optionally compares a saved
public-signal vector, and can generate and verify a real Groth16 proof.
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { poseidon4 } from "poseidon-lite";
import { PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC } from "@deepfamily/proof-core";
import { resolveDescriptorNodeArtifactCandidates } from "../lib/proofCommon.js";
import { PERSON_RELATION_PROOF_DESCRIPTOR } from "../lib/proofDescriptors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UINT32_MAX = (1n << 32n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;

const DEFAULT_WASM_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  PERSON_RELATION_PROOF_DESCRIPTOR,
  "wasm",
);
const DEFAULT_ZKEY_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  PERSON_RELATION_PROOF_DESCRIPTOR,
  "zkey",
);
const DEFAULT_VKEY_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  PERSON_RELATION_PROOF_DESCRIPTOR,
  "vkey",
);

function normalizeBigIntField(value, label, { defaultValue, maximum } = {}) {
  const normalizedValue = value ?? defaultValue;
  if (normalizedValue === undefined || normalizedValue === null || normalizedValue === "") {
    throw new Error(`${label} is required`);
  }
  let normalized;
  try {
    normalized = BigInt(normalizedValue);
  } catch {
    throw new Error(`${label} must be a non-negative integer-like value`);
  }
  if (normalized < 0n || (maximum !== undefined && normalized > maximum)) {
    throw new Error(
      maximum === undefined
        ? `${label} must be non-negative`
        : `${label} must be in [0, ${maximum}]`,
    );
  }
  return normalized;
}

function normalizeBit(value, label, { defaultValue } = {}) {
  const normalized = normalizeBigIntField(value, label, { defaultValue });
  if (normalized !== 0n && normalized !== 1n) {
    throw new Error(`${label} must be 0 or 1`);
  }
  return normalized;
}

function validatePersonCommitmentInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "Input JSON must be a PersonRelation v1 witness with role suite IDs, submitter, and digest limbs",
    );
  }

  const input = {
    nameField: normalizeBigIntField(raw.nameField, "nameField"),
    derivedSecretField: normalizeBigIntField(raw.derivedSecretField, "derivedSecretField"),
    isBirthBC: normalizeBit(raw.isBirthBC, "isBirthBC"),
    birthYear: normalizeBigIntField(raw.birthYear, "birthYear"),
    birthMonth: normalizeBigIntField(raw.birthMonth, "birthMonth"),
    birthDay: normalizeBigIntField(raw.birthDay, "birthDay"),
    gender: normalizeBigIntField(raw.gender, "gender"),
    selfSuiteId: normalizeBigIntField(raw.selfSuiteId, "selfSuiteId", { maximum: UINT32_MAX }),
    fatherNameField: normalizeBigIntField(raw.fatherNameField, "fatherNameField", {
      defaultValue: 0,
    }),
    fatherDerivedSecretField: normalizeBigIntField(
      raw.fatherDerivedSecretField,
      "fatherDerivedSecretField",
      { defaultValue: 0 },
    ),
    fatherIsBirthBC: normalizeBit(raw.fatherIsBirthBC, "fatherIsBirthBC", { defaultValue: 0 }),
    fatherBirthYear: normalizeBigIntField(raw.fatherBirthYear, "fatherBirthYear", {
      defaultValue: 0,
    }),
    fatherBirthMonth: normalizeBigIntField(raw.fatherBirthMonth, "fatherBirthMonth", {
      defaultValue: 0,
    }),
    fatherBirthDay: normalizeBigIntField(raw.fatherBirthDay, "fatherBirthDay", {
      defaultValue: 0,
    }),
    fatherGender: normalizeBigIntField(raw.fatherGender, "fatherGender", { defaultValue: 0 }),
    fatherSuiteId: normalizeBigIntField(raw.fatherSuiteId, "fatherSuiteId", {
      defaultValue: 0,
      maximum: UINT32_MAX,
    }),
    motherNameField: normalizeBigIntField(raw.motherNameField, "motherNameField", {
      defaultValue: 0,
    }),
    motherDerivedSecretField: normalizeBigIntField(
      raw.motherDerivedSecretField,
      "motherDerivedSecretField",
      { defaultValue: 0 },
    ),
    motherIsBirthBC: normalizeBit(raw.motherIsBirthBC, "motherIsBirthBC", { defaultValue: 0 }),
    motherBirthYear: normalizeBigIntField(raw.motherBirthYear, "motherBirthYear", {
      defaultValue: 0,
    }),
    motherBirthMonth: normalizeBigIntField(raw.motherBirthMonth, "motherBirthMonth", {
      defaultValue: 0,
    }),
    motherBirthDay: normalizeBigIntField(raw.motherBirthDay, "motherBirthDay", {
      defaultValue: 0,
    }),
    motherGender: normalizeBigIntField(raw.motherGender, "motherGender", { defaultValue: 0 }),
    motherSuiteId: normalizeBigIntField(raw.motherSuiteId, "motherSuiteId", {
      defaultValue: 0,
      maximum: UINT32_MAX,
    }),
    hasFather: normalizeBit(raw.hasFather, "hasFather", { defaultValue: 0 }),
    hasMother: normalizeBit(raw.hasMother, "hasMother", { defaultValue: 0 }),
    submitter: normalizeBigIntField(raw.submitter, "submitter", { maximum: UINT160_MAX }),
    contentDigestLo: normalizeBigIntField(raw.contentDigestLo, "contentDigestLo", {
      maximum: UINT128_MAX,
    }),
    contentDigestHi: normalizeBigIntField(raw.contentDigestHi, "contentDigestHi", {
      maximum: UINT128_MAX,
    }),
  };

  if (input.selfSuiteId === 0n) throw new Error("selfSuiteId must be nonzero");
  for (const role of ["father", "mother"]) {
    const present = input[`has${role[0].toUpperCase()}${role.slice(1)}`] === 1n;
    const suiteId = input[`${role}SuiteId`];
    if ((suiteId !== 0n) !== present) {
      throw new Error(`${role}SuiteId must be nonzero exactly when ${role} is present`);
    }
    if (!present) {
      for (const suffix of [
        "NameField",
        "DerivedSecretField",
        "IsBirthBC",
        "BirthYear",
        "BirthMonth",
        "BirthDay",
        "Gender",
      ]) {
        if (input[`${role}${suffix}`] !== 0n) {
          throw new Error(`Absent ${role} witness ${role}${suffix} must be zero`);
        }
      }
    }
  }
  return input;
}

function packBirthGenderField(fields) {
  return (
    (fields.birthYear << 25n) |
    (fields.birthMonth << 17n) |
    (fields.birthDay << 9n) |
    (fields.gender << 1n) |
    fields.isBirthBC
  );
}

function computeIdentityCommitment(fields, suiteId) {
  const suiteCommitment = poseidon4([1000n, suiteId, 0n, 0n]);
  const nameSecretCommitment = poseidon4([
    1001n,
    fields.nameField,
    fields.derivedSecretField,
    suiteCommitment,
  ]);
  return poseidon4([1002n, nameSecretCommitment, packBirthGenderField(fields), suiteCommitment]);
}

function roleFields(input, role = "") {
  const field = (suffix) =>
    input[role ? `${role}${suffix[0].toUpperCase()}${suffix.slice(1)}` : suffix];
  return {
    nameField: field("nameField"),
    derivedSecretField: field("derivedSecretField"),
    isBirthBC: field("isBirthBC"),
    birthYear: field("birthYear"),
    birthMonth: field("birthMonth"),
    birthDay: field("birthDay"),
    gender: field("gender"),
  };
}

async function computeExpectedSignals(input) {
  const values = {
    identityCommitment: computeIdentityCommitment(roleFields(input), input.selfSuiteId),
    fatherIdentityCommitment:
      input.hasFather === 1n
        ? computeIdentityCommitment(roleFields(input, "father"), input.fatherSuiteId)
        : 0n,
    motherIdentityCommitment:
      input.hasMother === 1n
        ? computeIdentityCommitment(roleFields(input, "mother"), input.motherSuiteId)
        : 0n,
    submitterAndSelfSuiteId: input.submitter + (input.selfSuiteId << 160n),
    versionCommitment: poseidon4([
      1004n,
      input.derivedSecretField,
      input.contentDigestLo,
      input.contentDigestHi,
    ]),
  };
  return PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.fieldOrder.map((name) => values[name].toString());
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

function loadPublicSignals(filePath) {
  const raw = loadJson(filePath);
  const signals = Array.isArray(raw) ? raw : raw?.publicSignals;
  if (!Array.isArray(signals)) {
    throw new Error(`Unsupported public signals JSON structure in ${filePath}`);
  }
  return signals.map(String);
}

function comparePublicSignals(expected, actual) {
  const mismatches = [];
  const maxLength = Math.max(expected.length, actual.length);
  for (let index = 0; index < maxLength; index += 1) {
    const expectedValue = expected[index]?.toString();
    const actualValue = actual[index]?.toString();
    if (expectedValue !== actualValue) {
      mismatches.push({ index, expected: expectedValue, actual: actualValue });
    }
  }
  return { match: mismatches.length === 0, mismatches };
}

function resolveExistingFile(label, explicitPath, candidates) {
  const searchOrder = [
    ...(explicitPath ? [path.resolve(process.cwd(), explicitPath)] : []),
    ...candidates,
  ].filter((candidate, index, values) => values.indexOf(candidate) === index);
  const found = searchOrder.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  throw new Error(
    `Unable to locate ${label}. Checked paths:\n${searchOrder.map((entry) => `  - ${entry}`).join("\n")}`,
  );
}

function parseArgs(rawArgs) {
  const args = { prove: false, help: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const current = rawArgs[index];
    if (["--input", "--public", "--wasm", "--zkey", "--vkey", "--submitter"].includes(current)) {
      args[current.slice(2)] = rawArgs[++index];
    } else if (current === "--prove") {
      args.prove = true;
    } else if (current === "--help" || current === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${current}`);
    }
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.input) {
    console.log(
      "Usage: node tasks/zk-person-hash-check.mjs --input FILE [--submitter ADDRESS] [--public FILE] [--prove] [--wasm FILE] [--zkey FILE] [--vkey FILE]",
    );
    if (!args.help) process.exitCode = 1;
    return;
  }

  const rawInput = loadJson(args.input);
  if (args.submitter !== undefined) rawInput.submitter = args.submitter;
  const input = validatePersonCommitmentInput(rawInput);
  const expectedSignals = await computeExpectedSignals(input);
  console.log("PersonRelation v1 expected public signals:");
  PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.fieldOrder.forEach((name, index) => {
    console.log(`  ${name}: ${expectedSignals[index]}`);
  });

  if (args.public) {
    const comparison = comparePublicSignals(expectedSignals, loadPublicSignals(args.public));
    if (!comparison.match) {
      console.error("Provided public signals do not match:", comparison.mismatches);
      process.exitCode = 1;
    }
  }

  if (args.prove) {
    const wasmPath = resolveExistingFile(
      "person relation wasm",
      args.wasm,
      DEFAULT_WASM_CANDIDATES,
    );
    const zkeyPath = resolveExistingFile(
      "person relation zkey",
      args.zkey,
      DEFAULT_ZKEY_CANDIDATES,
    );
    const vkeyPath = resolveExistingFile(
      "person relation vkey",
      args.vkey,
      DEFAULT_VKEY_CANDIDATES,
    );
    const snarkjs = await import("snarkjs");
    const witness = Object.fromEntries(
      Object.entries(input).map(([name, value]) => [name, value.toString()]),
    );
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(witness, wasmPath, zkeyPath);
    const verificationKey = loadJson(vkeyPath);
    if (!(await snarkjs.groth16.verify(verificationKey, publicSignals, proof))) {
      throw new Error("Generated PersonRelation proof failed verification");
    }
    const comparison = comparePublicSignals(expectedSignals, publicSignals);
    if (!comparison.match) {
      throw new Error(`Generated PersonRelation signals mismatch: ${JSON.stringify(comparison)}`);
    }
    const tampered = [...publicSignals];
    tampered[0] = (BigInt(tampered[0]) + 1n).toString();
    if (await snarkjs.groth16.verify(verificationKey, tampered, proof)) {
      throw new Error("PersonRelation verifier accepted tampered public signals");
    }
    console.log("Generated proof verifies; tampered public signals are rejected.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}

export {
  comparePublicSignals,
  computeExpectedSignals,
  loadJson,
  loadPublicSignals,
  parseArgs,
  validatePersonCommitmentInput,
};
