export interface NetworkOption {
  chainId: number;
  name: string;
  rpcUrl: string;
  isCustom?: boolean;
}

export type NetworkSelection = number | "custom";
