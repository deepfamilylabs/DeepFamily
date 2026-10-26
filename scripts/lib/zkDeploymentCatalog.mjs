import { SHIELDED_CIRCUITS } from "./zkCircuitSelection.mjs";
import { PROTOCOL_CIRCUITS } from "./protocolCircuitCatalog.mjs";

/** Existing VALUE relations are the sole asset-boundary routes. */
export const SHIELDED_ACTIONS = Object.freeze(["shield", "unshield"]);
export const SHIELDED_ACTION_PROOF_PURPOSE_BASE = 2;
export const SHIELDED_DEPLOYMENT_CIRCUITS = Object.freeze(
  Object.fromEntries(
    [
      ["shield", "Shield", 0, 7],
      ["unshield", "Unshield", 4, 11],
      ["unshield4", "Unshield4", 4, 20],
    ].map(([action, suffix, actionId, publicSignals]) => [
      action,
      Object.freeze({
        action,
        source: SHIELDED_CIRCUITS[action],
        verifierContractName: `Shielded${suffix}Verifier`,
        verifierLabel: `shielded${suffix}Verifier`,
        actionId,
        publicSignals,
        proofPurpose: SHIELDED_ACTION_PROOF_PURPOSE_BASE + actionId,
        adapterVerifierGetter: `${action}Verifier`,
      }),
    ]),
  ),
);

export const PROTOCOL_DEPLOYMENT_CIRCUITS = Object.freeze(
  Object.fromEntries(
    Object.entries(PROTOCOL_CIRCUITS).map(([action, spec]) => [
      action,
      Object.freeze({
        ...spec,
        action,
        generatedLabel: `protocol${action[0].toUpperCase() + action.slice(1)}Groth16Verifier`,
        adapterLabel: `protocol${action[0].toUpperCase() + action.slice(1)}Verifier`,
      }),
    ]),
  ),
);

/** There is one receive protocol: authenticated eligibility source, registry and letters. */
export const RECEIVE_DEPLOYMENT_CONTRACTS = Object.freeze(
  [
    ["EligibilitySource", "eligibilitySource"],
    ["ReceiveRegistry", "receiveRegistry"],
    ["LetterArchive", "letterArchive"],
  ].map(([contractName, property]) => Object.freeze({ contractName, property })),
);
export const receiveDeploymentConstructorArgs = (property, a) => {
  switch (property) {
    case "eligibilitySource":
      return [a.lineageIndex, a.protocolSourceFactVerifier, a.protocolSourceTrustVerifier];
    case "receiveRegistry":
      return [
        a.eligibilitySource,
        a.protocolIssueVerifier,
        a.protocolCodeVerifier,
        a.protocolCapabilityVerifier,
      ];
    case "letterArchive":
      return [a.deepFamily, a.receiveRegistry];
    default:
      throw new Error(`Unknown protocol deployment ${property}`);
  }
};
export const receiveDeploymentLibraries = (property, a) =>
  property === "eligibilitySource"
    ? { PoseidonT3: a.poseidonT3 }
    : property === "receiveRegistry"
      ? { PoseidonT3: a.poseidonT3 }
      : {};
export const RECEIVE_DEPLOYMENT_IMMUTABLES = Object.freeze({
  eligibilitySource: {
    LINEAGE_INDEX: "lineageIndex",
    DEEP_FAMILY: "deepFamily",
    FACT_VERIFIER: "protocolSourceFactVerifier",
    TRUST_VERIFIER: "protocolSourceTrustVerifier",
  },
  receiveRegistry: {
    SOURCE: "eligibilitySource",
    ISSUE_VERIFIER: "protocolIssueVerifier",
    CODE_VERIFIER: "protocolCodeVerifier",
    CAPABILITY_VERIFIER: "protocolCapabilityVerifier",
  },
  letterArchive: {
    DEEP_FAMILY: "deepFamily",
    RECEIVE_REGISTRY: "receiveRegistry",
  },
});

export const INTEGRATED_DEPLOYMENT_RECORDS = Object.freeze(
  [
    ["DeepFamilyToken", "token", "deepFamilyToken"],
    ["PoseidonT5", "poseidonT5", "poseidonT5"],
    ["AdultAgeGate", "adultAgeGate", "adultAgeGate"],
    ["PersonCommitmentVerifier", "personCommitmentVerifier", "personCommitmentVerifier"],
    ["DisclosureBindingVerifier", "nameDisclosureVerifier", "disclosureBindingVerifier"],
    ["Groth16VerifierAdapter", "groth16VerifierAdapter", "groth16VerifierAdapter"],
    ...Object.values(SHIELDED_DEPLOYMENT_CIRCUITS).map((s) => [
      s.verifierContractName,
      `shieldedVerifiers.${s.action}`,
      s.verifierLabel,
    ]),
    [
      "ShieldedBoundaryVerifierAdapter",
      "shieldedBoundaryVerifierAdapter",
      "shieldedBoundaryVerifierAdapter",
    ],
    ...Object.values(PROTOCOL_DEPLOYMENT_CIRCUITS).flatMap((s) => [
      [s.contract, `generatedVerifiers.${s.action}`, s.generatedLabel],
      [
        `Protocol${s.action[0].toUpperCase() + s.action.slice(1)}VerifierAdapter`,
        `protocolVerifiers.${s.action}`,
        s.adapterLabel,
        "FixedGroth16Verifier",
      ],
    ]),
    ["DeepFamily", "deepFamily", "deepFamilyProxy"],
    ["DeepFamilyArchive", "archive", "deepFamilyArchive"],
    ["DeepFamilyReader", "deepFamilyReader", "deepFamilyReader"],
    ["PoseidonT3", "poseidonT3", "poseidonT3"],
    ["PoseidonT4", "poseidonT4", "poseidonT4"],
    ["PoseidonT6", "poseidonT6", "poseidonT6"],
    ["DeepFamilyLineageIndex", "lineageIndex", "deepFamilyLineageIndex"],
    ...RECEIVE_DEPLOYMENT_CONTRACTS.map(({ contractName, property }) => [
      contractName,
      property,
      property,
    ]),
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
