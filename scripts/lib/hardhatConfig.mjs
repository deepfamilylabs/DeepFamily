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
