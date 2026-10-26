import assert from "node:assert/strict";
import { getAddress, getBytes } from "ethers";

/** A transport to a single unlocked local test account, never a proof/state mock. */
export async function installQualificationBrowserWallet(context, { provider, address, chainId, transactions, afterTransaction }) {
  address = getAddress(address);
  const allowedReads = new Set([
    "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionByHash", "eth_getTransactionReceipt",
    "eth_getBalance", "eth_getTransactionCount", "eth_getCode", "eth_call", "eth_estimateGas", "eth_gasPrice",
    "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getLogs", "net_version",
  ]);
  await context.exposeBinding("__qualificationWalletRequest", async (_, payload) => {
    const { method, params = [] } = payload;
    if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [address];
    if (method === "eth_chainId") return `0x${BigInt(chainId).toString(16)}`;
    if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
      assert.equal(BigInt(params[0]?.chainId), BigInt(chainId), "Acceptance wallets cannot switch away from the local chain");
      return null;
    }
    if (method === "eth_sendTransaction") {
      assert.ok(Array.isArray(params) && params.length === 1);
      const tx = { ...params[0] };
      assert.equal(getAddress(tx.from), address, "Each browser context may sign only its own account");
      if (tx.chainId !== undefined) assert.equal(BigInt(tx.chainId), BigInt(chainId));
      const hash = await provider.send(method, [tx]);
      transactions.push({ account: address, transactionHash: hash, to: tx.to ?? null,
        selector: (tx.data ?? "0x").slice(0, 10), submittedAt: new Date().toISOString() });
      if (afterTransaction) await afterTransaction({ hash, transaction: tx });
      return hash;
    }
    if (method === "personal_sign") {
      assert.equal(getAddress(params[1]), address);
      return (await provider.getSigner(address)).signMessage(getBytes(params[0]));
    }
    if (method === "eth_signTypedData_v4") {
      assert.equal(getAddress(params[0]), address);
      return provider.send(method, params);
    }
    if (!allowedReads.has(method)) throw new Error(`Unsupported local acceptance wallet method: ${method}`);
    return provider.send(method, params);
  });
  await context.addInitScript(({ account, localChainId }) => {
    const listeners = new Map();
    const wallet = {
      isMetaMask: true, selectedAddress: account, chainId: `0x${BigInt(localChainId).toString(16)}`,
      isConnected: () => true,
      request: (payload) => window.__qualificationWalletRequest(payload),
      on(event, handler) { const set = listeners.get(event) ?? new Set(); set.add(handler); listeners.set(event, set); return wallet; },
      removeListener(event, handler) { listeners.get(event)?.delete(handler); return wallet; },
      removeAllListeners(event) { if (event) listeners.delete(event); else listeners.clear(); return wallet; },
    };
    Object.defineProperty(window, "ethereum", { value: wallet, configurable: false });
    localStorage.setItem("i18nextLng", "en");
    localStorage.setItem("deepfamily_last_wallet_type", "metamask");
  }, { account: address, localChainId: String(chainId) });
}
