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
 * The same five pool action verifiers and action order are deployed in every environment.
 * The receive-code circuit is verified in the browser and is never deployed.
 */
export const SHIELDED_DEPLOYMENT_CIRCUITS = Object.freeze(
  Object.fromEntries(
    SHIELDED_ACTIONS.map((action, actionId) => {
      const suffix = action[0].toUpperCase() + action.slice(1);
      return [
        action,
        Object.freeze({
          action,
          source: SHIELDED_CIRCUITS[action],
          verifierContractName: `Shielded${suffix}Verifier`,
          verifierLabel: `shielded${suffix}Verifier`,
          actionId,
          proofPurpose: SHIELDED_ACTION_PROOF_PURPOSE_BASE + actionId,
          adapterVerifierGetter: `${action}Verifier`,
        }),
      ];
    }),
  ),
);

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
