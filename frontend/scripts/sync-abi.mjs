import { promises as fs } from "fs";
import path from "path";

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function syncAbi(contractName) {
  const cwd = process.cwd(); // frontend/
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

  const buf = await fs.readFile(src);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  console.log("[sync-abi] ABI synced ->", path.relative(cwd, dest));
}

async function main() {
  for (const contractName of ["DeepFamily", "DeepFamilyReader"]) {
    await syncAbi(contractName);
  }
}

main().catch((e) => {
  console.error("[sync-abi] Failed:", e);
  process.exit(1);
});
