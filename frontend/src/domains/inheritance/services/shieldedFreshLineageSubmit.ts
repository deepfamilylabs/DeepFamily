import { getAddress, getBigInt, type Contract } from "ethers";
import {
  submitFund,
  submitClaim,
  type PrivatePoolFlowInput,
  type ShieldedPoolFlowResult,
  type ShieldedPoolFlowStage,
} from "./shieldedPoolFlows";

export type CurrentLineageRoots = {
  endorsement: bigint;
  trusted: bigint;
  blockNumber: number;
};

type PreparedLineageAction = Pick<PrivatePoolFlowInput, "data" | "witness">;

export type FreshLineageSubmitInput<T extends PreparedLineageAction> = Omit<
  PrivatePoolFlowInput,
  "data" | "witness"
> & {
  lineageIndex: Contract;
  /** Rebuild the public-event snapshot, note paths, and witness locally for each attempt. */
  prepare: (roots: CurrentLineageRoots, attempt: number) => Promise<T>;
  maxAttempts?: 1 | 2 | 3;
};

export type FreshLineageSubmitResult<T extends PreparedLineageAction> = ShieldedPoolFlowResult & {
  prepared: T;
  attempts: number;
};

/** A transaction may already be on chain. The caller must inspect its hash before another attempt. */
export class ShieldedLineageSubmissionError extends Error {
  readonly transactionHash?: string;
  readonly receiptStatus?: number;
  readonly cause?: unknown;

  constructor(message: string, transactionHash?: string, receiptStatus?: number, cause?: unknown) {
    super(message);
    this.name = "ShieldedLineageSubmissionError";
    this.transactionHash = transactionHash;
    this.receiptStatus = receiptStatus;
    this.cause = cause;
  }
}

class StaleLineageBeforeSubmit extends Error {}

function matches(roots: CurrentLineageRoots, data: PreparedLineageAction["data"]): boolean {
  return (
    roots.endorsement === getBigInt(data.relation0) && roots.trusted === getBigInt(data.relation1)
  );
}

function sameRoots(a: CurrentLineageRoots, b: CurrentLineageRoots): boolean {
  return a.endorsement === b.endorsement && a.trusted === b.trusted;
}

async function readCurrentRoots(
  input: FreshLineageSubmitInput<PreparedLineageAction>,
): Promise<CurrentLineageRoots> {
  const provider = input.signer.provider;
  if (!provider) throw new Error("CFX transaction wallet has no provider");
  // Both roots must come from the same block. Reading each at `latest` separately
  // could produce a pair that never existed together.
  const blockNumber = await provider.getBlockNumber();
  const [endorsement, trusted] = await Promise.all([
    input.lineageIndex.root(0, { blockTag: blockNumber }),
    input.lineageIndex.root(1, { blockTag: blockNumber }),
  ]);
  return { endorsement: getBigInt(endorsement), trusted: getBigInt(trusted), blockNumber };
}

async function changedAfterSubmit(
  input: FreshLineageSubmitInput<PreparedLineageAction>,
  prepared: PreparedLineageAction,
): Promise<boolean | undefined> {
  try {
    return !matches(await readCurrentRoots(input), prepared.data);
  } catch {
    // The broadcast hash remains the useful recovery handle even if RPC fails.
    return undefined;
  }
}

function changeDescription(changed: boolean | undefined): string {
  return changed === true
    ? "; lineage roots changed"
    : changed === undefined
      ? "; current lineage roots could not be checked"
      : "";
}

async function assertPoolLineageIndex(
  input: FreshLineageSubmitInput<PreparedLineageAction>,
): Promise<void> {
  const [configured, supplied] = await Promise.all([
    input.pool.LINEAGE_INDEX() as Promise<string>,
    input.lineageIndex.getAddress(),
  ]);
  if (getAddress(configured) !== getAddress(supplied)) {
    throw new Error("Lineage index does not belong to this shielded pool");
  }
}

type PoolMethod = ((...args: unknown[]) => Promise<{ hash: string }>) & {
  estimateGas: (...args: unknown[]) => Promise<bigint>;
};

