import { SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS, SHIELDED_VALUE_PUBLIC_SIGNAL_COUNTS } from "@deepfamily/protocol-core";
import { SHIELDED_CIRCUITS } from "./zkCircuitSelection.mjs";

export const SHIELDED_ACTIONS = Object.freeze([
  "shield",
  "fund",
  "claim",
  "privateTransfer",
  "unshield",
]);

/** ProofConstants.sol routes pool actions after person relation (0) and disclosure (1). */
export const SHIELDED_ACTION_PROOF_PURPOSE_BASE = 2;

/**
 * Five pool actions use nine verifier targets: Fund continuation, Claim32 and
 * four-input VALUE variants supplement the default action verifiers.
 * The receive-code circuit is verified in the browser and is never deployed.
 */
export const SHIELDED_DEPLOYMENT_CIRCUITS = Object.freeze(
  Object.fromEntries(
    [...SHIELDED_ACTIONS, "claim32", "privateTransfer4", "unshield4", "fundContinuation"].map((action, index) => {
      const actionId = action === "fundContinuation" ? 1 : action === "claim32" ? 2 : action === "privateTransfer4" ? 3 : action === "unshield4" ? 4 : index;
      const suffix = action === "claim" ? "Claim64" : action[0].toUpperCase() + action.slice(1);
      return [
        action,
        Object.freeze({
          action,
          source: SHIELDED_CIRCUITS[action],
          verifierContractName: `Shielded${suffix}Verifier`,
          verifierLabel: `shielded${suffix}Verifier`,
          actionId,
          publicSignals: action === "privateTransfer4" || action === "unshield4"
            ? SHIELDED_VALUE_PUBLIC_SIGNAL_COUNTS[4]
            : SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[actionId],
          proofPurpose: SHIELDED_ACTION_PROOF_PURPOSE_BASE + actionId,
          adapterVerifierGetter: `${action}Verifier`,
        }),
      ];
    }),
  ),
);

/** Immutable shared receive state and the fixed credential-presentation statements. */
export const RECEIVE_DEPLOYMENT_CONTRACTS = Object.freeze([
  ["ShieldedIdentityAuthorizationUpdateVerifier", "identityAuthorizationUpdateVerifier"],
  ["IdentityAuthorizationVerifierAdapter", "identityAuthorizationVerifierAdapter"],
  ["IdentityAuthorizationState", "identityAuthorizationState"],
  ["AnonymousReceivePresentationVerifier", "anonymousReceivePresentationVerifier"],
  ["FundReceivePresentationVerifier", "fundReceivePresentationVerifier"],
  ["AttachedReceivePresentationVerifier", "attachedReceivePresentationVerifier"],
  ["ReceivePresentationVerifierRouter", "receivePresentationVerifierRouter"],
  ["PrivateLetterArchive", "privateLetterArchive"],
].map(([contractName, property]) => Object.freeze({ contractName, property })));

export const receiveDeploymentConstructorArgs = (property, addresses) => {
  switch (property) {
    case "identityAuthorizationVerifierAdapter": return [addresses.identityAuthorizationUpdateVerifier];
    case "identityAuthorizationState": return [addresses.identityAuthorizationVerifierAdapter];
    case "receivePresentationVerifierRouter": return [addresses.anonymousReceivePresentationVerifier, addresses.fundReceivePresentationVerifier];
    case "privateLetterArchive": return [addresses.deepFamily, addresses.identityAuthorizationState,
      addresses.anonymousReceivePresentationVerifier, addresses.attachedReceivePresentationVerifier,
      addresses.shieldedPoolFactory];
    default: return [];
  }
};

/** Libraries needed to reconstruct and deploy the canonical current-state SMT. */
export const receiveDeploymentLibraries = (property, addresses) =>
  property === "identityAuthorizationState"
    ? { PoseidonT3: addresses.poseidonT3, PoseidonT4: addresses.poseidonT4 }
    : {};

