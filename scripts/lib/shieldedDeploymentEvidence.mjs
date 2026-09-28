import { getAddress } from "ethers";
import { SHIELDED_ACTIONS, SHIELDED_DEPLOYMENT_CIRCUITS } from "./zkDeploymentCatalog.mjs";
import { SHIELDED_POOL_VERIFIER_IMMUTABLES } from "./protocolReleaseManifest.mjs";

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
    shieldedAdapters: Object.fromEntries(
      SHIELDED_ACTIONS.map((action) => {
        const spec = SHIELDED_DEPLOYMENT_CIRCUITS[action];
        return [
          action,
          {
            address: address(spec.adapterLabel),
            verifierImmutable: address(spec.verifierLabel),
            actionId: spec.actionId,
          },
        ];
      }),
    ),
    shieldedHeirKeyRegistry: {
      address: address("shieldedHeirKeyRegistry"),
      lineageIndexImmutable: address("deepFamilyLineageIndex"),
      keyRegistrationVerifierImmutable: address("shieldedKeyRegistrationVerifier"),
    },
    shieldedDeepPool: {
      address: address("shieldedDeepPool"),
      tokenImmutable: address("token"),
      lineageIndexImmutable: address("deepFamilyLineageIndex"),
      keyRegistryImmutable: address("shieldedHeirKeyRegistry"),
      adapterImmutables: Object.fromEntries(
        SHIELDED_ACTIONS.map((action) => [
          action,
          address(SHIELDED_DEPLOYMENT_CIRCUITS[action].adapterLabel),
        ]),
      ),
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
  for (const action of SHIELDED_ACTIONS) {
    const adapter = deployed.shieldedAdapters[action];
    const [verifier, actionId] = await Promise.all([
      read(`${action} adapter verifier`, () => adapter.VERIFIER()),
      read(`${action} adapter action`, () => adapter.ACTION()),
    ]);
    same(
      verifier,
      bindings.shieldedAdapters[action].verifierImmutable,
      `${action} adapter verifier`,
    );
    if (BigInt(actionId) !== BigInt(bindings.shieldedAdapters[action].actionId))
      throw new Error(`${action} adapter has the wrong action ID`);
  }
  const registry = deployed.shieldedHeirKeyRegistry;
  same(
    await read("registry lineage", () => registry.LINEAGE_INDEX()),
    bindings.deepFamilyLineageIndex,
    "registry lineage",
  );
  same(
    await read("registry verifier", () => registry.VERIFIER()),
    bindings.shieldedHeirKeyRegistry.keyRegistrationVerifierImmutable,
    "registry verifier",
  );
  const pool = deployed.shieldedDeepPool;
  for (const [method, expected] of [
    ["TOKEN", bindings.token],
    ["LINEAGE_INDEX", bindings.deepFamilyLineageIndex],
    ["KEY_REGISTRY", bindings.shieldedHeirKeyRegistry.address],
    ...SHIELDED_ACTIONS.map((action) => [
      SHIELDED_POOL_VERIFIER_IMMUTABLES[action],
      bindings.shieldedDeepPool.adapterImmutables[action],
    ]),
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
    ...SHIELDED_ACTIONS.map((action) => [
      SHIELDED_DEPLOYMENT_CIRCUITS[action].adapterDeploymentName,
      bindings.shieldedAdapters[action],
      artifacts.shieldedAdapters[action],
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
  for (const action of SHIELDED_ACTIONS)
    Object.assign(evidence.shieldedAdapters[action], hashes(artifacts.shieldedAdapters[action]));
  Object.assign(evidence.shieldedHeirKeyRegistry, hashes(artifacts.shieldedHeirKeyRegistry));
  Object.assign(evidence.shieldedDeepPool, hashes(artifacts.shieldedDeepPool));
  delete evidence.token;
  return evidence;
}
