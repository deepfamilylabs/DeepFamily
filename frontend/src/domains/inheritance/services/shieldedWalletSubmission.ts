import { type Contract, type Provider, type ContractTransactionResponse, type TransactionReceipt } from "ethers";
import { runChainRead, normalizeChainError } from "@deepfamily/chain-client";
import type { WalletDraft } from "../../../shared/clients/walletDraft";
import { createIdentityAuthorizationContract } from "../../../shared/clients/shieldedIdentityAuthorizationChain";
import { assertShieldedDepositBalance } from "./shieldedDepositBalance";

/** Public transaction slot retained independently of the unlocked secret session. */
export type ShieldedSubmissionAnchor = { nonce: number; fromBlock: number; signerAddress: string };
export type ShieldedWalletSubmissionCallbacks = {
  onSubmitting?: (anchor: ShieldedSubmissionAnchor) => void;
  onBroadcast?: (hash: string) => void;
  onWalletRequest?: () => () => void;
};

type WalletInput = ShieldedWalletSubmissionCallbacks & {
  draft: WalletDraft;
};

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
  const { draft } = input;
  draft.assertCurrent();
  const provider = draft.signer.provider;
  if (!provider) throw normalizeChainError(new Error("Transaction wallet has no provider"), { category: "wallet", operation: "submit" });
  const anchor = await readPublicSubmissionAnchor(provider, draft.account);
  return draft.submit<TransactionReceipt, ContractTransactionResponse>({
    fromBlock: anchor.fromBlock,
    send: async () => {
      const finishWalletRequest = input.onWalletRequest?.();
      try {
        input.onSubmitting?.(anchor);
        return await contract[method](...args, { nonce: anchor.nonce, chainId: draft.chainId });
      } finally {
        finishWalletRequest?.();
      }
    },
    expected: {
      to: address, data: calldata,
      value: 0n, nonce: anchor.nonce,
    },
    onSubmitted: input.onBroadcast,
    requireSuccess: false,
  });
}

export async function submitShieldedApproval(input: WalletInput & {
  token: Contract; spender: string; amount: bigint;
}) {
  await assertShieldedDepositBalance(input.token, input.draft.account, input.amount);
  input.draft.assertCurrent();
  return submitWalletCall(input, input.token.connect(input.draft.signer) as Contract, "approve", [input.spender, input.amount]);
}

export async function submitShieldedAuthorization(input: WalletInput & {
  address: string; args: readonly [string, string, string, string, string];
}) {
  const contract = createIdentityAuthorizationContract(input.address, input.draft.signer);
  return submitWalletCall(input, contract, "incrementCounter", [...input.args]);
}
