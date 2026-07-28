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

export function normalizeFrontendArtifact(artifact) {
  if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("Contract artifact must be a JSON object");
  }
  // Hardhat's buildInfoId changes when any source in the shared compiler input changes, even when
  // this contract's ABI and bytecode are identical. It is release evidence for root artifacts, but
  // frontend runtime code neither uses nor verifies it, so copying it makes clean builds dirty.
  const { buildInfoId: _buildInfoId, ...stableArtifact } = artifact;
  return stableArtifact;
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
  for (const contractName of ["DeepFamily", "DeepFamilyReader"]) {
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
