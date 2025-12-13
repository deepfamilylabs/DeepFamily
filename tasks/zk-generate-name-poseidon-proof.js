const { task } = require("hardhat/config");
const fs = require("fs");
const path = require("path");
const { keccak256, getBytes, getAddress } = require("ethers");
const { TextEncoder } = require("util");
const { normalizeNameForHash, normalizePassphraseForHash } = require("../lib/namePoseidon");

const ZERO_BYTES32 = Object.freeze(new Array(32).fill(0));
const textEncoder = new TextEncoder();

const DEFAULT_WASM_CANDIDATES = [
  path.join(__dirname, "../circuits/name_poseidon_zk_js/name_poseidon_zk.wasm"),
  path.join(__dirname, "../circuits/name_poseidon_js/name_poseidon.wasm"),
];

const DEFAULT_ZKEY_CANDIDATES = [
  path.join(__dirname, "../circuits/name_poseidon_0001.zkey"),
  path.join(__dirname, "../circuits/name_poseidon_0000.zkey"),
  path.join(__dirname, "../artifacts/circuits/name_poseidon_final.zkey"),
];

function keccakUtf8Bytes(value) {
  const bytes = getBytes(keccak256(textEncoder.encode(value)));
  return Array.from(bytes);
}

function zeroBytes32() {
  return ZERO_BYTES32.slice();
}

const ADDRESS_BIT_LIMIT = 160n;
const ADDRESS_MAX = 1n << ADDRESS_BIT_LIMIT;

function normaliseMinter(minter, fallback = "") {
  let candidate = minter;
  if (candidate === undefined || candidate === null || candidate === "") {
    candidate = fallback;
  }

  if (candidate === undefined || candidate === null || String(candidate).trim().length === 0) {
    return "0";
  }

  let bigintValue;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
      const checksummed = getAddress(trimmed);
      bigintValue = BigInt(checksummed);
    } else {
      bigintValue = BigInt(trimmed);
    }
  } else if (typeof candidate === "number") {
    if (!Number.isSafeInteger(candidate) || candidate < 0) {
      throw new Error("minter must be a non-negative safe integer, decimal string, or hex string");
    }
    bigintValue = BigInt(candidate);
  } else if (typeof candidate === "bigint") {
    bigintValue = candidate;
  } else {
    throw new Error("minter must be provided as string/number/bigint");
  }

  if (bigintValue < 0n || bigintValue >= ADDRESS_MAX) {
    throw new Error("minter must fit within 160 bits (Ethereum address range)");
  }

  return bigintValue.toString();
}

function buildNamePoseidonInput(fullName, passphrase, minter) {
  const normalizedName = normalizeNameForHash(fullName);
  const normalizedPassphrase = normalizePassphraseForHash(
    typeof passphrase === "string" ? passphrase : "",
  );

  if (typeof fullName !== "string" || normalizedName.length === 0) {
    throw new Error("Full name must be a non-empty string");
  }

  return {
    fullNameHash: keccakUtf8Bytes(normalizedName),
    saltHash:
      normalizedPassphrase.length > 0 ? keccakUtf8Bytes(normalizedPassphrase) : zeroBytes32(),
    minter: normaliseMinter(minter),
  };
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  } else if (!fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Output path exists and is not a directory: ${dirPath}`);
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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

function formatBytePreview(bytes) {
  return bytes.slice(0, 8).join(", ") + (bytes.length > 8 ? ", ..." : "");
}

function logPublicSignals(publicSignals) {
  const [poseidonHi, poseidonLo, nameHi, nameLo, minter] = publicSignals.map((x) => x.toString());
  console.log("\nPublic signals breakdown:");
  console.log("  Poseidon digest (high, low):", poseidonHi, poseidonLo);
  console.log("  Full name hash (high, low):", nameHi, nameLo);
  console.log("  Minter (decimal):", minter);
}

try {
  task("generate-name-poseidon-proof", "Generate a name-poseidon ZK proof")
    .addParam("fullname", "Full name to hash")
    .addOptionalParam("passphrase", "Passphrase to hash", "")
    .addOptionalParam("output", "Output directory for proof files", "./proof_output")
    .addOptionalParam("wasm", "Override path to Poseidon circuit wasm", "")
    .addOptionalParam("zkey", "Override path to Poseidon circuit zkey", "")
    .addOptionalParam("minter", "Override minter address for the proof (defaults to signer)", "")
    .addFlag("skipProof", "Only emit input JSON without running snarkjs")
    .setAction(async (args, hre) => {
      console.log("🔐 Generating Name-Poseidon ZK proof");
      console.log("====================================\n");

      const signer = (await hre.ethers.getSigners())[0];
      const defaultMinter = signer ? signer.address : "";

      const input = buildNamePoseidonInput(
        args.fullname,
        args.passphrase,
        args.minter || defaultMinter,
      );

      console.log("Input data:");
      console.log("  Full name:", args.fullname);
      console.log("  Passphrase:", args.passphrase || "(empty)");
      console.log("  Full name hash bytes:", formatBytePreview(input.fullNameHash));
      console.log("  Salt hash bytes:", formatBytePreview(input.saltHash));
      console.log("  Minter (decimal):", input.minter);

      const outputDir = path.resolve(process.cwd(), args.output);
      ensureDirectory(outputDir);

      const inputPath = path.join(outputDir, "name_poseidon_input.json");
      writeJson(inputPath, input);
      console.log("✅ Input file written to:", inputPath);

      if (args.skipProof) {
        console.log("⏭️  Skipping proof generation (--skip-proof flag supplied).");
        return;
      }

      const wasmPath = resolveExistingFile(
        "Poseidon circuit wasm",
        args.wasm,
        DEFAULT_WASM_CANDIDATES,
      );
      const zkeyPath = resolveExistingFile(
        "Poseidon circuit zkey",
        args.zkey,
        DEFAULT_ZKEY_CANDIDATES,
      );

      console.log("🔄 Generating proof via snarkjs...");
      console.log("  wasm:", wasmPath);
      console.log("  zkey:", zkeyPath);

      const snarkjs = require("snarkjs");
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);

      const proofPath = path.join(outputDir, "name_poseidon_proof.json");
      const publicPath = path.join(outputDir, "name_poseidon_public.json");

      writeJson(proofPath, proof);
      writeJson(publicPath, { publicSignals });

      console.log("✅ Proof written to:", proofPath);
      console.log("✅ Public signals written to:", publicPath);

      logPublicSignals(publicSignals);

      console.log("\n🎉 Name-Poseidon proof generation complete!");
    });
} catch (error) {
  // When this module is required outside Hardhat (e.g., plain Node scripts), task registration throws HH5.
  if (!error?.message?.includes("HardhatContext")) {
    throw error;
  }
}

module.exports = {
  keccakUtf8Bytes,
  zeroBytes32,
  buildNamePoseidonInput,
  ensureDirectory,
  writeJson,
  resolveExistingFile,
  formatBytePreview,
  logPublicSignals,
  normaliseMinter,
  DEFAULT_WASM_CANDIDATES,
  DEFAULT_ZKEY_CANDIDATES,
};
