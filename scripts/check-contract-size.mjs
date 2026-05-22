import fs from "node:fs/promises";
import path from "node:path";

const MAX_DEPLOYED_BYTES = 24_576;
const ARTIFACTS = [
  ["DeepFamily", "artifacts/contracts/DeepFamily.sol/DeepFamily.json"],
  ["DeepFamilyReader", "artifacts/contracts/DeepFamilyReader.sol/DeepFamilyReader.json"],
  [
    "DeepFamilyAttestationRegistry",
    "artifacts/contracts/DeepFamilyAttestationRegistry.sol/DeepFamilyAttestationRegistry.json",
  ],
  ["AdultAgeGate", "artifacts/contracts/libraries/AdultAgeGate.sol/AdultAgeGate.json"],
  ["PoseidonT5", "artifacts/poseidon-solidity/PoseidonT5.sol/PoseidonT5.json"],
  ["DeepFamilyToken", "artifacts/contracts/DeepFamilyToken.sol/DeepFamilyToken.json"],
  [
    "Groth16VerifierAdapter",
    "artifacts/contracts/adapters/Groth16VerifierAdapter.sol/Groth16VerifierAdapter.json",
  ],
  [
    "PersonCommitmentVerifier",
    "artifacts/contracts/PersonCommitmentVerifier.sol/PersonCommitmentVerifier.json",
  ],
  [
    "DisclosureBindingVerifier",
    "artifacts/contracts/DisclosureBindingVerifier.sol/DisclosureBindingVerifier.json",
  ],
];

function getDeployedBytecodeSize(artifact) {
  const bytecode = String(artifact.deployedBytecode || "");
  if (!bytecode.startsWith("0x")) {
    throw new Error("Artifact deployedBytecode is missing");
  }
  return (bytecode.length - 2) / 2;
}

async function main() {
  let failed = false;
  for (const [name, relativePath] of ARTIFACTS) {
    const artifactPath = path.resolve(process.cwd(), relativePath);
    const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
    const bytes = getDeployedBytecodeSize(artifact);
    const status = bytes <= MAX_DEPLOYED_BYTES ? "ok" : "oversize";
    console.log(`${status.padEnd(8)} ${name.padEnd(34)} ${String(bytes).padStart(6)} bytes`);
    if (bytes > MAX_DEPLOYED_BYTES) failed = true;
  }

  if (failed) {
    throw new Error(`One or more deployable artifacts exceed ${MAX_DEPLOYED_BYTES} bytes`);
  }
}

main().catch((error) => {
  console.error(`[contract-size] ${error.message}`);
  process.exitCode = 1;
});
