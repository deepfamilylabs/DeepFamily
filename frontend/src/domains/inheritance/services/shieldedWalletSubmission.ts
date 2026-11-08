import { type Contract, type Signer, type Provider, type ContractTransactionResponse, type TransactionReceipt } from "ethers";
import { executeChainTransaction, runChainRead, normalizeChainError } from "@deepfamily/chain-client";
import { createIdentityAuthorizationContract } from "../../../shared/clients/shieldedIdentityAuthorizationChain";
import { assertShieldedDepositBalance } from "./shieldedDepositBalance";

/** Public transaction slot retained independently of the unlocked secret session. */
export type ShieldedSubmissionAnchor = { nonce: number; fromBlock: number; signerAddress: string };
export type ShieldedWalletSubmissionCallbacks = {
  assertCurrent?: () => void;
  onSubmitting?: (anchor: ShieldedSubmissionAnchor) => void;
  onBroadcast?: (hash: string) => void;
  onWalletRequest?: () => () => void;
};

type WalletInput = ShieldedWalletSubmissionCallbacks & {
  signer: Signer;
  chainId: bigint;
  account: string;
};

/** Recheck the wallet and cancellation after every preparatory RPC read. */
export async function readShieldedSubmissionAnchor(input: WalletInput): Promise<ShieldedSubmissionAnchor> {
  const provider = input.signer.provider;
  if (!provider) throw normalizeChainError(new Error("Transaction wallet has no provider"), { category: "wallet", operation: "submit" });
  const [network, address] = await runChainRead({ read: () => Promise.all([provider.getNetwork(), input.signer.getAddress()]) });
  input.assertCurrent?.();
  if (network.chainId !== input.chainId || address.toLowerCase() !== input.account.toLowerCase())
    throw normalizeChainError(new Error("The transaction wallet changed before submission"), { category: "wallet", operation: "submit" });
  const anchor = await readPublicSubmissionAnchor(provider, address);
  input.assertCurrent?.();
  return anchor;
}

/** Shared nonce and scan boundary for every public wallet submission. */
export async function readPublicSubmissionAnchor(provider: Provider, signerAddress: string): Promise<ShieldedSubmissionAnchor> {
  const [nonce, fromBlock] = await runChainRead({ read: () => Promise.all([
    provider.getTransactionCount(signerAddress, "pending"), provider.getBlockNumber(),
  ]) });
  if (!Number.isSafeInteger(nonce) || nonce < 0 || !Number.isSafeInteger(fromBlock) || fromBlock < 0)
    throw normalizeChainError(new Error("Transaction submission anchor is invalid"), { category: "validation", operation: "submit" });
  return { nonce, fromBlock, signerAddress };
}

async function submitWalletCall(
  input: WalletInput,
  contract: Contract,
  method: string,
  args: readonly unknown[],
) {
  const address = await contract.getAddress();
  const calldata = contract.interface.encodeFunctionData(method, args);
  const anchor = await readShieldedSubmissionAnchor(input);
  input.assertCurrent?.();
  return executeChainTransaction<TransactionReceipt, ContractTransactionResponse>({
    fromBlock: anchor.fromBlock,
    assertActive: input.assertCurrent,
    send: async () => {
      const finishWalletRequest = input.onWalletRequest?.();
      try {
        input.onSubmitting?.(anchor);
        return await contract[method](...args, { nonce: anchor.nonce, chainId: input.chainId });
      } finally {
        finishWalletRequest?.();
      }
    },
    expected: {
      chainId: input.chainId, from: anchor.signerAddress, to: address, data: calldata,
      value: 0n, nonce: anchor.nonce,
    },
    onSubmitted: input.onBroadcast,
    requireSuccess: false,
  });
}

export async function submitShieldedApproval(input: WalletInput & {
  token: Contract; spender: string; amount: bigint;
}) {
  await assertShieldedDepositBalance(input.token, input.account, input.amount);
  input.assertCurrent?.();
  return submitWalletCall(input, input.token.connect(input.signer) as Contract, "approve", [input.spender, input.amount]);
}

export async function submitShieldedAuthorization(input: WalletInput & {
  address: string; args: readonly [string, string, string, string, string];
}) {
  const contract = createIdentityAuthorizationContract(input.address, input.signer);
  return submitWalletCall(input, contract, "incrementCounter", [...input.args]);
}
