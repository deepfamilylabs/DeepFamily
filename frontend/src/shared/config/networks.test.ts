import { describe, expect, it } from "vitest";
import {
  NETWORK_PRESETS,
  SUPPORTED_CHAIN_IDS,
  SUPPORTED_NETWORKS,
  getAddChainParams,
  isSupportedChain,
} from "./networks";

describe("network configuration", () => {
  it("prioritizes Conflux eSpace while retaining optional Ethereum networks", () => {
    expect(NETWORK_PRESETS.map(({ chainId }) => chainId)).toEqual([1030, 71, 1, 11155111, 31337]);
    expect(SUPPORTED_CHAIN_IDS).toEqual([1030, 71, 1, 11155111, 31337]);
  });

  it("no longer advertises the retired Holesky testnet", () => {
    expect(SUPPORTED_NETWORKS[17000]).toBeUndefined();
    expect(isSupportedChain(17000)).toBe(false);
  });

  it("uses CFX metadata when adding Conflux eSpace to a wallet", () => {
    expect(getAddChainParams(1030)).toMatchObject({
      chainId: "0x406",
      chainName: "Conflux eSpace",
      nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
      rpcUrls: ["https://evm.confluxrpc.com"],
      blockExplorerUrls: ["https://evm.confluxscan.org"],
    });
  });
});