function guardedPool<T extends PreparedLineageAction>(
  input: FreshLineageSubmitInput<T>,
  action: "fund" | "claim",
  prepared: T,
  setBroadcastHash: (hash: string) => void,
): Contract {
  return {
    getAddress: () => input.pool.getAddress(),
    connect: (signer: PrivatePoolFlowInput["signer"]) => {
      const connected = input.pool.connect(signer) as unknown as Record<typeof action, PoolMethod>;
      const original = connected[action];
      if (typeof original !== "function" || typeof original.estimateGas !== "function") {
        throw new Error(`Shielded pool ABI is missing ${action}`);
      }
      const method = Object.assign(
        async (...args: unknown[]) => {
          // `submitFund`/`submitClaim` have already entered their submitting
          // stage. A change here aborts without an automatic retry.
          if (!matches(await readCurrentRoots(input), prepared.data)) {
            throw new ShieldedLineageSubmissionError(
              "Lineage roots changed as submission began; no transaction was sent by this call. Prepare a new proof.",
            );
          }
          const network = await input.signer.provider?.getNetwork();
          if (!network || network.chainId !== input.expectedChainId) {
            throw new Error("Transaction wallet is connected to the wrong network");
          }
          // The final RPC reads can outlive an asset, identity, or wallet change.
          // Run the caller's synchronous guard immediately before requesting a transaction.
          input.onStage?.("submitting");
          const tx = await original(...args);
          setBroadcastHash(tx.hash);
          return tx;
        },
        {
          estimateGas: async (...args: unknown[]) => {
            if (!matches(await readCurrentRoots(input), prepared.data)) {
              throw new StaleLineageBeforeSubmit("Lineage roots changed before submission");
            }
            try {
              const estimate = await original.estimateGas(...args);
              if (!matches(await readCurrentRoots(input), prepared.data)) {
                throw new StaleLineageBeforeSubmit("Lineage roots changed before submission");
              }
              return estimate;
            } catch (error) {
              // A lineage write can make estimateGas revert between our first
              // root read and the node's simulation. Retry only if roots prove it.
              if (error instanceof StaleLineageBeforeSubmit) throw error;
              if (!matches(await readCurrentRoots(input), prepared.data)) {
                throw new StaleLineageBeforeSubmit("Lineage roots changed before submission");
              }
              throw error;
            }
          },
        },
      );
      return { [action]: method };
    },
  } as unknown as Contract;
}

async function submitWithFreshLineage<T extends PreparedLineageAction>(
  input: FreshLineageSubmitInput<T>,
  action: "fund" | "claim",
): Promise<FreshLineageSubmitResult<T>> {
  await assertPoolLineageIndex(input);
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("Lineage proof attempts must be between 1 and 3");
  }
  const submit = action === "fund" ? submitFund : submitClaim;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const roots = await readCurrentRoots(input);
    let prepared: T;
    try {
      prepared = await input.prepare(roots, attempt);
    } catch (error) {
      if (attempt < maxAttempts && !sameRoots(await readCurrentRoots(input), roots)) continue;
      throw error;
    }
    if (!matches(roots, prepared.data) || !matches(await readCurrentRoots(input), prepared.data)) {
      if (attempt < maxAttempts) continue;
      throw new Error(`Lineage roots changed before proving; exhausted ${maxAttempts} attempts`);
    }

    let stage: ShieldedPoolFlowStage | undefined;
    let broadcastHash: string | undefined;
    const onStage = (next: ShieldedPoolFlowStage) => {
      stage = next;
      input.onStage?.(next);
    };
    try {
      const result = await submit({
        pool: guardedPool(input, action, prepared, (hash) => {
          broadcastHash = hash;
        }),
        signer: input.signer,
        expectedChainId: input.expectedChainId,
        data: prepared.data,
        witness: prepared.witness,
        proofTimeoutMs: input.proofTimeoutMs,
        onStage,
      });
      if (result.receipt.status === 0) {
        const changed = await changedAfterSubmit(input, prepared);
        throw new ShieldedLineageSubmissionError(
          `Shielded ${action} transaction ${result.transactionHash} reverted${changeDescription(changed)}. Inspect the receipt before another attempt.`,
          result.transactionHash,
          0,
        );
      }
      return { ...result, prepared, attempts: attempt };
    } catch (error) {
      if (
        error instanceof StaleLineageBeforeSubmit &&
        stage !== "submitting" &&
        stage !== "confirming"
      ) {
        if (attempt < maxAttempts) continue;
        throw new Error(
          `Lineage roots changed before submission; exhausted ${maxAttempts} attempts`,
        );
      }
      if (error instanceof ShieldedLineageSubmissionError) throw error;
      if (stage === "submitting" || stage === "confirming") {
        const changed = await changedAfterSubmit(input, prepared);
        throw new ShieldedLineageSubmissionError(
          broadcastHash
            ? `Shielded ${action} transaction ${broadcastHash} could not be confirmed${changeDescription(changed)}. Inspect its on-chain status before another attempt.`
            : `Shielded ${action} submission failed${changeDescription(changed)}. Check the wallet for a pending transaction before another attempt.`,
          broadcastHash,
          undefined,
          error,
        );
      }
      throw error;
    }
  }
  throw new Error("Lineage proof attempts exhausted");
}

/**
 * Reprepare on lineage changes detected before sending. A new lineage write can
 * still land between the final read and transaction inclusion; this remains a
 * release liveness blocker and cannot be guaranteed away by a frontend read.
 */
export function submitFundWithFreshLineage<T extends PreparedLineageAction>(
  input: FreshLineageSubmitInput<T>,
): Promise<FreshLineageSubmitResult<T>> {
  return submitWithFreshLineage(input, "fund");
}

/** Uses the same bounded refresh policy for an heir's self-submitted claim. */
export function submitClaimWithFreshLineage<T extends PreparedLineageAction>(
  input: FreshLineageSubmitInput<T>,
): Promise<FreshLineageSubmitResult<T>> {
  return submitWithFreshLineage(input, "claim");
}
