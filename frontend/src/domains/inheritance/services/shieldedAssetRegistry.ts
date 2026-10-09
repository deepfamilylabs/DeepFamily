import { getAddress, ZeroAddress, type Contract, type JsonRpcProvider, type Log } from "ethers";
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
  asset: Pick<ShieldedAsset, "address" | "kind">,
  provider: JsonRpcProvider,
  lineageIndex: string,
  options: { blockTag?: number } = {},
): Promise<{ pool: Contract; poolAddress: string; poolDeploymentBlock: number } | null> {
  const overrides = options.blockTag === undefined ? {} : { blockTag: options.blockTag };
  const [registeredPool, factoryLineage, factoryVerifier] = await Promise.all([
    factory.poolFor(asset.address, overrides) as Promise<string>,
    factory.LINEAGE_INDEX(overrides) as Promise<string>,
    factory.VERIFIER(overrides) as Promise<string>,
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
    pool.assetKind(overrides) as Promise<bigint>,
    pool.protocolVersion(overrides) as Promise<bigint>,
    pool.LINEAGE_INDEX(overrides) as Promise<string>,
    pool.VERIFIER(overrides) as Promise<string>,
    asset.kind === "erc20"
      ? (pool.TOKEN(overrides) as Promise<string>)
      : Promise.resolve(ZeroAddress),
    pool.creationBlock(overrides) as Promise<bigint>,
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

export type RecoveredShieldedAsset = Omit<ShieldedAsset, "decimals"> & {
  /** Null means show integer base units, never guess token precision. */
  decimals: number | null;
  metadataAvailable: boolean;
  interoperabilityAvailable: boolean;
};

export async function withShieldedRecoveryTimeout<T>(
  task: Promise<T>,
  timeoutMs = 10_000,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new Error("Invalid shielded recovery timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Shielded recovery request timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Recovery metadata never decides whether protocol note history can be verified. */
export async function readRecoveredShieldedAsset(
  address: string,
  provider: JsonRpcProvider,
  nativeSymbol: string,
  options: { blockTag: number; timeoutMs?: number },
): Promise<RecoveredShieldedAsset> {
  address = getAddress(address);
  if (address === ZeroAddress)
    return {
      address,
      kind: "native",
      symbol: nativeSymbol,
      decimals: 18,
      token: null,
      metadataAvailable: true,
      interoperabilityAvailable: true,
    };
  const token = createDeepTokenContract(address, provider);
  const overrides = { blockTag: options.blockTag };
  const settled = await Promise.allSettled([
    withShieldedRecoveryTimeout(
      Promise.resolve().then(() => token.decimals(overrides)),
      options.timeoutMs,
    ),
    withShieldedRecoveryTimeout(
      Promise.resolve().then(() => token.symbol(overrides)),
      options.timeoutMs,
    ),
    withShieldedRecoveryTimeout(
      Promise.resolve().then(() => token.balanceOf(ZeroAddress, overrides)),
      options.timeoutMs,
    ),
    withShieldedRecoveryTimeout(
      Promise.resolve().then(() => token.allowance(ZeroAddress, ZeroAddress, overrides)),
      options.timeoutMs,
    ),
  ]);
  const rawPrecision = settled[0].status === "fulfilled" ? settled[0].value : undefined;
  const precision =
    typeof rawPrecision === "bigint" && rawPrecision >= 0n && rawPrecision <= 36n
      ? Number(rawPrecision)
      : NaN;
  const decimals =
    Number.isSafeInteger(precision) && precision >= 0 && precision <= 36 ? precision : null;
  const rawSymbol = settled[1].status === "fulfilled" ? settled[1].value : undefined;
  const symbol =
    typeof rawSymbol === "string" && /^[\x21-\x7e]{1,32}$/.test(rawSymbol)
      ? rawSymbol
      : `${address.slice(0, 6)}…${address.slice(-4)}`;
  const isUint = (result: PromiseSettledResult<unknown>) =>
    result.status === "fulfilled" &&
    typeof result.value === "bigint" &&
    result.value >= 0n &&
    result.value < 1n << 256n;
  return {
    address,
    kind: "erc20",
    symbol,
    decimals,
    token,
    metadataAvailable: decimals !== null,
    interoperabilityAvailable: isUint(settled[2]) && isUint(settled[3]),
  };
}

export type DiscoveredShieldedPool = {
  assetAddress: string;
  poolAddress: string;
  creationEventBlock: number;
  pool?: Contract;
  poolDeploymentBlock?: number;
  asset?: RecoveredShieldedAsset;
  configurationVerified: boolean;
  error?: string;
};

export type ShieldedFactoryDiscovery = {
  chainId: bigint;
  toBlock: number;
  blockHash: string;
  expectedPoolCount?: bigint;
  enumerationComplete: boolean;
  enumerationError?: string;
  pools: DiscoveredShieldedPool[];
};

/** Replay the complete factory range, including pools created after a root backup. */
export async function discoverShieldedFactoryPools(
  factory: Contract,
  provider: JsonRpcProvider,
  options: {
    factoryDeploymentBlock: number;
    lineageIndexAddress: string;
    verifierAddress: string;
    chainId?: bigint;
    toBlock?: number;
    blockChunk?: number;
    timeoutMs?: number;
    nativeSymbol?: string;
  },
): Promise<ShieldedFactoryDiscovery> {
  const bounded = <T>(task: Promise<T>) => withShieldedRecoveryTimeout(task, options.timeoutMs);
  const chainId = (await bounded(provider.getNetwork())).chainId;
  if (options.chainId !== undefined && chainId !== options.chainId)
    throw new Error("Factory discovery chain mismatch");
  const toBlock = options.toBlock ?? (await bounded(provider.getBlockNumber()));
  const fromBlock = options.factoryDeploymentBlock;
  const blockChunk = options.blockChunk ?? 2_000;
  if (
    !Number.isSafeInteger(toBlock) ||
    !Number.isSafeInteger(fromBlock) ||
    fromBlock < 0 ||
    toBlock < fromBlock ||
    !Number.isSafeInteger(blockChunk) ||
    blockChunk < 1
  )
    throw new Error("Invalid factory discovery block range");
  const anchor = await bounded(provider.getBlock(toBlock));
  if (!anchor?.hash) throw new Error("Factory discovery anchor unavailable");
  const overrides = { blockTag: toBlock };
  const [lineage, verifier] = await Promise.all([
    bounded(factory.LINEAGE_INDEX(overrides) as Promise<string>),
    bounded(factory.VERIFIER(overrides) as Promise<string>),
  ]);
  if (
    getAddress(lineage) !== getAddress(options.lineageIndexAddress) ||
    getAddress(verifier) !== getAddress(options.verifierAddress)
  )
    throw new Error("Factory configuration does not match trusted deployment");
  const event = factory.interface.getEvent("PoolCreated");
  if (!event) throw new Error("Factory ABI is missing PoolCreated");
  const address = await factory.getAddress();
  const discovered = new Map<string, DiscoveredShieldedPool>();
  let enumerationError: string | undefined;
  let expectedPoolCount: bigint | undefined;
  try {
    for (let start = fromBlock; start <= toBlock; start += blockChunk) {
      const logs = await bounded(
        provider.getLogs({
          address,
          topics: [event.topicHash],
          fromBlock: start,
          toBlock: Math.min(toBlock, start + blockChunk - 1),
        }),
      );
      logs.sort((a: Log, b: Log) => a.blockNumber - b.blockNumber || a.index - b.index);
      for (const log of logs) {
        if (
          getAddress(log.address) !== getAddress(address) ||
          log.blockNumber < start ||
          log.blockNumber > Math.min(toBlock, start + blockChunk - 1)
        )
          throw new Error("Factory returned a log outside the requested range");
        const parsed = factory.interface.parseLog(log);
        if (!parsed || parsed.name !== "PoolCreated")
          throw new Error("Invalid factory creation event");
        const assetAddress = getAddress(parsed.args.asset);
        const poolAddress = getAddress(parsed.args.pool);
        if (poolAddress === ZeroAddress) throw new Error("Factory emitted a zero pool address");
        const prior = discovered.get(assetAddress);
        if (prior && prior.poolAddress !== poolAddress)
          throw new Error("Factory asset has conflicting pools");
        if (!prior)
          discovered.set(assetAddress, {
            assetAddress,
            poolAddress,
            creationEventBlock: log.blockNumber,
            configurationVerified: false,
          });
      }
    }
    expectedPoolCount = BigInt(await bounded(factory.poolCount(overrides) as Promise<bigint>));
    if (
      !discovered.has(ZeroAddress) ||
      expectedPoolCount !== BigInt(discovered.size) ||
      new Set([...discovered.values()].map((item) => item.poolAddress)).size !== discovered.size
    )
      throw new Error("Factory pool enumeration is incomplete");
  } catch {
    enumerationError = "Factory pool enumeration could not be verified";
  }
  const pools = await Promise.all(
    [...discovered.values()].map(async (item): Promise<DiscoveredShieldedPool> => {
      try {
        const kind = item.assetAddress === ZeroAddress ? "native" : "erc20";
        const resolved = await bounded(
          resolveShieldedAssetPool(
            factory,
            { address: item.assetAddress, kind },
            provider,
            options.lineageIndexAddress,
            { blockTag: toBlock },
          ),
        );
        if (
          !resolved ||
          resolved.poolAddress !== item.poolAddress ||
          resolved.poolDeploymentBlock > item.creationEventBlock
        )
          throw new Error("Pool configuration does not match its creation event");
        const asset = await readRecoveredShieldedAsset(
          item.assetAddress,
          provider,
          options.nativeSymbol ?? "Native",
          { blockTag: toBlock, timeoutMs: options.timeoutMs },
        );
        return { ...item, ...resolved, asset, configurationVerified: true };
      } catch {
        return {
          ...item,
          configurationVerified: false,
          error: "Pool configuration could not be verified",
        };
      }
    }),
  );
  const finalAnchor = await bounded(provider.getBlock(toBlock));
  if (finalAnchor?.hash !== anchor.hash)
    throw new Error("Factory discovery anchor was reorganized");
  return {
    chainId,
    toBlock,
    blockHash: anchor.hash,
    expectedPoolCount,
    enumerationComplete: enumerationError === undefined,
    enumerationError,
    pools,
  };
}
