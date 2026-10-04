import { getAddress, ZeroAddress, type Contract, type JsonRpcProvider } from "ethers";
import { SHIELDED_POOL_PROTOCOL_VERSION } from "@deepfamily/protocol-core";
import {
  createDeepTokenContract,
  createShieldedErc20PoolContract,
  createShieldedNativePoolContract,
} from "../../../shared/clients/contractFactory";

export type ShieldedAsset = {
  address: string;
  kind: "erc20" | "native";
  symbol: string;
  decimals: number;
  token: Contract | null;
};

/** Metadata is only display information. The address identifies an asset. */
export async function readShieldedAsset(
  address: string,
  provider: JsonRpcProvider,
  nativeSymbol: string,
): Promise<ShieldedAsset> {
  address = getAddress(address);
  if (address === ZeroAddress) {
    return { address, kind: "native", symbol: nativeSymbol, decimals: 18, token: null };
  }
  if ((await provider.getCode(address)) === "0x")
    throw new Error("Token address has no contract code");
  const token = createDeepTokenContract(address, provider);
  // These calls check basic interoperability, not the token's future transfer behavior.
  const [rawDecimals, , , rawSymbol] = await Promise.all([
    token.decimals() as Promise<bigint>,
    token.balanceOf(ZeroAddress),
    token.allowance(ZeroAddress, ZeroAddress),
    (token.symbol() as Promise<unknown>).catch(() => undefined),
  ]);
  const decimals = Number(rawDecimals);
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("Token decimals must be an integer between 0 and 36");
  }
  const symbol =
    typeof rawSymbol === "string" && /^[\x21-\x7e]{1,32}$/.test(rawSymbol)
      ? rawSymbol
      : `${address.slice(0, 6)}…${address.slice(-4)}`;
  return { address, kind: "erc20", symbol, decimals, token };
}

/** Only accept the selected factory's canonical pool and its fixed protocol bindings. */
export async function resolveShieldedAssetPool(
  factory: Contract,
  asset: ShieldedAsset,
  provider: JsonRpcProvider,
  lineageIndex: string,
): Promise<{ pool: Contract; poolAddress: string; poolDeploymentBlock: number } | null> {
  const [registeredPool, factoryLineage, factoryVerifier] = await Promise.all([
    factory.poolFor(asset.address) as Promise<string>,
    factory.LINEAGE_INDEX() as Promise<string>,
    factory.VERIFIER() as Promise<string>,
  ]);
  if (getAddress(factoryLineage) !== getAddress(lineageIndex)) {
    throw new Error("Asset factory configuration does not match the selected protocol");
  }
  const poolAddress = getAddress(registeredPool);
  if (poolAddress === ZeroAddress) {
    if (asset.kind === "native") throw new Error("Native asset pool is not registered");
    return null;
  }
  const pool =
    asset.kind === "native"
      ? createShieldedNativePoolContract(poolAddress, provider)
      : createShieldedErc20PoolContract(poolAddress, provider);
  const [kind, version, poolLineage, poolVerifier, token, creationBlock] = await Promise.all([
    pool.assetKind() as Promise<bigint>,
    pool.protocolVersion() as Promise<bigint>,
    pool.LINEAGE_INDEX() as Promise<string>,
    pool.VERIFIER() as Promise<string>,
    asset.kind === "erc20" ? (pool.TOKEN() as Promise<string>) : Promise.resolve(ZeroAddress),
    pool.creationBlock() as Promise<bigint>,
  ]);
  if (
    BigInt(kind) !== (asset.kind === "native" ? 1n : 0n) ||
    BigInt(version) !== BigInt(SHIELDED_POOL_PROTOCOL_VERSION) ||
    getAddress(poolLineage) !== getAddress(lineageIndex) ||
    getAddress(factoryLineage) !== getAddress(lineageIndex) ||
    getAddress(poolVerifier) !== getAddress(factoryVerifier) ||
    getAddress(token) !== asset.address
  ) {
    throw new Error("Asset pool configuration does not match the selected protocol");
  }
  const poolDeploymentBlock = Number(creationBlock);
  if (!Number.isSafeInteger(poolDeploymentBlock) || poolDeploymentBlock < 0) {
    throw new Error("Asset pool creation block is invalid");
  }
  return { pool, poolAddress, poolDeploymentBlock };
}
