import type { Contract, JsonRpcProvider } from "ethers";

export type ShieldedPageModules = {
  chainId: bigint;
  provider: JsonRpcProvider;
  deepFamily: Contract;
  lineageIndex: Contract;
  token: Contract | null;
  assetAddress: string;
  assetKind: "erc20" | "native";
  assetSymbol: string;
  factory: Contract;
  pool: Contract;
  poolAddress: string;
  poolDeploymentBlock: number;
  tokenDecimals: number;
};
