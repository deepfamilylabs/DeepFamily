import fs from "node:fs/promises";
import path from "node:path";

// Keep the stricter Ethereum EIP-170 ceiling so one artifact remains deployable on every
// supported network. Conflux eSpace currently permits up to 49,152 deployed bytes.
const CROSS_CHAIN_MAX_DEPLOYED_BYTES = 24_576;
const MAX_METADATA_DATA_CONTRACT_RUNTIME_BYTES = 16_385;
const ARTIFACTS = [
  ["DeepFamily", "artifacts/contracts/DeepFamily.sol/DeepFamily.json"],
  ["MetadataArchiveV1", "artifacts/contracts/MetadataArchiveV1.sol/MetadataArchiveV1.json"],
  ["MetadataBlobV1", "artifacts/contracts/MetadataArchiveV1.sol/MetadataBlobV1.json"],
  ["DeepFamilyReader", "artifacts/contracts/DeepFamilyReader.sol/DeepFamilyReader.json"],
  ["AdultAgeGate", "artifacts/contracts/libraries/AdultAgeGate.sol/AdultAgeGate.json"],
  ["PoseidonT5", "artifacts/poseidon-solidity/PoseidonT5.sol/PoseidonT5.json"],
  ["DeepFamilyToken", "artifacts/contracts/DeepFamilyToken.sol/DeepFamilyToken.json"],
  [
    "GovernanceTimelock",
    "artifacts/contracts/governance/GovernanceTimelock.sol/GovernanceTimelock.json",
  ],
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
  const dataContractStatus =
    MAX_METADATA_DATA_CONTRACT_RUNTIME_BYTES <= CROSS_CHAIN_MAX_DEPLOYED_BYTES
      ? "ok"
      : "oversize";
  console.log(
    `${dataContractStatus.padEnd(8)} ${"Metadata data-contract (maximum)".padEnd(34)} ` +
      `${String(MAX_METADATA_DATA_CONTRACT_RUNTIME_BYTES).padStart(6)} bytes`,
  );
  if (dataContractStatus !== "ok") failed = true;
  for (const [name, relativePath] of ARTIFACTS) {
    const artifactPath = path.resolve(process.cwd(), relativePath);
    const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
    const bytes = getDeployedBytecodeSize(artifact);
    const status = bytes <= CROSS_CHAIN_MAX_DEPLOYED_BYTES ? "ok" : "oversize";
    console.log(`${status.padEnd(8)} ${name.padEnd(34)} ${String(bytes).padStart(6)} bytes`);
    if (bytes > CROSS_CHAIN_MAX_DEPLOYED_BYTES) failed = true;
  }

  if (failed) {
    throw new Error(
      `One or more deployable artifacts exceed the ${CROSS_CHAIN_MAX_DEPLOYED_BYTES}-byte cross-chain compatibility limit`,
    );
  }
}

main().catch((error) => {
  console.error(`[contract-size] ${error.message}`);
  process.exitCode = 1;
});
