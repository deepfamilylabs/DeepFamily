import { beforeEach, describe, expect, it, vi } from "vitest";
import { Interface, ZeroAddress, type Contract, type JsonRpcProvider } from "ethers";
import { SHIELDED_POOL_PROTOCOL_VERSION } from "@deepfamily/protocol-core";
import {
  discoverShieldedFactoryPools,
  readRecoveredShieldedAsset,
  readShieldedAsset,
  resolveShieldedAssetPool,
} from "./shieldedAssetRegistry";

const ASSET = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const LINEAGE = "0x3333333333333333333333333333333333333333";
const VERIFIER = "0x4444444444444444444444444444444444444444";
const mocks = vi.hoisted(() => ({ token: vi.fn(), erc20: vi.fn(), native: vi.fn() }));
vi.mock("../../../shared/clients/contractFactory", () => ({
  createDeepTokenContract: mocks.token,
  createShieldedErc20PoolContract: mocks.erc20,
  createShieldedNativePoolContract: mocks.native,
}));
const provider = { getCode: vi.fn(async () => "0x1234") } as unknown as JsonRpcProvider;
const factory = {
  poolFor: vi.fn(async () => POOL),
  LINEAGE_INDEX: async () => LINEAGE,
  VERIFIER: async () => VERIFIER,
} as unknown as Contract;
const pool = (kind: bigint, token = ASSET) => ({
  assetKind: async () => kind,
  protocolVersion: async () => BigInt(SHIELDED_POOL_PROTOCOL_VERSION),
  creationBlock: async () => 42n,
  LINEAGE_INDEX: async () => LINEAGE,
  VERIFIER: async () => VERIFIER,
  TOKEN: vi.fn(async () => token),
});

