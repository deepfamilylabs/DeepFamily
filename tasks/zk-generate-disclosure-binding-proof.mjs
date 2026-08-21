import { task } from "hardhat/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArgumentType } from "hardhat/types/arguments";
import disclosureBindingProof from "../lib/disclosureBindingProof.js";
import { DISCLOSURE_BINDING_PROOF_DESCRIPTOR } from "../lib/proofDescriptors.js";
import { resolveDescriptorNodeArtifactCandidates } from "../lib/proofCommon.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { buildDisclosureBindingInput: buildProofInput, generateDisclosureBindingProof } =
  disclosureBindingProof;

export const DEFAULT_WASM_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  "wasm",
);
export const DEFAULT_ZKEY_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  "zkey",
);

export function normalizeNameForHash(value) {
  if (value === undefined || value === null) return "";
  const normalized =
    typeof String(value).normalize === "function" ? String(value).normalize("NFKC") : String(value);
  return normalized.replace(/\s+/gu, " ").trim();
}

export function parseDisclosureBindingPersonArgs(args) {
  const fullName = String(args.fullname ?? "");
  const birthYear = Number(args.birthyear ?? 0);
  const birthMonth = Number(args.birthmonth ?? 0);
  const birthDay = Number(args.birthday ?? 0);
  const gender = Number(args.gender ?? 0);
  const derivedSecretField = BigInt(args.derivedsecretfield ?? 0);

  if (fullName.trim().length === 0) {
    throw new Error("Full name must be a non-empty string");
  }
  if (!Number.isInteger(birthYear) || birthYear < 0 || birthYear > 65535) {
    throw new Error("birthYear must be an integer in [0, 65535]");
  }
  if (!Number.isInteger(birthMonth) || birthMonth < 0 || birthMonth > 12) {
    throw new Error("birthMonth must be an integer in [0, 12]");
  }
  if (!Number.isInteger(birthDay) || birthDay < 0 || birthDay > 31) {
    throw new Error("birthDay must be an integer in [0, 31]");
  }
  if (!Number.isInteger(gender) || gender < 0 || gender > 255) {
    throw new Error("gender must be an integer in [0, 255]");
  }
  if (derivedSecretField < 0n) {
    throw new Error("derivedSecretField must be non-negative");
  }

  return {
    fullName,
    derivedSecretField,
    isBirthBC: String(args.birthbc ?? "false").toLowerCase() === "true",
    birthYear,
    birthMonth,
    birthDay,
    gender,
  };
}

export function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  } else if (!fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Output path exists and is not a directory: ${dirPath}`);
  }
}

export function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function resolveExistingFile(label, explicitPath, candidates) {
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

export function buildDisclosureBindingTaskInput(args, defaultMinter = "") {
  const person = parseDisclosureBindingPersonArgs(args);
  const minter = args.minter || defaultMinter;
  const opts = {
    selfSuiteId: Number(args.selfsuiteid ?? 1),
  };

  const built = buildProofInput(person, minter, opts);
  return {
    person,
    built,
    minter: built.input.minter,
  };
}

export function formatBytePreview(value) {
  const rendered = String(value);
  return rendered.length > 24 ? `${rendered.slice(0, 24)}...` : rendered;
}

export function logPublicSignals(publicSignals) {
  const [identityCommitment, disclosureBinding, minter, suiteCommitment] = publicSignals.map((x) =>
    x.toString(),
  );
  console.log("\nPublic signals breakdown:");
  console.log("  identityCommitment:", identityCommitment);
  console.log("  disclosureBinding:", disclosureBinding);
  console.log("  minter:", minter);
  console.log("  suiteCommitment:", suiteCommitment);
}

const action = async (args, hre) => {
  console.log("Generating disclosure-binding ZK proof");
  console.log("========================================\n");

  const connection = await hre.network.connect();
  const { ethers } = connection;
  const signer = (await ethers.getSigners())[0];
  const defaultMinter = signer ? await signer.getAddress() : "";

  const { person, built, minter } = buildDisclosureBindingTaskInput(args, defaultMinter);

  console.log("Input data:");
  console.log("  Full name:", person.fullName);
  console.log("  Canonical full name:", built.canonicalFullName);
  console.log("  nameField:", formatBytePreview(built.input.nameField));
  console.log("  packedBirthGenderField:", built.input.packedBirthGenderField);
  console.log("  derivedSecretField:", built.input.derivedSecretField);
  console.log("  minter (decimal):", minter);

  const outputDir = path.resolve(process.cwd(), args.output);
  ensureDirectory(outputDir);

  const inputPath = path.join(outputDir, "disclosure_binding_input.json");
  writeJson(inputPath, built.input);
  console.log("Input file written to:", inputPath);

  if (args.skipProof) {
    console.log("Skipping proof generation (--skip-proof flag supplied).");
    return built;
  }

  const result = await generateDisclosureBindingProof(person, minter, {
    wasm: args.wasm,
    zkey: args.zkey,
    selfSuiteId: Number(args.selfsuiteid ?? 1),
  });

  const proofPath = path.join(outputDir, "disclosure_binding_proof.json");
  const publicPath = path.join(outputDir, "disclosure_binding_public.json");

  writeJson(proofPath, result.proof);
  writeJson(publicPath, { publicSignals: result.publicSignals.map(String) });

  console.log("Proof written to:", proofPath);
  console.log("Public signals written to:", publicPath);

  logPublicSignals(result.publicSignals);

  console.log("\nDisclosure-binding proof generation complete!");
  return result;
};

function applyTaskOptions(builder) {
  return builder
    .addOption({
      name: "fullname",
      description: "Full name to bind",
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addOption({
      name: "derivedsecretfield",
      description: "Derived secret field element used by identity commitment",
      type: ArgumentType.STRING,
      defaultValue: "0",
    })
    .addOption({
      name: "birthbc",
      description: "Is birth year BC (true/false)",
      type: ArgumentType.STRING,
      defaultValue: "false",
    })
    .addOption({
      name: "birthyear",
      description: "Birth year (0=unknown)",
      type: ArgumentType.STRING,
      defaultValue: "0",
    })
    .addOption({
      name: "birthmonth",
      description: "Birth month (0-12)",
      type: ArgumentType.STRING,
      defaultValue: "0",
    })
    .addOption({
      name: "birthday",
      description: "Birth day (0-31)",
      type: ArgumentType.STRING,
      defaultValue: "0",
    })
    .addOption({
      name: "gender",
      description: "Gender (0=Unknown, 1=Male, 2=Female, 3=Other, 4-255=Custom)",
      type: ArgumentType.STRING,
      defaultValue: "0",
    })
    .addOption({
      name: "selfsuiteid",
      description: "Private nonzero uint32 identity suite ID",
      type: ArgumentType.STRING,
      defaultValue: "1",
    })
    .addOption({
      name: "output",
      description: "Output directory for proof files",
      type: ArgumentType.STRING,
      defaultValue: "./proof_output",
    })
    .addOption({
      name: "wasm",
      description: "Override path to disclosure binding circuit wasm",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .addOption({
      name: "zkey",
      description: "Override path to disclosure binding circuit zkey",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .addOption({
      name: "minter",
      description: "Override minter address for the proof (defaults to signer)",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .addFlag({
      name: "skipProof",
      description: "Only emit input JSON without running snarkjs",
    });
}

export default applyTaskOptions(
  task("generate-disclosure-binding-proof", "Generate a disclosure-binding ZK proof"),
)
  .setAction(() => Promise.resolve({ default: action }))
  .build();
