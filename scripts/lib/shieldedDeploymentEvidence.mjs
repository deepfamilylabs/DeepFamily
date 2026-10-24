import { getAddress } from "ethers";
import { SHIELDED_DEPLOYMENT_CIRCUITS, RECEIVE_DEPLOYMENT_CONTRACTS, RECEIVE_DEPLOYMENT_IMMUTABLES } from "./zkDeploymentCatalog.mjs";
import {
  GROTH16_ADAPTER_VERIFIER_BINDINGS,
  shieldedDeploymentBindingsFromAddresses,
} from "./protocolReleaseManifest.mjs";

export function shieldedDeploymentBindings(addresses) {
  return shieldedDeploymentBindingsFromAddresses(
    Object.fromEntries(
      [
        "token",
        "deepFamily",
        "poseidonT3",
        "poseidonT4",
        "poseidonT6",
        "deepFamilyLineageIndex",
        "groth16VerifierAdapter",
        "shieldedErc20Pool",
        "shieldedNativePool",
        "shieldedPoolFactory",
        ...Object.values(SHIELDED_DEPLOYMENT_CIRCUITS).map((spec) => spec.verifierLabel),
        ...RECEIVE_DEPLOYMENT_CONTRACTS.map(({property}) => property),
      ].map((name) => [name, getAddress(addresses[name])]),
    ),
  );
}

/** Reads every deployed immutable; an adapter or lineage index from another pool fails before proofs. */
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
    const verifier = await read(`adapter ${getter}`, () => adapter[getter]());
    same(verifier, addresses[label], `adapter ${getter}`);
    // The canonical purpose lookup exposes defaults; variants route by signal width
    // (VALUE), Fund mode or proof verification (Claim32), with their own immutable getter.
    if (purpose < 7) {
      const routedVerifier = await read(`adapter proof purpose ${purpose}`, () => adapter.verifierForPurpose(purpose));
      same(routedVerifier, addresses[label], `adapter proof purpose ${purpose}`);
    }
  }
  for (const [pool, key, kind] of [
    [deployed.shieldedErc20Pool, "shieldedErc20Pool", 0n],
    [deployed.shieldedNativePool, "shieldedNativePool", 1n],
  ]) {
    for (const [method, expected] of [
      ["LINEAGE_INDEX", bindings.deepFamilyLineageIndex],
      ["VERIFIER", bindings[key].verifierAdapterImmutable],
      ["AUTHORIZATION_STATE", bindings[key].authorizationStateImmutable],
      ["RECEIVE_VERIFIER", bindings[key].receiveVerifierImmutable],
    ])
      same(await read(`${key} ${method}`, () => pool[method]()), expected, `${key} ${method}`);
    if (
      BigInt(await read(`${key} assetKind`, () => pool.assetKind())) !== kind ||
      BigInt(await read(`${key} protocolVersion`, () => pool.protocolVersion())) !== 1n
    )
      throw new Error(`${key} asset kind/protocol version differs from the integrated deployment`);
  }
  same(
    await read("pool TOKEN", () => deployed.shieldedErc20Pool.TOKEN()),
    bindings.token,
    "pool TOKEN",
  );
  const factory = deployed.shieldedPoolFactory;
  for (const [method, expected] of [
    ["DEEP_TOKEN", bindings.token],
    ["LINEAGE_INDEX", bindings.deepFamilyLineageIndex],
    ["VERIFIER", bindings.shieldedPoolFactory.verifierAdapterImmutable],
    ["NATIVE_POOL", bindings.shieldedNativePool.address],
    ["AUTHORIZATION_STATE", bindings.shieldedPoolFactory.authorizationStateImmutable],
    ["RECEIVE_VERIFIER", bindings.shieldedPoolFactory.receiveVerifierImmutable],
  ])
    same(await read(`factory ${method}`, () => factory[method]()), expected, `factory ${method}`);
  same(
    await read("factory DEEP pool", () => factory.poolFor(bindings.token)),
    bindings.shieldedErc20Pool.address,
    "factory DEEP pool",
  );
  same(
    await read("factory native pool", () =>
      factory.poolFor("0x0000000000000000000000000000000000000000"),
    ),
    bindings.shieldedNativePool.address,
    "factory native pool",
  );
  same(
    await read("lineage family", () => deployed.lineageIndex.DEEP_FAMILY()),
    addresses.deepFamily,
    "lineage family",
  );
  for (const {property} of RECEIVE_DEPLOYMENT_CONTRACTS) {
    for (const [getter, expectedKey] of Object.entries(RECEIVE_DEPLOYMENT_IMMUTABLES[property])) {
      same(await read(`${property} ${getter}`, () => deployed[property][getter]()), addresses[expectedKey], `${property} ${getter}`);
    }
  }
  same(
    await read("family lineage", () => deployed.deepFamily.lineageIndex()),
    bindings.deepFamilyLineageIndex,
    "family lineage",
  );
  return bindings;
}

export function shieldedArtifactEntries(bindings, artifacts) {
  return [
    ...RECEIVE_DEPLOYMENT_CONTRACTS.map(({contractName, property}) => [contractName, bindings[property], artifacts[property]]),
    ...Object.entries(SHIELDED_DEPLOYMENT_CIRCUITS).map(([action, spec]) => [
      spec.verifierContractName,
      bindings.shieldedVerifiers[action],
      artifacts.shieldedVerifiers[action],
    ]),
    ["ShieldedErc20Pool", bindings.shieldedErc20Pool, artifacts.shieldedErc20Pool],
    ["ShieldedNativePool", bindings.shieldedNativePool, artifacts.shieldedNativePool],
    ["ShieldedPoolFactory", bindings.shieldedPoolFactory, artifacts.shieldedPoolFactory],
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
  for (const key of ["shieldedErc20Pool", "shieldedNativePool", "shieldedPoolFactory"])
    Object.assign(evidence[key], hashes(artifacts[key]));
  for (const {property} of RECEIVE_DEPLOYMENT_CONTRACTS) Object.assign(evidence[property], hashes(artifacts[property]));
  delete evidence.token;
  return evidence;
}
