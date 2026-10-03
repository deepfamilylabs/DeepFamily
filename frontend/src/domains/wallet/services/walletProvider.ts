import { BrowserProvider, type Eip1193Provider } from "ethers";
import { isDevMode, SUPPORTED_NETWORKS } from "../../../shared/config";

const LOCAL_CHAIN_ID = "0x7a69";
const LOCAL_RPC_URL = SUPPORTED_NETWORKS[31337].rpcUrl;
const LOCAL_RPC_TIMEOUT_MS = 10_000;
const localSendQueues = new WeakMap<Eip1193Provider, Map<string, Promise<void>>>();
let rpcRequestId = 0;

async function localRpcRequest(method: string, params: unknown[]): Promise<unknown> {
  const id = ++rpcRequestId;
  const response = await fetch(LOCAL_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(LOCAL_RPC_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Local development RPC request failed");
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error.message || "Local development RPC request failed");
  }
  if (payload?.jsonrpc !== "2.0" || payload.id !== id || !("result" in payload)) {
    throw new Error("Local development RPC returned an invalid response");
  }
  return payload.result;
}

async function freshLocalNonce(address: string): Promise<string> {
  // Read the node directly: the wallet's RPC and nonce tracker can lag behind
  // instantly mined Hardhat transactions, including the preceding approval.
  const [chainId, nonce] = await Promise.all([
    localRpcRequest("eth_chainId", []),
    localRpcRequest("eth_getTransactionCount", [address, "pending"]),
  ]);
  if (chainId !== LOCAL_CHAIN_ID) {
    throw new Error("Local development RPC is connected to the wrong network");
  }
  if (
    typeof nonce !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(nonce) ||
    BigInt(nonce) > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("Local development RPC returned an invalid transaction nonce");
  }
  return nonce;
}

function serializeLocalSend<T>(
  provider: Eip1193Provider,
  address: string,
  send: () => Promise<T>,
): Promise<T> {
  let queues = localSendQueues.get(provider);
  if (!queues) {
    queues = new Map();
    localSendQueues.set(provider, queues);
  }
  const key = address.toLowerCase();
  const result = (queues.get(key) ?? Promise.resolve()).then(send);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return result;
}

/** Keep ordinary wallet nonce management; refresh it only for local dev sends. */
export function createWalletProvider(rawProvider: Eip1193Provider): BrowserProvider {
  if (!isDevMode()) return new BrowserProvider(rawProvider);

  const provider: Eip1193Provider = {
    async request(request) {
      if (request.method !== "eth_sendTransaction" || !Array.isArray(request.params)) {
        return rawProvider.request(request);
      }
      const [transaction] = request.params;
      if (!transaction || typeof transaction.from !== "string" || transaction.nonce != null) {
        return rawProvider.request(request);
      }
      const chainId = await rawProvider.request({ method: "eth_chainId", params: [] });
      if (chainId !== LOCAL_CHAIN_ID) return rawProvider.request(request);

      return serializeLocalSend(rawProvider, transaction.from, async () => {
        const nonce = await freshLocalNonce(transaction.from);
        const currentChainId = await rawProvider.request({ method: "eth_chainId", params: [] });
        if (currentChainId !== chainId) {
          throw new Error("Wallet network changed before the local transaction was sent");
        }
        if (transaction.chainId != null && BigInt(transaction.chainId) !== BigInt(chainId)) {
          throw new Error("Transaction is connected to the wrong network");
        }
        // No cached counter and no retry: a failed or uncertain send must never
        // cause a second approval, transfer or deposit automatically.
        return rawProvider.request({
          ...request,
          params: [{ ...transaction, chainId, nonce }, ...request.params!.slice(1)],
        });
      });
    },
  };
  return new BrowserProvider(provider);
}
