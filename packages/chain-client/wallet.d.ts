import type { IntegerLike } from "./types.js";
export interface ChainWalletScopeInput {
  signer: {
    provider: {
      send?: (method: string, params: unknown[]) => Promise<unknown>;
      getNetwork(): Promise<{ chainId: IntegerLike }>;
    } | null;
    getAddress(): Promise<string>;
  };
  chainId: IntegerLike;
  account: string;
  assertActive?: () => void;
}
/** Validates the actual chain/account, including raw injected-wallet chain changes. */
export function assertChainWalletScope(input: ChainWalletScopeInput): Promise<void>;
