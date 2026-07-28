/*
Disclosure-binding checker for the active disclosure_binding circuit.

Features:
- Loads a current circuit input JSON containing nameField / derivedSecretField /
  packedBirthGenderField / minter / version metadata.
- Recomputes the expected public signals order from the JS authority spec.
- Optionally reads an existing publicSignals JSON to compare results.
- Optionally generates a fresh proof (snarkjs groth16.fullProve) using
  discovered or user-supplied wasm/zkey artifacts.
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { poseidon4 } from "poseidon-lite";
import { DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC } from "@deepfamily/proof-core";
import { DISCLOSURE_BINDING_PROOF_DESCRIPTOR } from "../lib/proofDescriptors.js";
import {
  resolveExistingFile,
  DEFAULT_WASM_CANDIDATES,
  DEFAULT_ZKEY_CANDIDATES,
} from "./zk-generate-disclosure-binding-proof.mjs";
import { resolveDescriptorNodeArtifactCandidates } from "../lib/proofCommon.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VKEY_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  "vkey",
);

function normalizeBigIntField(value, label) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${label} is required`);
  }

  try {
    const normalized = BigInt(value);
    if (normalized < 0n) {
      throw new Error(`${label} must be non-negative`);
    }
    return normalized;
  } catch {
    throw new Error(`${label} must be a non-negative integer-like value`);
  }
}

function validateDisclosureBindingInput(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      "Input JSON must be an object with nameField, derivedSecretField, packedBirthGenderField, minter, schemaVersion, cryptoSuiteVersion, and hashAlgoId fields",
    );
  }

  return {
    nameField: normalizeBigIntField(raw.nameField, "nameField"),
    derivedSecretField: normalizeBigIntField(raw.derivedSecretField, "derivedSecretField"),
    packedBirthGenderField: normalizeBigIntField(
      raw.packedBirthGenderField,
      "packedBirthGenderField",
    ),
    minter: normalizeBigIntField(raw.minter, "minter"),
    schemaVersion: normalizeBigIntField(raw.schemaVersion, "schemaVersion"),
    cryptoSuiteVersion: normalizeBigIntField(raw.cryptoSuiteVersion, "cryptoSuiteVersion"),
    hashAlgoId: normalizeBigIntField(raw.hashAlgoId, "hashAlgoId"),
  };
}

async function computeExpectedSignals(input) {
  const suiteCommitment = poseidon4([
    1000n,
    input.schemaVersion,
    input.cryptoSuiteVersion,
    input.hashAlgoId,
  ]);
  const nameSecretCommitment = poseidon4([
    1001n,
    input.nameField,
    input.derivedSecretField,
    suiteCommitment,
  ]);
  const signalValues = {
    identityCommitment: poseidon4([
      1002n,
      nameSecretCommitment,
      input.packedBirthGenderField,
      suiteCommitment,
    ]),
    disclosureBinding: poseidon4([
      1003n,
      input.nameField,
      input.packedBirthGenderField,
      suiteCommitment,
    ]),
    minter: input.minter,
    schemaVersion: input.schemaVersion,
    cryptoSuiteVersion: input.cryptoSuiteVersion,
    hashAlgoId: input.hashAlgoId,
  };

  return DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC.fieldOrder.map((fieldName) =>
    signalValues[fieldName].toString(),
  );
}

function loadJson(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
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
      case "--vkey":
        args.vkey = rawArgs[++i];
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
  DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC.fieldOrder.forEach((fieldName, index) => {
    console.log(`  ${fieldName}: ${signals[index]}`);
  });
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

function printUsage() {
  console.log(`Usage:
  node tasks/zk-disclosure-binding-check.mjs --input disclosure_binding_input.json [--public disclosure_binding_public.json] [--prove] [--wasm path] [--zkey path] [--vkey path]
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    printUsage();
    process.exit(args.input ? 0 : 1);
  }

  const input = validateDisclosureBindingInput(loadJson(args.input));
  const expectedSignals = await computeExpectedSignals(input);

  console.log("Disclosure Binding input summary:");
  console.log("  nameField:", input.nameField.toString());
  console.log("  derivedSecretField:", input.derivedSecretField.toString());
  console.log("  packedBirthGenderField:", input.packedBirthGenderField.toString());
  console.log("  minter address (decimal):", input.minter.toString());

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
      "disclosure binding circuit wasm",
      args.wasm,
      DEFAULT_WASM_CANDIDATES,
    );
    const zkeyPath = resolveExistingFile(
      "disclosure binding circuit zkey",
      args.zkey,
      DEFAULT_ZKEY_CANDIDATES,
    );
    const vkeyPath = resolveExistingFile(
      "disclosure binding verification key",
      args.vkey,
      DEFAULT_VKEY_CANDIDATES,
    );

    console.log("\nRunning groth16.fullProve and independent verification...");
    const snarkjs = await import("snarkjs");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.toString()])),
      wasmPath,
      zkeyPath,
    );
    const verificationKey = loadJson(vkeyPath);
    const proofVerified = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
    if (proofVerified !== true) {
      throw new Error("Generated disclosure binding proof failed verification against the vkey");
    }
    console.log("  Generated proof verifies against the committed verification key");
    const tamperedSignals = [...publicSignals];
    tamperedSignals[0] = (BigInt(tamperedSignals[0]) + 1n).toString();
    if ((await snarkjs.groth16.verify(verificationKey, tamperedSignals, proof)) !== false) {
      throw new Error("Disclosure binding verifier accepted tampered public signals");
    }
    console.log("  Tampered public signals are rejected");

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
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}

export {
  validateDisclosureBindingInput,
  computeExpectedSignals,
  comparePublicSignals,
  parseArgs,
  loadPublicSignals,
  loadJson,
};
