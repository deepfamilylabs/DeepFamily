import {
  assertChainWalletScope, executeChainTransaction, normalizeChainError,
  type ExecuteChainTransactionInput, type IntegerLike, type TransactionReceiptLike,
  type TransactionResponseLike, type TransactionScope,
} from "@deepfamily/chain-client";
import type { Signer } from "ethers";
import { getWalletConnectionGeneration } from "./walletConnectionGeneration";

type DraftTransaction<Receipt extends TransactionReceiptLike, Response extends TransactionResponseLike<Receipt>> =
  Omit<ExecuteChainTransactionInput<Receipt, Response>, "expected" | "beforeSend" | "assertActive"> & {
    expected: Omit<TransactionScope, "from" | "chainId">;
  };

export function captureWalletDraft({ signer, account, chainId, isCurrent: ownsDraft, staleError, walletChangedError }: {
  signer: Signer;
  account: string;
  chainId: IntegerLike;
  isCurrent: () => boolean;
  staleError?: () => Error;
  walletChangedError?: () => Error;
}) {
  const expectedChain = BigInt(chainId);
  const generation = getWalletConnectionGeneration();
  const isCurrent = () => generation === getWalletConnectionGeneration() && ownsDraft();
  const assertCurrent = () => {
    if (!isCurrent()) throw staleError?.() ?? normalizeChainError(new Error("Wallet draft is no longer active"), {
      category: "cancelled", operation: "submit",
    });
  };
  const assertWallet = async () => {
    try {
      await assertChainWalletScope({ signer, account, chainId: expectedChain, assertActive: assertCurrent, requireSelectedAccount: true });
    } catch (error) {
      if (walletChangedError && error instanceof Error && "code" in error && error.code === "CHAIN_WALLET_SCOPE_CHANGED")
        throw walletChangedError();
      throw error;
    }
    assertCurrent();
  };
  return Object.freeze({
    signer, account, chainId: expectedChain, assertCurrent, assertWallet, isCurrent,
    commit(update: () => void) { if (isCurrent()) update(); },
    submit<Receipt extends TransactionReceiptLike, Response extends TransactionResponseLike<Receipt> = TransactionResponseLike<Receipt>>(
      input: DraftTransaction<Receipt, Response>,
    ) {
      return executeChainTransaction<Receipt, Response>({
        ...input, expected: { ...input.expected, chainId: expectedChain, from: account },
        beforeSend: assertWallet, assertActive: assertCurrent,
      });
    },
  });
}

export type WalletDraft = ReturnType<typeof captureWalletDraft>;
