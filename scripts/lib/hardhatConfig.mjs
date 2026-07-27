export const SOLIDITY_EVM_VERSION = "cancun";

export const DEFAULT_CONFLUX_RPC_URLS = Object.freeze({
  conflux: "https://evm.confluxrpc.com",
  confluxTestnet: "https://evmtestnet.confluxrpc.com",
});

const nonBlank = (value) => (typeof value === "string" ? value.trim() : "");

export const resolveConfluxRpcUrls = (env = process.env) => ({
  conflux: nonBlank(env.CONFLUX_RPC_URL) || DEFAULT_CONFLUX_RPC_URLS.conflux,
  confluxTestnet: nonBlank(env.CONFLUX_TESTNET_RPC_URL) || DEFAULT_CONFLUX_RPC_URLS.confluxTestnet,
});

export const resolveEthereumRpcUrls = (env = process.env) => {
  const infuraApiKey = nonBlank(env.INFURA_API_KEY);
  return {
    mainnet:
      nonBlank(env.ETHEREUM_MAINNET_RPC_URL) ||
      `https://mainnet.infura.io/v3/${infuraApiKey}`,
    sepolia:
      nonBlank(env.ETHEREUM_SEPOLIA_RPC_URL) ||
      `https://sepolia.infura.io/v3/${infuraApiKey}`,
  };
};

export const resolveProductionRpcUrl = (chainProfile, env = process.env) => {
  if (chainProfile?.id === "espace") return resolveConfluxRpcUrls(env).conflux;
  if (chainProfile?.id === "ethereum") return resolveEthereumRpcUrls(env).mainnet;
  throw new Error(`Unsupported production RPC profile: ${String(chainProfile?.id ?? "unknown")}`);
};
