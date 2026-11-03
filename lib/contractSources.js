// Repository paths of the Solidity sources that scripts compile, size, verify, publish or sync to
// the frontend. Contracts are grouped by architecture layer; generated Groth16 verifiers live
// together because zk:setup rewrites them as one set. Only plain JavaScript is used here because
// the frontend ABI sync imports this file without the root dependencies.

export const VERIFIER_DIRECTORY = "contracts/verifiers";

export const CONTRACT_SOURCES = Object.freeze({
  // Family records, archive storage, lineage checkpoints and the DEEP token.
  DeepFamily: "contracts/family/DeepFamily.sol",
  DeepFamilyArchive: "contracts/family/DeepFamilyArchive.sol",
  DeepFamilyLineageIndex: "contracts/family/DeepFamilyLineageIndex.sol",
  DeepFamilyReader: "contracts/family/DeepFamilyReader.sol",
  DeepFamilyToken: "contracts/family/DeepFamilyToken.sol",
  AdultAgeGate: "contracts/family/AdultAgeGate.sol",
  // Shielded asset pools.
  ShieldedPoolCore: "contracts/shielded/ShieldedPoolCore.sol",
  ShieldedErc20Pool: "contracts/shielded/ShieldedErc20Pool.sol",
  ShieldedNativePool: "contracts/shielded/ShieldedNativePool.sol",
  ShieldedPoolFactory: "contracts/shielded/ShieldedPoolFactory.sol",
  // Receive authorization shared by the pools and letters.
  IdentityAuthorizationState: "contracts/receive/IdentityAuthorizationState.sol",
  ReceivePresentationVerifierRouter: "contracts/receive/ReceivePresentationVerifierRouter.sol",
  // Private letters.
  PrivateLetterArchive: "contracts/letters/PrivateLetterArchive.sol",
  // Proof verification infrastructure.
  Groth16VerifierAdapter: "contracts/adapters/Groth16VerifierAdapter.sol",
  IdentityAuthorizationVerifierAdapter:
    "contracts/adapters/IdentityAuthorizationVerifierAdapter.sol",
  LinkedGroth16Verifier: "contracts/libraries/LinkedGroth16Verifier.sol",
  GovernanceTimelock: "contracts/governance/GovernanceTimelock.sol",
  UUPSProxy: "contracts/proxy/UUPSProxy.sol",
});

/** Source of a generated Groth16 verifier, named after its contract. */
export function verifierSource(contractName) {
  return `${VERIFIER_DIRECTORY}/${contractName}.sol`;
}

/**
 * Source of any deployable contract. Handwritten ones are registered above; every other name
 * ending in `Verifier` is a generated `<Circuit>Verifier`. Anything else is a programming error.
 */
export function contractSource(contractName) {
  const source = CONTRACT_SOURCES[contractName];
  if (source) return source;
  if (/Verifier$/.test(contractName)) return verifierSource(contractName);
  throw new Error(`No registered source for contract ${contractName}`);
}

/** Hardhat artifact of `contractName` declared in `source`. */
export function contractArtifact(source, contractName) {
  return `artifacts/${source}/${contractName}.json`;
}