describe("complete recovery discovery and hostile token isolation", () => {
  function discoveryFixture() {
    const factoryAddress = "0x5555555555555555555555555555555555555555";
    const nativePool = "0x6666666666666666666666666666666666666666";
    const secondAsset = "0x7777777777777777777777777777777777777777";
    const secondPool = "0x8888888888888888888888888888888888888888";
    const iface = new Interface(["event PoolCreated(address indexed asset,address indexed pool)"]);
    const pairs = [
      [ZeroAddress, nativePool, 4],
      [ASSET, POOL, 5],
      [secondAsset, secondPool, 9],
    ] as const;
    const logs = pairs.map(([asset, address, blockNumber], index) => ({
      ...iface.encodeEventLog(iface.getEvent("PoolCreated")!, [asset, address]),
      address: factoryAddress,
      blockNumber,
      index,
    }));
    const fixed = vi.fn(async () => ({ hash: `0x${"aa".repeat(32)}` }));
    const getLogs = vi.fn(async (filter: { fromBlock: number; toBlock: number }) =>
      logs.filter(
        (log) => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock,
      ),
    );
    const recoveryProvider = {
      getNetwork: async () => ({ chainId: 31337n }),
      getBlockNumber: async () => 99,
      getBlock: fixed,
      getLogs,
    } as unknown as JsonRpcProvider;
    const poolFor = vi.fn(
      async (asset: string) => pairs.find(([item]) => item === asset)?.[1] ?? ZeroAddress,
    );
    const count = vi.fn(async () => 3n);
    const recoveryFactory = {
      interface: iface,
      getAddress: async () => factoryAddress,
      poolFor,
      poolCount: count,
      LINEAGE_INDEX: vi.fn(async () => LINEAGE),
      VERIFIER: vi.fn(async () => VERIFIER),
    } as unknown as Contract;
    mocks.native.mockReturnValue({ ...pool(1n), creationBlock: async () => 3n });
    mocks.erc20.mockImplementation((address: string) => ({
      ...pool(0n, address === POOL ? ASSET : secondAsset),
      creationBlock: async () => (address === POOL ? 5n : 9n),
    }));
    return {
      recoveryFactory,
      recoveryProvider,
      poolFor,
      count,
      getLogs,
      secondAsset,
      secondPool,
      fixed,
      logs,
      options: {
        factoryDeploymentBlock: 4,
        lineageIndexAddress: LINEAGE,
        verifierAddress: VERIFIER,
        chainId: 31337n,
        toBlock: 10,
        blockChunk: 3,
        timeoutMs: 50,
        nativeSymbol: "ETH",
      },
    };
  }

  it("includes pools created after an old backup and checks all reads at the same block", async () => {
    const f = discoveryFixture();
    const result = await discoverShieldedFactoryPools(
      f.recoveryFactory,
      f.recoveryProvider,
      f.options,
    );
    expect(result.enumerationComplete).toBe(true);
    expect(result.expectedPoolCount).toBe(3n);
    expect(result.pools.map((item) => item.assetAddress)).toEqual([
      ZeroAddress,
      ASSET,
      f.secondAsset,
    ]);
    expect(result.pools.every((item) => item.configurationVerified)).toBe(true);
    expect(f.count).toHaveBeenCalledWith({ blockTag: 10 });
    expect(
      f.poolFor.mock.calls.every(
        (call) =>
          (call as unknown[])[1] &&
          ((call as unknown[])[1] as { blockTag: number }).blockTag === 10,
      ),
    ).toBe(true);
    expect(f.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock])).toEqual([
      [4, 6],
      [7, 9],
      [10, 10],
    ]);
  });

  it("preserves verified pools and raw precision when another token has unusable interfaces", async () => {
    const f = discoveryFixture();
    mocks.token.mockImplementation((address: string) =>
      address === f.secondAsset
        ? {
            decimals: async () => {
              throw new Error("bad precision");
            },
            symbol: async () => {
              throw new Error("bad symbol");
            },
            balanceOf: async () => {
              throw new Error("bad balance");
            },
            allowance: async () => new Promise(() => {}),
          }
        : {
            decimals: async () => 6n,
            symbol: async () => "USD",
            balanceOf: async () => 0n,
            allowance: async () => 0n,
          },
    );
    const result = await discoverShieldedFactoryPools(
      f.recoveryFactory,
      f.recoveryProvider,
      f.options,
    );
    expect(result.enumerationComplete).toBe(true);
    expect(result.pools.find((item) => item.assetAddress === ASSET)?.asset?.decimals).toBe(6);
    expect(result.pools.find((item) => item.assetAddress === f.secondAsset)).toMatchObject({
      configurationVerified: true,
      asset: { decimals: null, metadataAvailable: false, interoperabilityAvailable: false },
    });
  });

  it("records incomplete enumeration separately from single-pool configuration failure", async () => {
    const f = discoveryFixture();
    f.count.mockResolvedValue(4n);
    mocks.erc20.mockImplementation((address: string) => ({
      ...pool(0n, address === POOL ? ASSET : ZeroAddress),
      creationBlock: async () => 5n,
    }));
    const result = await discoverShieldedFactoryPools(
      f.recoveryFactory,
      f.recoveryProvider,
      f.options,
    );
    expect(result.enumerationComplete).toBe(false);
    expect(result.pools.find((item) => item.assetAddress === ASSET)?.configurationVerified).toBe(
      true,
    );
    expect(
      result.pools.find((item) => item.assetAddress === f.secondAsset)?.configurationVerified,
    ).toBe(false);
    expect(result.pools).toHaveLength(3);
  });

  it("refuses a reorganized discovery anchor", async () => {
    const f = discoveryFixture();
    f.fixed
      .mockResolvedValueOnce({ hash: `0x${"aa".repeat(32)}` })
      .mockResolvedValueOnce({ hash: `0x${"bb".repeat(32)}` });
    await expect(
      discoverShieldedFactoryPools(f.recoveryFactory, f.recoveryProvider, f.options),
    ).rejects.toThrow("reorganized");
  });

  it("uses no default decimals for malformed return values", async () => {
    mocks.token.mockReturnValue({
      decimals: async () => -1n,
      symbol: async () => "TOKEN",
      balanceOf: async () => "0",
      allowance: async () => 0n,
    });
    expect(
      await readRecoveredShieldedAsset(ASSET, provider, "ETH", { blockTag: 10 }),
    ).toMatchObject({
      decimals: null,
      metadataAvailable: false,
      interoperabilityAvailable: false,
    });
  });
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token.mockReturnValue({
    decimals: async () => 6n,
    symbol: async () => "USD",
    balanceOf: async () => 0n,
    allowance: async () => 0n,
  });
  mocks.erc20.mockReturnValue(pool(0n));
  mocks.native.mockReturnValue(pool(1n));
  vi.mocked(factory.poolFor).mockResolvedValue(POOL);
});
describe("canonical multi-asset discovery", () => {
  it("supports native assets without calling ERC-20 interfaces", async () => {
    const asset = await readShieldedAsset(ZeroAddress, provider, "CFX");
    expect(asset).toMatchObject({ kind: "native", symbol: "CFX", decimals: 18, token: null });
    expect(await resolveShieldedAssetPool(factory, asset, provider, LINEAGE)).toMatchObject({
      poolDeploymentBlock: 42,
    });
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.native.mock.results[0].value.TOKEN).not.toHaveBeenCalled();
  });
  it("uses token precision and treats a missing symbol as address metadata", async () => {
    mocks.token.mockReturnValue({
      decimals: async () => 6n,
      symbol: async () => {
        throw new Error();
      },
      balanceOf: async () => 0n,
      allowance: async () => 0n,
    });
    expect(await readShieldedAsset(ASSET, provider, "CFX")).toMatchObject({
      decimals: 6,
      symbol: "0x1111…1111",
    });
  });
  it("rejects absent decimals instead of assuming 18", async () => {
    mocks.token.mockReturnValue({
      decimals: async () => {
        throw new Error("no decimals");
      },
      symbol: async () => "USD",
      balanceOf: async () => 0n,
      allowance: async () => 0n,
    });
    await expect(readShieldedAsset(ASSET, provider, "CFX")).rejects.toThrow("no decimals");
  });
  it("leaves an unknown asset ready for permissionless creation", async () => {
    vi.mocked(factory.poolFor).mockResolvedValue(ZeroAddress);
    const asset = await readShieldedAsset(ASSET, provider, "CFX");
    expect(await resolveShieldedAssetPool(factory, asset, provider, LINEAGE)).toBeNull();
  });
  it.each([
    { TOKEN: async () => ZeroAddress },
    { assetKind: async () => 1n },
    { protocolVersion: async () => 2n },
    { LINEAGE_INDEX: async () => ZeroAddress },
    { VERIFIER: async () => ZeroAddress },
  ])("rejects a pool with mismatching immutable configuration %s", async (changes) => {
    mocks.erc20.mockReturnValue({ ...pool(0n), ...changes });
    const asset = await readShieldedAsset(ASSET, provider, "CFX");
    await expect(resolveShieldedAssetPool(factory, asset, provider, LINEAGE)).rejects.toThrow(
      "configuration",
    );
  });
});
