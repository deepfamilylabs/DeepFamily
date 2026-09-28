import { getAddress } from "ethers";
import { SHIELDED_DEPLOYMENT_CIRCUITS } from "./zkDeploymentCatalog.mjs";
import { GROTH16_ADAPTER_VERIFIER_BINDINGS } from "./protocolReleaseManifest.mjs";

export function shieldedDeploymentBindings(addresses) {
  const address = (name) => getAddress(addresses[name]);
  return {
    token: address("token"),
    poseidonT3: address("poseidonT3"),
    poseidonT6: address("poseidonT6"),
    deepFamilyLineageIndex: address("deepFamilyLineageIndex"),
    shieldedVerifiers: Object.fromEntries(
      Object.entries(SHIELDED_DEPLOYMENT_CIRCUITS).map(([action, spec]) => [
        action,
        { address: address(spec.verifierLabel) },
      ]),
    ),
    shieldedHeirKeyRegistry: {
      address: address("shieldedHeirKeyRegistry"),
      lineageIndexImmutable: address("deepFamilyLineageIndex"),
      verifierAdapterImmutable: address("groth16VerifierAdapter"),
    },
    shieldedDeepPool: {
      address: address("shieldedDeepPool"),
      tokenImmutable: address("token"),
      lineageIndexImmutable: address("deepFamilyLineageIndex"),
      keyRegistryImmutable: address("shieldedHeirKeyRegistry"),
      verifierAdapterImmutable: address("groth16VerifierAdapter"),
    },
  };
}

/** Reads every deployed immutable; a registry or adapter from another pool fails before proofs. */
export async function assertShieldedDeploymentBindings({
  deployed,
  addresses,
  read = async (_label, operation) => operation(),
}) {
  const bindings = shieldedDeploymentBindings(addresses);
  const same = (actual, expected, label) => {
    if (getAddress(actual) !== getAddress(expected))
      throw new Error(`${label} differs from the integrated deployment`);
  };
  const adapter = deployed.groth16VerifierAdapter;
  for (const [purpose, [getter, label]] of Object.entries(
    GROTH16_ADAPTER_VERIFIER_BINDINGS,
  ).entries()) {
    const [verifier, routedVerifier] = await Promise.all([
      read(`adapter ${getter}`, () => adapter[getter]()),
      read(`adapter proof purpose ${purpose}`, () => adapter.verifierForPurpose(purpose)),
    ]);
    same(verifier, addresses[label], `adapter ${getter}`);
    same(routedVerifier, addresses[label], `adapter proof purpose ${purpose}`);
  }
  const registry = deployed.shieldedHeirKeyRegistry;
  same(
    await read("registry lineage", () => registry.LINEAGE_INDEX()),
    bindings.deepFamilyLineageIndex,
    "registry lineage",
  );
  same(
    await read("registry verifier", () => registry.VERIFIER()),
    bindings.shieldedHeirKeyRegistry.verifierAdapterImmutable,
    "registry verifier",
  );
  const pool = deployed.shieldedDeepPool;
  for (const [method, expected] of [
    ["TOKEN", bindings.token],
    ["LINEAGE_INDEX", bindings.deepFamilyLineageIndex],
    ["KEY_REGISTRY", bindings.shieldedHeirKeyRegistry.address],
    ["VERIFIER", bindings.shieldedDeepPool.verifierAdapterImmutable],
  ])
    same(await read(`pool ${method}`, () => pool[method]()), expected, `pool ${method}`);
  same(
    await read("lineage family", () => deployed.lineageIndex.DEEP_FAMILY()),
    addresses.deepFamily,
    "lineage family",
  );
  same(
    await read("family lineage", () => deployed.deepFamily.lineageIndex()),
    bindings.deepFamilyLineageIndex,
    "family lineage",
  );
  return bindings;
}

export function shieldedArtifactEntries(bindings, artifacts) {
  return [
    ...Object.entries(SHIELDED_DEPLOYMENT_CIRCUITS).map(([action, spec]) => [
      spec.verifierContractName,
      bindings.shieldedVerifiers[action],
      artifacts.shieldedVerifiers[action],
    ]),
    [
      "ShieldedHeirKeyRegistry",
      bindings.shieldedHeirKeyRegistry,
      artifacts.shieldedHeirKeyRegistry,
    ],
    ["ShieldedDeepPool", bindings.shieldedDeepPool, artifacts.shieldedDeepPool],
  ];
}

export function shieldedDeploymentEvidence(bindings, artifacts) {
  const evidence = structuredClone(bindings);
  const hashes = (item) => ({
    artifactSha256: item.artifactSha256,
    runtimeSha256: item.runtimeSha256,
  });
  for (const action of Object.keys(evidence.shieldedVerifiers))
    Object.assign(evidence.shieldedVerifiers[action], hashes(artifacts.shieldedVerifiers[action]));
  Object.assign(evidence.shieldedHeirKeyRegistry, hashes(artifacts.shieldedHeirKeyRegistry));
  Object.assign(evidence.shieldedDeepPool, hashes(artifacts.shieldedDeepPool));
  delete evidence.token;
  return evidence;
}