/** Runtime immutables and their canonical deployment address keys. */
export const RECEIVE_DEPLOYMENT_IMMUTABLES = Object.freeze({
  identityAuthorizationUpdateVerifier: {},
  identityAuthorizationVerifierAdapter: { VERIFIER: "identityAuthorizationUpdateVerifier" },
  identityAuthorizationState: { VERIFIER: "identityAuthorizationVerifierAdapter" },
  anonymousReceivePresentationVerifier: {},
  fundReceivePresentationVerifier: {},
  attachedReceivePresentationVerifier: {},
  receivePresentationVerifierRouter: { ANONYMOUS_VERIFIER: "anonymousReceivePresentationVerifier", FUND_VERIFIER: "fundReceivePresentationVerifier" },
  privateLetterArchive: { DEEP_FAMILY: "deepFamily", AUTHORIZATION_STATE: "identityAuthorizationState", LETTER_VERIFIER: "anonymousReceivePresentationVerifier", ATTACHMENT_VERIFIER: "attachedReceivePresentationVerifier", POOL_FACTORY: "shieldedPoolFactory" },
});

export const INTEGRATED_DEPLOYMENT_RECORDS = Object.freeze(
  [
    ["DeepFamilyToken", "token", "deepFamilyToken"],
    ["PoseidonT5", "poseidonT5", "poseidonT5"],
    ["AdultAgeGate", "adultAgeGate", "adultAgeGate"],
    ["PersonCommitmentVerifier", "personCommitmentVerifier", "personCommitmentVerifier"],
    ["DisclosureBindingVerifier", "nameDisclosureVerifier", "disclosureBindingVerifier"],
    ...Object.values(SHIELDED_DEPLOYMENT_CIRCUITS).map((spec) => [
      spec.verifierContractName,
      `shieldedVerifiers.${spec.action}`,
      spec.verifierLabel,
    ]),
    ["Groth16VerifierAdapter", "groth16VerifierAdapter", "groth16VerifierAdapter"],
    ["DeepFamily", "deepFamily", "deepFamilyProxy"],
    ["DeepFamilyArchive", "archive", "deepFamilyArchive"],
    ["DeepFamilyReader", "deepFamilyReader", "deepFamilyReader"],
    ["PoseidonT3", "poseidonT3", "poseidonT3"],
    ["PoseidonT4", "poseidonT4", "poseidonT4"],
    ["PoseidonT6", "poseidonT6", "poseidonT6"],
    ["DeepFamilyLineageIndex", "lineageIndex", "deepFamilyLineageIndex"],
    ...RECEIVE_DEPLOYMENT_CONTRACTS.map(({ contractName, property }) => [contractName, property, property]),
    ["ShieldedNativePool", "shieldedNativePool", "shieldedNativePool"],
    ["ShieldedPoolFactory", "shieldedPoolFactory", "shieldedPoolFactory"],
    ["ShieldedErc20Pool", "shieldedErc20Pool", "shieldedPoolFactory"],
  ].map(([deploymentName, property, transactionLabel, contractName = deploymentName]) =>
    Object.freeze({ deploymentName, property, transactionLabel, contractName }),
  ),
);

export const integratedDeploymentContract = (deployed, property) =>
  property.split(".").reduce((value, key) => value?.[key], deployed);

export async function integratedDeploymentAddresses(deployed) {
  const addresses = {};
  for (const record of INTEGRATED_DEPLOYMENT_RECORDS) {
    const contract = integratedDeploymentContract(deployed, record.property);
    if (!contract?.getAddress)
      throw new Error(`Integrated deployment is missing ${record.deploymentName}`);
    const key =
      record.property === "shieldedErc20Pool"
        ? "shieldedErc20Pool"
        : record.transactionLabel === "deepFamilyProxy"
          ? "deepFamily"
          : record.transactionLabel === "deepFamilyToken"
            ? "token"
            : record.transactionLabel;
    addresses[key] = await contract.getAddress();
  }
  addresses.deepFamilyImplementation = deployed.deepFamilyImplementationAddress;
  return addresses;
}
