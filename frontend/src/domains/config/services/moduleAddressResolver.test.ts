import { describe, expect, it, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provider: {},
  reader: {
    DEEP_FAMILY: vi.fn(),
  },
  deepFamily: {
    DEEP_FAMILY_TOKEN_CONTRACT: vi.fn(),
  },
  getReadonlyProvider: vi.fn(),
  createDeepFamilyReaderContract: vi.fn(),
  createDeepFamilyContract: vi.fn(),
}));

vi.mock("../../../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: mocks.getReadonlyProvider,
}));

vi.mock("../../../shared/clients/contractFactory", () => ({
  createDeepFamilyReaderContract: mocks.createDeepFamilyReaderContract,
  createDeepFamilyContract: mocks.createDeepFamilyContract,
}));

import { resolveModuleAddresses } from "./moduleAddressResolver";

const readerAddress = "0x0000000000000000000000000000000000000101";
const mainAddress = "0x0000000000000000000000000000000000000202";
const tokenAddress = "0x0000000000000000000000000000000000000404";

describe("resolveModuleAddresses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReadonlyProvider.mockReturnValue(mocks.provider);
    mocks.createDeepFamilyReaderContract.mockReturnValue(mocks.reader);
    mocks.createDeepFamilyContract.mockReturnValue(mocks.deepFamily);
    mocks.reader.DEEP_FAMILY.mockResolvedValue(mainAddress);
    mocks.deepFamily.DEEP_FAMILY_TOKEN_CONTRACT.mockResolvedValue(tokenAddress);
  });

  it("resolves main and token addresses from the reader entrypoint", async () => {
    await expect(
      resolveModuleAddresses({
        rpcUrl: "http://rpc.local",
        chainId: 31337,
        readerAddress,
      }),
    ).resolves.toEqual({
      readerAddress,
      contractAddress: mainAddress,
      tokenAddress,
    });

    expect(mocks.createDeepFamilyReaderContract).toHaveBeenCalledWith(
      readerAddress,
      mocks.provider,
    );
    expect(mocks.createDeepFamilyContract).toHaveBeenCalledWith(mainAddress, mocks.provider);
  });

  it("rejects invalid reader addresses before making chain calls", async () => {
    await expect(
      resolveModuleAddresses({
        rpcUrl: "http://rpc.local",
        readerAddress: "not-an-address",
      }),
    ).rejects.toThrow(/Invalid reader address/);

    expect(mocks.getReadonlyProvider).not.toHaveBeenCalled();
  });
});
