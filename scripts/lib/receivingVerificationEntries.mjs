import {
  SHIELDED_DEPLOYMENT_CIRCUITS,
  PROTOCOL_DEPLOYMENT_CIRCUITS,
  RECEIVE_DEPLOYMENT_CONTRACTS,
  receiveDeploymentConstructorArgs,
  receiveDeploymentLibraries,
} from "./zkDeploymentCatalog.mjs";

/** The explorer metadata follows the same only constructor graph as deployment. */
export async function receivingVerificationEntries(artifacts, addresses, verificationEntry) {
  const entries = [];
  for (const spec of Object.values(SHIELDED_DEPLOYMENT_CIRCUITS))
    entries.push(
      await verificationEntry(artifacts, spec.verifierContractName, addresses[spec.verifierLabel]),
    );
  entries.push(
    await verificationEntry(
      artifacts,
      "ShieldedBoundaryVerifierAdapter",
      addresses.shieldedBoundaryVerifierAdapter,
      [
        addresses.shieldedShieldVerifier,
        addresses.shieldedUnshieldVerifier,
        addresses.shieldedUnshield4Verifier,
      ],
    ),
  );
  for (const spec of Object.values(PROTOCOL_DEPLOYMENT_CIRCUITS)) {
    entries.push(await verificationEntry(artifacts, spec.contract, addresses[spec.generatedLabel]));
    entries.push(
      await verificationEntry(artifacts, "FixedGroth16Verifier", addresses[spec.adapterLabel], [
        addresses[spec.generatedLabel],
        spec.publicSignals,
      ]),
    );
  }
  const configured = { ...addresses, lineageIndex: addresses.deepFamilyLineageIndex };
  for (const { contractName, property } of RECEIVE_DEPLOYMENT_CONTRACTS)
    entries.push(
      await verificationEntry(
        artifacts,
        contractName,
        addresses[property],
        receiveDeploymentConstructorArgs(property, configured),
        receiveDeploymentLibraries(property, configured),
      ),
    );
  const common = [
    addresses.shieldedBoundaryVerifierAdapter,
    addresses.receiveRegistry,
    addresses.protocolFundVerifier,
    addresses.protocolClaimVerifier,
    addresses.protocolTransferVerifier,
  ];
  const libraries = { PoseidonT3: addresses.poseidonT3 };
  entries.push(
    await verificationEntry(
      artifacts,
      "ShieldedErc20Pool",
      addresses.shieldedErc20Pool,
      [addresses.token, ...common],
      libraries,
    ),
  );
  entries.push(
    await verificationEntry(
      artifacts,
      "ShieldedNativePool",
      addresses.shieldedNativePool,
      common,
      libraries,
    ),
  );
  entries.push(
    await verificationEntry(
      artifacts,
      "ShieldedPoolFactory",
      addresses.shieldedPoolFactory,
      [addresses.token, common[0], addresses.shieldedNativePool, ...common.slice(1)],
      libraries,
    ),
  );
  return entries;
}
