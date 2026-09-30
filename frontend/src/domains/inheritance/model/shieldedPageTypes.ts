import type { Contract, JsonRpcProvider } from "ethers";

export type ShieldedPageModules = {
  chainId: bigint;
  provider: JsonRpcProvider;
  deepFamily: Contract;
  lineageIndex: Contract;
  token: Contract;
  pool: Contract;
  poolAddress: string;
  tokenDecimals: number;
};
