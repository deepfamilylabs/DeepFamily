export const passiveWalletRpc = (scope: () => { account: string | null; chainId: bigint }) => async (method: string) => {
  const { account, chainId } = scope();
  if (method === "eth_accounts") return account ? [account] : [];
  if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
  throw new Error(`Unexpected wallet RPC: ${method}`);
};
