import { SHIELDED_CIRCUITS } from "./zkCircuitSelection.mjs";

export const SHIELDED_ACTIONS = Object.freeze([
  "shield",
  "createPolicy",
  "allocate",
  "topUp",
  "mergeBudget",
  "claim",
  "privateTransfer",
  "unshield",
]);

/** The same circuit contracts and action order are deployed in every environment. */
export const SHIELDED_DEPLOYMENT_CIRCUITS = Object.freeze(
  Object.fromEntries(
    Object.entries(SHIELDED_CIRCUITS).map(([action, source]) => {
      const suffix = action[0].toUpperCase() + action.slice(1);
      return [
        action,
        Object.freeze({
          action,
          source,
          verifierContractName: `Shielded${suffix}Verifier`,
          verifierLabel: `shielded${suffix}Verifier`,
          actionId: action === "keyRegistration" ? null : SHIELDED_ACTIONS.indexOf(action),
          proofPurpose: action === "keyRegistration" ? 2 : 3 + SHIELDED_ACTIONS.indexOf(action),
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
    ["ShieldedHeirKeyRegistry", "shieldedHeirKeyRegistry", "shieldedHeirKeyRegistry"],
    ["ShieldedDeepPool", "shieldedDeepPool", "shieldedDeepPool"],
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
      record.transactionLabel === "deepFamilyProxy"
        ? "deepFamily"
        : record.transactionLabel === "deepFamilyToken"
          ? "token"
          : record.transactionLabel;
    addresses[key] = await contract.getAddress();
  }
  addresses.deepFamilyImplementation = deployed.deepFamilyImplementationAddress;
  return addresses;
}
