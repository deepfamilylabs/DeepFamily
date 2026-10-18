import type { Provider } from "ethers";
import { getEventScanConfig } from "../../../shared/config/env";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";

/** Public data retained when a wallet submission outlasts its secret session. */
export interface ShieldedSubmissionTracking {
  provider: Provider;
  chainId: bigint;
  hash?: string;
  nonce?: number;
  signerAddress?: string;
  fromBlock?: number;
  pool?: ShieldedPageModules["pool"];
  outputCommitments?: string[];
}

export type ShieldedSubmissionOutcome =
  | { status: "pending"; hash?: string }
  | { status: "confirmed"; hash: string; receiptStatus: number }
  | { status: "replaced" };

/** Reads public chain state without changing the caller's tracking record. */
export async function readShieldedSubmissionOutcome(
  tracked: ShieldedSubmissionTracking,
): Promise<ShieldedSubmissionOutcome> {
  if ((await tracked.provider.getNetwork()).chainId !== tracked.chainId)
    return { status: "pending", ...(tracked.hash ? { hash: tracked.hash } : {}) };

  const knownReceipt = tracked.hash
    ? await tracked.provider.getTransactionReceipt(tracked.hash)
    : null;
  if (tracked.hash && knownReceipt && knownReceipt.status !== null)
    return { status: "confirmed", hash: tracked.hash, receiptStatus: knownReceipt.status };

  // A replacement never gives the original hash a receipt. Recover its public
  // outputs before interpreting a consumed nonce as a cancellation.
  const toBlock = await tracked.provider.getBlockNumber();
  let hash: string | undefined;
  if (tracked.pool && tracked.fromBlock !== undefined && tracked.outputCommitments?.length) {
    // Fetch every public output, then match locally. Filtering the RPC request
    // by a private note or nullifier would reveal which funds are being tracked.
    const blockChunk = Math.max(1, getEventScanConfig().blockChunk);
    if (!Number.isSafeInteger(blockChunk))
      throw new Error("Invalid shielded submission scan block range");
    const filter = tracked.pool.filters.NoteAppended();
    const matches = new Map<string, Set<string>>();
    for (let start = tracked.fromBlock; start <= toBlock; start += blockChunk) {
      const logs = await tracked.pool.queryFilter(
        filter,
        start,
        Math.min(toBlock, start + blockChunk - 1),
      );
      for (const log of logs) {
        if (!("args" in log)) continue;
        const commitment = String(log.args.commitment);
        if (!tracked.outputCommitments.includes(commitment)) continue;
        const outputs = matches.get(log.transactionHash) ?? new Set<string>();
        outputs.add(commitment);
        matches.set(log.transactionHash, outputs);
      }
    }
    hash = [...matches].find(([, outputs]) =>
      tracked.outputCommitments!.every((commitment) => outputs.has(commitment)),
    )?.[0];
  }
  if (!hash) {
    if (
      tracked.signerAddress &&
      tracked.nonce !== undefined &&
      (await tracked.provider.getTransactionCount(tracked.signerAddress, toBlock)) > tracked.nonce
    )
      return { status: "replaced" };
    return { status: "pending", ...(tracked.hash ? { hash: tracked.hash } : {}) };
  }

  // Matching outputs establish which transaction mined even if its receipt is
  // temporarily unavailable; a nonce check must not override that evidence.
  const receipt =
    hash === tracked.hash ? knownReceipt : await tracked.provider.getTransactionReceipt(hash);
  return !receipt || receipt.status === null
    ? { status: "pending", hash }
    : { status: "confirmed", hash, receiptStatus: receipt.status };
}
