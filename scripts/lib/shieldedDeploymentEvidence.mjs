import { getAddress } from "ethers";
import { SHIELDED_DEPLOYMENT_CIRCUITS, PROTOCOL_DEPLOYMENT_CIRCUITS, RECEIVE_DEPLOYMENT_CONTRACTS, RECEIVE_DEPLOYMENT_IMMUTABLES } from "./zkDeploymentCatalog.mjs";
import { GROTH16_ADAPTER_VERIFIER_BINDINGS, shieldedDeploymentBindingsFromAddresses } from "./protocolReleaseManifest.mjs";

export function shieldedDeploymentBindings(addresses) {
  return shieldedDeploymentBindingsFromAddresses(addresses);
}

/** Verify the same immutable graph used by the only integrated deployment. */
export async function assertShieldedDeploymentBindings({ deployed, addresses, read = async (_label, operation) => operation() }) {
  const bindings = shieldedDeploymentBindings(addresses);
  const same = (actual, expected, label) => {
    if (getAddress(actual) !== getAddress(expected)) throw new Error(`${label} differs from the integrated deployment`);
  };
  for (const [getter, label] of Object.entries(GROTH16_ADAPTER_VERIFIER_BINDINGS))
    same(await read(`identity adapter ${getter}`, () => deployed.groth16VerifierAdapter[getter]()), addresses[label], `identity adapter ${getter}`);
  for (const [action, spec] of Object.entries(SHIELDED_DEPLOYMENT_CIRCUITS))
    same(await read(`boundary ${action}`, () => deployed.shieldedBoundaryVerifierAdapter[`${action}Verifier`]()), addresses[spec.verifierLabel], `boundary ${action}`);
  for (const [action, spec] of Object.entries(PROTOCOL_DEPLOYMENT_CIRCUITS)) {
    const adapter = deployed.protocolVerifiers[action];
    same(await read(`${action} verifier`, () => adapter.VERIFIER()), addresses[spec.generatedLabel], `${action} verifier`);
    if (BigInt(await read(`${action} arity`, () => adapter.PUBLIC_SIGNAL_COUNT())) !== BigInt(spec.publicSignals))
      throw new Error(`${action} public ABI differs from the integrated deployment`);
  }
  const common = {
    VERIFIER: addresses.shieldedBoundaryVerifierAdapter,
    RECEIVE_REGISTRY: addresses.receiveRegistry,
    FUND_VERIFIER: addresses.protocolFundVerifier,
    CLAIM_VERIFIER: addresses.protocolClaimVerifier,
    TRANSFER_VERIFIER: addresses.protocolTransferVerifier,
  };
  for (const [pool, key, kind] of [[deployed.shieldedErc20Pool, "shieldedErc20Pool", 0n], [deployed.shieldedNativePool, "shieldedNativePool", 1n]]) {
    for (const [getter, expected] of Object.entries(common))
      same(await read(`${key} ${getter}`, () => pool[getter]()), expected, `${key} ${getter}`);
    if (BigInt(await read(`${key} assetKind`, () => pool.assetKind())) !== kind || BigInt(await read(`${key} protocolVersion`, () => pool.protocolVersion())) !== 1n)
      throw new Error(`${key} asset kind/protocol version differs from the integrated deployment`);
  }
  same(await read("pool TOKEN", () => deployed.shieldedErc20Pool.TOKEN()), bindings.token, "pool TOKEN");
  for (const [getter, expected] of Object.entries({ ...common, DEEP_TOKEN: bindings.token, NATIVE_POOL: bindings.shieldedNativePool.address }))
    same(await read(`factory ${getter}`, () => deployed.shieldedPoolFactory[getter]()), expected, `factory ${getter}`);
  same(await read("factory DEEP pool", () => deployed.shieldedPoolFactory.poolFor(bindings.token)), bindings.shieldedErc20Pool.address, "factory DEEP pool");
  same(await read("factory native pool", () => deployed.shieldedPoolFactory.poolFor("0x0000000000000000000000000000000000000000")), bindings.shieldedNativePool.address, "factory native pool");
  const expectedAddresses = { ...addresses, lineageIndex: addresses.deepFamilyLineageIndex };
  for (const {property} of RECEIVE_DEPLOYMENT_CONTRACTS)
    for (const [getter, key] of Object.entries(RECEIVE_DEPLOYMENT_IMMUTABLES[property]))
      same(await read(`${property} ${getter}`, () => deployed[property][getter]()), expectedAddresses[key], `${property} ${getter}`);
  same(await read("family source", () => deployed.deepFamily.eligibilitySource()), addresses.eligibilitySource, "family source");
  same(await read("family lineage", () => deployed.deepFamily.lineageIndex()), bindings.deepFamilyLineageIndex, "family lineage");
  return bindings;
}

export function shieldedArtifactEntries(bindings, artifacts) {
  return [
    ...RECEIVE_DEPLOYMENT_CONTRACTS.map(({contractName, property}) => [contractName, bindings[property], artifacts[property]]),
    ...Object.entries(SHIELDED_DEPLOYMENT_CIRCUITS).map(([action, spec]) => [spec.verifierContractName, bindings.shieldedVerifiers[action], artifacts.shieldedVerifiers[action]]),
    ...Object.entries(PROTOCOL_DEPLOYMENT_CIRCUITS).flatMap(([action, spec]) => [
      [spec.contract, bindings.generatedVerifiers[action], artifacts.generatedVerifiers[action]],
      ["FixedGroth16Verifier", bindings.protocolVerifiers[action], artifacts.protocolVerifiers[action]],
    ]),
    ["ShieldedBoundaryVerifierAdapter", bindings.shieldedBoundaryVerifierAdapter, artifacts.shieldedBoundaryVerifierAdapter],
    ["ShieldedErc20Pool", bindings.shieldedErc20Pool, artifacts.shieldedErc20Pool],
    ["ShieldedNativePool", bindings.shieldedNativePool, artifacts.shieldedNativePool],
    ["ShieldedPoolFactory", bindings.shieldedPoolFactory, artifacts.shieldedPoolFactory],
  ];
}
export function shieldedDeploymentEvidence(bindings, artifacts) {
  const evidence = structuredClone(bindings);
  const hashes = item => ({ artifactSha256: item.artifactSha256, runtimeSha256: item.runtimeSha256 });
  for (const kind of ["shieldedVerifiers", "generatedVerifiers", "protocolVerifiers"])
    for (const action of Object.keys(evidence[kind])) Object.assign(evidence[kind][action], hashes(artifacts[kind][action]));
  for (const key of ["shieldedBoundaryVerifierAdapter", "shieldedErc20Pool", "shieldedNativePool", "shieldedPoolFactory", ...RECEIVE_DEPLOYMENT_CONTRACTS.map(spec => spec.property)])
    Object.assign(evidence[key], hashes(artifacts[key]));
  delete evidence.token;
  return evidence;
}
