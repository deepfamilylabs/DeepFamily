import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// The frontend reads only each contract's ABI. The rest of a compiler artifact depends on which
// sources were compiled together: Hardhat's buildInfoId, Solidity's immutable-reference AST IDs and
// the bytecode's trailing metadata hash, which covers every remapping in the shared compiler input.
// An incremental build that recompiles the shielded pools without DeepFamily therefore emits
// different bytecode from a clean build, although the code is identical. Copying only the ABI and
// the contract's identity keeps checkouts clean; full artifacts remain in the root build output.
const FRONTEND_ARTIFACT_FIELDS = new Set([
  "_format",
  "contractName",
  "sourceName",
  "abi",
  "inputSourceName",
]);

export function normalizeFrontendArtifact(artifact) {
  if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("Contract artifact must be a JSON object");
  }
  if (!Array.isArray(artifact.abi)) {
    throw new Error("Contract artifact must contain an ABI array");
  }
  return Object.fromEntries(
    Object.entries(artifact).filter(([field]) => FRONTEND_ARTIFACT_FIELDS.has(field)),
  );
}

export async function syncAbi(contractName, { cwd = process.cwd() } = {}) {
  const candidates = [
    path.resolve(cwd, `../artifacts/contracts/${contractName}.sol/${contractName}.json`), // hardhat
    path.resolve(cwd, `../out/${contractName}.sol/${contractName}.json`), // foundry flat
    path.resolve(cwd, `../contracts/out/${contractName}.sol/${contractName}.json`), // alternate
  ];

  let src = null;
  for (const c of candidates) {
    if (await fileExists(c)) {
      src = c;
      break;
    }
  }

  const dest = path.resolve(cwd, `src/abi/${contractName}.json`);

  if (!src) {
    console.warn(
      `[sync-abi] ${contractName}.json not found in artifacts, keeping existing ABI as fallback. Searched paths:`,
    );
    candidates.forEach((c) => console.warn("  -", c));
    return;
  }

  const artifact = normalizeFrontendArtifact(JSON.parse(await fs.readFile(src, "utf8")));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log("[sync-abi] ABI synced ->", path.relative(cwd, dest));
}

export async function main() {
  for (const contractName of [
    "DeepFamily",
    "DeepFamilyArchive",
    "DeepFamilyReader",
    "DeepFamilyLineageIndex",
    "ShieldedErc20Pool",
    "ShieldedNativePool",
    "ShieldedPoolFactory",
    "EligibilitySource",
    "ReceiveRegistry",
    "LetterArchive",
  ]) {
    await syncAbi(contractName);
  }
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((e) => {
    console.error("[sync-abi] Failed:", e);
    process.exitCode = 1;
  });
}
