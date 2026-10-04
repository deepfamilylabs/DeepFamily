import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZeroAddress, type Contract, type JsonRpcProvider } from "ethers";
import { readShieldedAsset, resolveShieldedAssetPool } from "./shieldedAssetRegistry";

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
  protocolVersion: async () => 2n,
  creationBlock: async () => 42n,
  LINEAGE_INDEX: async () => LINEAGE,
  VERIFIER: async () => VERIFIER,
  TOKEN: vi.fn(async () => token),
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
    { protocolVersion: async () => 1n },
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
