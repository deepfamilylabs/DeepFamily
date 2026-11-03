import fs from "node:fs/promises";
import path from "node:path";
import { SHIELDED_DEPLOYMENT_CIRCUITS, RECEIVE_DEPLOYMENT_CONTRACTS } from "./lib/zkDeploymentCatalog.mjs";
import { contractArtifact, contractSource } from "../lib/contractSources.js";

// Keep the stricter Ethereum EIP-170 ceiling so one artifact remains deployable on every
// supported network. Conflux eSpace currently permits up to 49,152 deployed bytes.
const CROSS_CHAIN_MAX_DEPLOYED_BYTES = 24_576;
const MAX_SEGMENT_RUNTIME_BYTES = 16_385;
const MAX_MANIFEST_RUNTIME_BYTES = 20_566;
// `declaredIn` names the registered contract whose source file declares `contractName`.
const artifactOf = (contractName, declaredIn = contractName) => [
  contractName,
  contractArtifact(contractSource(declaredIn), contractName),
];
const ARTIFACTS = [
  ...RECEIVE_DEPLOYMENT_CONTRACTS.map(({ contractName }) => artifactOf(contractName)),
  ...Object.values(SHIELDED_DEPLOYMENT_CIRCUITS).map(({ verifierContractName }) =>
    artifactOf(verifierContractName),
  ),
  artifactOf("DeepFamily"),
  artifactOf("DeepFamilyArchive"),
  artifactOf("ArchiveData", "DeepFamilyArchive"),
  artifactOf("DeepFamilyReader"),
  artifactOf("AdultAgeGate"),
  ["PoseidonT3", "artifacts/poseidon-solidity/PoseidonT3.sol/PoseidonT3.json"],
  ["PoseidonT4", "artifacts/poseidon-solidity/PoseidonT4.sol/PoseidonT4.json"],
  ["PoseidonT5", "artifacts/poseidon-solidity/PoseidonT5.sol/PoseidonT5.json"],
  ["PoseidonT6", "artifacts/poseidon-solidity/PoseidonT6.sol/PoseidonT6.json"],
  artifactOf("DeepFamilyLineageIndex"),
  artifactOf("ShieldedErc20Pool"),
  artifactOf("ShieldedNativePool"),
  artifactOf("ShieldedPoolFactory"),
  artifactOf("DeepFamilyToken"),
  artifactOf("GovernanceTimelock"),
  artifactOf("Groth16VerifierAdapter"),
  artifactOf("PersonCommitmentVerifier"),
  artifactOf("DisclosureBindingVerifier"),
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
  const dataContractMaximums = [
    ["Archive segment (maximum)", MAX_SEGMENT_RUNTIME_BYTES],
    ["Archive manifest page (maximum)", MAX_MANIFEST_RUNTIME_BYTES],
  ];
  for (const [name, bytes] of dataContractMaximums) {
    const status = bytes <= CROSS_CHAIN_MAX_DEPLOYED_BYTES ? "ok" : "oversize";
    console.log(`${status.padEnd(8)} ${name.padEnd(34)} ${String(bytes).padStart(6)} bytes`);
    if (status !== "ok") failed = true;
  }
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
