import { getAddress } from "ethers";
import { normalizeChainError } from "./errors.js";
import { runChainRead } from "./execution.js";

/** Check the actual wallet immediately before a send; React state alone may be stale. */
export async function assertChainWalletScope(input) {
  input.assertActive?.();
  const provider = input.signer?.provider;
  if (!provider) throw normalizeChainError(
    Object.assign(new Error("Wallet provider is unavailable"), { code: "CHAIN_WALLET_UNAVAILABLE" }),
    { category: "wallet", operation: "submit" },
  );
  const expectedAccount = getAddress(input.account);
  const [chainId, account] = await runChainRead({ read: () => Promise.all([
    typeof provider.send === "function"
      ? provider.send("eth_chainId", [])
      : provider.getNetwork().then((network) => network.chainId),
    input.signer.getAddress(),
  ]) });
  input.assertActive?.();
  let matches = false;
  try {
    matches = BigInt(input.chainId) > 0n && BigInt(chainId) === BigInt(input.chainId) &&
      getAddress(account) === expectedAccount;
  } catch { /* An invalid wallet response never authorizes a send. */ }
  if (!matches) throw normalizeChainError(
    Object.assign(new Error("Wallet network or account changed; review the transaction again"), { code: "CHAIN_WALLET_SCOPE_CHANGED" }),
    { category: "wallet", operation: "submit" },
  );
}
