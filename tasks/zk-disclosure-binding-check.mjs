/* DisclosureBinding v1 checker for the disclosure_binding circuit artifact. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { poseidon4 } from "poseidon-lite";
import { DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC } from "@deepfamily/proof-core";
import { resolveDescriptorNodeArtifactCandidates } from "../lib/proofCommon.js";
import { DISCLOSURE_BINDING_PROOF_DESCRIPTOR } from "../lib/proofDescriptors.js";
import {
  DEFAULT_WASM_CANDIDATES,
  DEFAULT_ZKEY_CANDIDATES,
  resolveExistingFile,
} from "./zk-generate-disclosure-binding-proof.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UINT32_MAX = (1n << 32n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;
const DEFAULT_VKEY_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  "vkey",
);

function normalizeBigIntField(value, label, { maximum } = {}) {
  if (value === undefined || value === null || value === "")
    throw new Error(`${label} is required`);
  let normalized;
  try {
    normalized = BigInt(value);
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

function validateDisclosureBindingInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Input JSON must be a DisclosureBinding v1 witness");
  }
  const input = {
    nameField: normalizeBigIntField(raw.nameField, "nameField"),
    derivedSecretField: normalizeBigIntField(raw.derivedSecretField, "derivedSecretField"),
    packedBirthGenderField: normalizeBigIntField(
      raw.packedBirthGenderField,
      "packedBirthGenderField",
    ),
    minter: normalizeBigIntField(raw.minter, "minter", { maximum: UINT160_MAX }),
    selfSuiteId: normalizeBigIntField(raw.selfSuiteId, "selfSuiteId", { maximum: UINT32_MAX }),
  };
  if (input.selfSuiteId === 0n) throw new Error("selfSuiteId must be nonzero");
  return input;
}

async function computeExpectedSignals(input) {
  const suiteCommitment = poseidon4([1000n, input.selfSuiteId, 0n, 0n]);
  const nameSecretCommitment = poseidon4([
    1001n,
    input.nameField,
    input.derivedSecretField,
    suiteCommitment,
  ]);
  const values = {
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
    suiteCommitment,
  };
  return DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.fieldOrder.map((name) => values[name].toString());
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

function parseArgs(rawArgs) {
  const args = { prove: false, help: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const current = rawArgs[index];
    if (["--input", "--public", "--wasm", "--zkey", "--vkey"].includes(current)) {
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
      "Usage: node tasks/zk-disclosure-binding-check.mjs --input FILE [--public FILE] [--prove] [--wasm FILE] [--zkey FILE] [--vkey FILE]",
    );
    if (!args.help) process.exitCode = 1;
    return;
  }

  const input = validateDisclosureBindingInput(loadJson(args.input));
  const expectedSignals = await computeExpectedSignals(input);
  console.log("DisclosureBinding v1 expected public signals:");
  DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.fieldOrder.forEach((name, index) => {
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
      "disclosure binding wasm",
      args.wasm,
      DEFAULT_WASM_CANDIDATES,
    );
    const zkeyPath = resolveExistingFile(
      "disclosure binding zkey",
      args.zkey,
      DEFAULT_ZKEY_CANDIDATES,
    );
    const vkeyPath = resolveExistingFile(
      "disclosure binding vkey",
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
      throw new Error("Generated DisclosureBinding proof failed verification");
    }
    const comparison = comparePublicSignals(expectedSignals, publicSignals);
    if (!comparison.match) {
      throw new Error(
        `Generated DisclosureBinding signals mismatch: ${JSON.stringify(comparison)}`,
      );
    }
    const tampered = [...publicSignals];
    tampered[0] = (BigInt(tampered[0]) + 1n).toString();
    if (await snarkjs.groth16.verify(verificationKey, tampered, proof)) {
      throw new Error("DisclosureBinding verifier accepted tampered public signals");
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
  validateDisclosureBindingInput,
};
