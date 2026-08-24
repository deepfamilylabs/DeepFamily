import { describe, expect, it, vi } from "vitest";
import {
  ADD_VERSION_SCOPE_CHANGED,
  assertAddVersionTransactionScope,
  createAddVersionTransactionScope,
  sameAddVersionTransactionScope,
} from "./addVersionTransactionScope";

const CONTRACT = "0x0000000000000000000000000000000000000abc";
const READER = "0x0000000000000000000000000000000000000def";
const SUBMITTER = "0x00000000000000000000000000000000000000aa";

function signer(input: { address?: string; walletChainId?: string } = {}) {
  return {
    getAddress: vi.fn(async () => input.address ?? SUBMITTER),
    provider: {
      send: vi.fn(async (method: string) => {
        expect(method).toBe("eth_chainId");
        return input.walletChainId ?? "0x47";
      }),
    },
  } as any;
}

describe("AddVersion transaction scope", () => {
  const expected = createAddVersionTransactionScope({
    chainId: 71,
    contractAddress: CONTRACT,
    readerAddress: READER,
    submitterAddress: SUBMITTER,
  });

  it("normalizes addresses and accepts the exact config, wallet, and chain scope", async () => {
    const same = createAddVersionTransactionScope({
      chainId: 71,
      contractAddress: CONTRACT.toUpperCase().replace("0X", "0x"),
      readerAddress: READER.toUpperCase().replace("0X", "0x"),
      submitterAddress: SUBMITTER.toUpperCase().replace("0X", "0x"),
    });
    expect(sameAddVersionTransactionScope(expected, same)).toBe(true);
    await expect(
      assertAddVersionTransactionScope({
        expected,
        chainId: 71,
        contractAddress: CONTRACT,
        readerAddress: READER,
        signer: signer(),
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["configured chain", { chainId: 72 }],
    ["DeepFamily proxy", { contractAddress: "0x0000000000000000000000000000000000000fed" }],
    ["Reader", { readerAddress: "0x0000000000000000000000000000000000000fed" }],
    ["submitter", { address: "0x00000000000000000000000000000000000000bb" }],
    ["wallet chain", { walletChainId: "0x48" }],
  ])("rejects a changed %s before a wallet request", async (_label, changed) => {
    await expect(
      assertAddVersionTransactionScope({
        expected,
        chainId: "chainId" in changed ? Number(changed.chainId) : 71,
        contractAddress:
          "contractAddress" in changed ? String(changed.contractAddress) : CONTRACT,
        readerAddress: "readerAddress" in changed ? String(changed.readerAddress) : READER,
        signer: signer({
          address: "address" in changed ? String(changed.address) : undefined,
          walletChainId:
            "walletChainId" in changed ? String(changed.walletChainId) : undefined,
        }),
      }),
    ).rejects.toMatchObject({ code: ADD_VERSION_SCOPE_CHANGED });
  });
});
