import { getAddress, ZeroAddress } from "ethers";

/** Check the canonical pool routes and their live qualification source before writing local settings. */
export async function validateReceiveDeployment({ deepFamily, pool, nativePool, factory, letters, registry, source }) {
  const [familyAddress, poolAddress, nativeAddress, registryAddress, sourceAddress,
    token, familyLineage, activeSource, poolToken, factoryToken, factoryNative,
    registeredToken, registeredNative, registrySource, sourceFamily, sourceLineage, letterRegistry] = await Promise.all([
    deepFamily.getAddress(), pool.getAddress(), nativePool.getAddress(), registry.getAddress(), source.getAddress(),
    deepFamily.DEEP_FAMILY_TOKEN_CONTRACT(), deepFamily.lineageIndex(), deepFamily.eligibilitySource(), pool.TOKEN(),
    factory.DEEP_TOKEN(), factory.NATIVE_POOL(), factory.poolFor(await deepFamily.DEEP_FAMILY_TOKEN_CONTRACT()),
    factory.poolFor(ZeroAddress), registry.SOURCE(), source.DEEP_FAMILY(), source.LINEAGE_INDEX(), letters.RECEIVE_REGISTRY(),
  ]);
  const same = (a, b) => getAddress(a) === getAddress(b);
  if (!same(token, poolToken) || !same(token, factoryToken) || !same(factoryNative, nativeAddress) ||
      !same(registeredToken, poolAddress) || !same(registeredNative, nativeAddress) ||
      !same(activeSource, sourceAddress) || !same(registrySource, sourceAddress) ||
      !same(sourceFamily, familyAddress) || !same(sourceLineage, familyLineage) || !same(letterRegistry, registryAddress)) {
    throw new Error("Local receiving deployment has inconsistent pool, registry or qualification source bindings");
  }
  const routes = ["VERIFIER", "FUND_VERIFIER", "CLAIM_VERIFIER", "TRANSFER_VERIFIER"];
  const expected = await Promise.all(routes.map(name => factory[name]()));
  const configurations = await Promise.all([pool, nativePool].map(async item => {
    const values = await Promise.all([item.protocolVersion(), item.assetKind(), item.RECEIVE_REGISTRY(), ...routes.map(name => item[name]())]);
    return { version: BigInt(values[0]), kind: BigInt(values[1]), registry: values[2], verifiers: values.slice(3) };
  }));
  if (configurations.some((item, index) => item.version !== 1n || item.kind !== BigInt(index) ||
      !same(item.registry, registryAddress) || item.verifiers.some((value, i) => !same(value, expected[i])))) {
    throw new Error("Local receiving pools do not use the canonical protocol and verification routes");
  }
  return { registryAddress: getAddress(registryAddress) };
}
