/*
Person-commitment checker for the active person_commitment circuit.

Features:
- Loads a current circuit input JSON containing person / father / mother fields,
  presence flags, submitter, and version metadata.
- Recomputes the expected public signals order from the JS authority spec.
- Optionally reads an existing publicSignals JSON to compare results.
- Optionally generates a fresh proof (snarkjs groth16.fullProve) using
  discovered or user-supplied wasm/zkey artifacts.
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { poseidon4 } from "poseidon-lite";
import { resolveDescriptorNodeArtifactCandidates } from "../lib/proofCommon.js";
import { PERSON_COMMITMENT_PROOF_DESCRIPTOR } from "../lib/proofDescriptors.js";
import { PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC } from "../lib/publicSignalSpecs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_WASM_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  PERSON_COMMITMENT_PROOF_DESCRIPTOR,
  "wasm",
);
const DEFAULT_ZKEY_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  PERSON_COMMITMENT_PROOF_DESCRIPTOR,
  "zkey",
);

function normalizeBigIntField(value, label, { defaultValue } = {}) {
  const normalizedValue = value ?? defaultValue;
  if (normalizedValue === undefined || normalizedValue === null || normalizedValue === "") {
    throw new Error(`${label} is required`);
  }

  try {
    const normalized = BigInt(normalizedValue);
    if (normalized < 0n) {
      throw new Error(`${label} must be non-negative`);
    }
    return normalized;
  } catch {
    throw new Error(`${label} must be a non-negative integer-like value`);
  }
}

function normalizeBit(value, label, { defaultValue } = {}) {
  const normalized = normalizeBigIntField(value, label, { defaultValue });
  if (normalized !== 0n && normalized !== 1n) {
    throw new Error(`${label} must be 0 or 1`);
  }
  return normalized;
}

function validatePersonCommitmentInput(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      "Input JSON must be an object with person / parent fields, hasFather / hasMother, submitter, schemaVersion, cryptoSuiteVersion, and hashAlgoId",
    );
  }

  return {
    nameField: normalizeBigIntField(raw.nameField, "nameField"),
    derivedSecretField: normalizeBigIntField(raw.derivedSecretField, "derivedSecretField"),
    isBirthBC: normalizeBit(raw.isBirthBC, "isBirthBC"),
    birthYear: normalizeBigIntField(raw.birthYear, "birthYear"),
    birthMonth: normalizeBigIntField(raw.birthMonth, "birthMonth"),
    birthDay: normalizeBigIntField(raw.birthDay, "birthDay"),
    gender: normalizeBigIntField(raw.gender, "gender"),
    fatherNameField: normalizeBigIntField(raw.fatherNameField, "fatherNameField", { defaultValue: 0 }),
    fatherDerivedSecretField: normalizeBigIntField(
      raw.fatherDerivedSecretField,
      "fatherDerivedSecretField",
      { defaultValue: 0 },
    ),
    fatherIsBirthBC: normalizeBit(raw.fatherIsBirthBC, "fatherIsBirthBC", { defaultValue: 0 }),
    fatherBirthYear: normalizeBigIntField(raw.fatherBirthYear, "fatherBirthYear", { defaultValue: 0 }),
    fatherBirthMonth: normalizeBigIntField(raw.fatherBirthMonth, "fatherBirthMonth", { defaultValue: 0 }),
    fatherBirthDay: normalizeBigIntField(raw.fatherBirthDay, "fatherBirthDay", { defaultValue: 0 }),
    fatherGender: normalizeBigIntField(raw.fatherGender, "fatherGender", { defaultValue: 0 }),
    motherNameField: normalizeBigIntField(raw.motherNameField, "motherNameField", { defaultValue: 0 }),
    motherDerivedSecretField: normalizeBigIntField(
      raw.motherDerivedSecretField,
      "motherDerivedSecretField",
      { defaultValue: 0 },
    ),
    motherIsBirthBC: normalizeBit(raw.motherIsBirthBC, "motherIsBirthBC", { defaultValue: 0 }),
    motherBirthYear: normalizeBigIntField(raw.motherBirthYear, "motherBirthYear", { defaultValue: 0 }),
    motherBirthMonth: normalizeBigIntField(raw.motherBirthMonth, "motherBirthMonth", { defaultValue: 0 }),
    motherBirthDay: normalizeBigIntField(raw.motherBirthDay, "motherBirthDay", { defaultValue: 0 }),
    motherGender: normalizeBigIntField(raw.motherGender, "motherGender", { defaultValue: 0 }),
    hasFather: normalizeBit(raw.hasFather, "hasFather", { defaultValue: 0 }),
    hasMother: normalizeBit(raw.hasMother, "hasMother", { defaultValue: 0 }),
    submitter: normalizeBigIntField(raw.submitter, "submitter"),
    schemaVersion: normalizeBigIntField(raw.schemaVersion, "schemaVersion"),
    cryptoSuiteVersion: normalizeBigIntField(raw.cryptoSuiteVersion, "cryptoSuiteVersion"),
    hashAlgoId: normalizeBigIntField(raw.hashAlgoId, "hashAlgoId"),
  };
}

function packBirthGenderField({ birthYear, birthMonth, birthDay, gender, isBirthBC }) {
  return (
    (birthYear << 24n) |
    (birthMonth << 16n) |
    (birthDay << 8n) |
    (gender << 1n) |
    (isBirthBC & 1n)
  );
}

function computeIdentityCommitmentFromFields(
  nameField,
  derivedSecretField,
  isBirthBC,
  birthYear,
  birthMonth,
  birthDay,
  gender,
  suiteCommitment,
) {
  const packedBirthGenderField = packBirthGenderField({
    birthYear,
    birthMonth,
    birthDay,
    gender,
    isBirthBC,
  });
  const nameSecretCommitment = poseidon4([
    1001n,
    nameField,
    derivedSecretField,
    suiteCommitment,
  ]);
  return poseidon4([
    1002n,
    nameSecretCommitment,
    packedBirthGenderField,
    suiteCommitment,
  ]);
}

async function computeExpectedSignals(input) {
  const suiteCommitment = poseidon4([
    1000n,
    input.schemaVersion,
    input.cryptoSuiteVersion,
    input.hashAlgoId,
  ]);

  const signalValues = {
    identityCommitment: computeIdentityCommitmentFromFields(
      input.nameField,
      input.derivedSecretField,
      input.isBirthBC,
      input.birthYear,
      input.birthMonth,
      input.birthDay,
      input.gender,
      suiteCommitment,
    ),
    fatherIdentityCommitment:
      input.hasFather === 1n
        ? computeIdentityCommitmentFromFields(
            input.fatherNameField,
            input.fatherDerivedSecretField,
            input.fatherIsBirthBC,
            input.fatherBirthYear,
            input.fatherBirthMonth,
            input.fatherBirthDay,
            input.fatherGender,
            suiteCommitment,
          )
        : 0n,
    motherIdentityCommitment:
      input.hasMother === 1n
        ? computeIdentityCommitmentFromFields(
            input.motherNameField,
            input.motherDerivedSecretField,
            input.motherIsBirthBC,
            input.motherBirthYear,
            input.motherBirthMonth,
            input.motherBirthDay,
            input.motherGender,
            suiteCommitment,
          )
        : 0n,
    submitter: input.submitter,
    schemaVersion: input.schemaVersion,
    cryptoSuiteVersion: input.cryptoSuiteVersion,
    hashAlgoId: input.hashAlgoId,
  };

  return PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.fieldOrder.map((fieldName) =>
    signalValues[fieldName].toString(),
  );
}

function loadJson(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function loadPublicSignals(filePath) {
  const raw = loadJson(filePath);
  if (Array.isArray(raw)) {
    return raw.map((x) => x.toString());
  }
  if (raw && Array.isArray(raw.publicSignals)) {
    return raw.publicSignals.map((x) => x.toString());
  }
  throw new Error(`Unsupported public signals JSON structure in ${filePath}`);
}

function comparePublicSignals(expected, actual) {
  const result = {
    match: true,
    mismatches: [],
  };

  const maxLength = Math.max(expected.length, actual.length);
  for (let i = 0; i < maxLength; i++) {
    const expectedVal = expected[i]?.toString();
    const actualVal = actual[i]?.toString();

    if (expectedVal !== actualVal) {
      result.match = false;
      result.mismatches.push({ index: i, expected: expectedVal, actual: actualVal });
    }
  }

  return result;
}

function resolveExistingFile(label, explicitPath, candidates) {
  const searchOrder = [];
  if (explicitPath && explicitPath.trim().length > 0) {
    searchOrder.push(path.resolve(process.cwd(), explicitPath));
  }
  for (const candidate of candidates) {
    if (!searchOrder.includes(candidate)) {
      searchOrder.push(candidate);
    }
  }

  for (const candidate of searchOrder) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to locate ${label}. Checked paths:\n${searchOrder.map((p) => `  - ${p}`).join("\n")}`,
  );
}

function parseArgs(rawArgs) {
  const args = {
    prove: false,
    help: false,
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const current = rawArgs[i];
    switch (current) {
      case "--input":
        args.input = rawArgs[++i];
        break;
      case "--public":
        args.public = rawArgs[++i];
        break;
      case "--wasm":
        args.wasm = rawArgs[++i];
        break;
      case "--zkey":
        args.zkey = rawArgs[++i];
        break;
      case "--submitter":
        args.submitter = rawArgs[++i];
        break;
      case "--prove":
        args.prove = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return args;
}

function formatSignalsForLog(signals) {
  PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.fieldOrder.forEach((fieldName, index) => {
    console.log(`  ${fieldName}: ${signals[index]}`);
  });
}

function printUsage() {
  console.log(`Usage:
  node tasks/zk-person-hash-check.mjs --input person_commitment_input.json [--public person_commitment_public.json] [--prove] [--wasm path] [--zkey path]
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    printUsage();
    process.exit(args.input ? 0 : 1);
  }

  const rawInput = loadJson(args.input);
  if (args.submitter !== undefined) {
    rawInput.submitter = args.submitter;
  }
  const input = validatePersonCommitmentInput(rawInput);
  const expectedSignals = await computeExpectedSignals(input);

  console.log("Person Commitment input summary:");
  console.log("  hasFather:", input.hasFather.toString());
  console.log("  hasMother:", input.hasMother.toString());
  console.log("  submitter:", input.submitter.toString());

  console.log("\nExpected public signals:");
  formatSignalsForLog(expectedSignals);
  console.log(`  Array format: ${JSON.stringify(expectedSignals)}`);

  if (args.public) {
    console.log("\nComparing with provided public signals file...");
    const actualSignals = loadPublicSignals(args.public);
    const comparison = comparePublicSignals(expectedSignals, actualSignals);

    if (comparison.match) {
      console.log("  All signals match");
    } else {
      console.log("  Mismatch detected");
      comparison.mismatches.forEach(({ index, expected, actual }) => {
        console.log(`    [${index}] expected=${expected} actual=${actual}`);
      });
      process.exitCode = 1;
    }
  }

  if (args.prove) {
    const wasmPath = resolveExistingFile(
      "person commitment circuit wasm",
      args.wasm,
      DEFAULT_WASM_CANDIDATES,
    );
    const zkeyPath = resolveExistingFile(
      "person commitment circuit zkey",
      args.zkey,
      DEFAULT_ZKEY_CANDIDATES,
    );

    console.log("\nRunning groth16.fullProve for confirmation...");
    const snarkjs = await import("snarkjs");
    const circuitInput = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, value.toString()]),
    );
    const { publicSignals } = await snarkjs.groth16.fullProve(circuitInput, wasmPath, zkeyPath);

    const actualSignals = publicSignals.map((value) => value.toString());
    const comparison = comparePublicSignals(expectedSignals, actualSignals);
    if (comparison.match) {
      console.log("  Generated proof public signals match expected values");
    } else {
      console.log("  Generated proof public signals mismatch");
      comparison.mismatches.forEach(({ index, expected, actual }) => {
        console.log(`    [${index}] expected=${expected} actual=${actual}`);
      });
      process.exitCode = 1;
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  validatePersonCommitmentInput,
  computeExpectedSignals,
  comparePublicSignals,
  parseArgs,
  loadPublicSignals,
  loadJson,
};
