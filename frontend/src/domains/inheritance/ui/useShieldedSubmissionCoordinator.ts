import { useRef, type MutableRefObject } from "react";
import type { Provider } from "ethers";
import { getChainErrorDetails } from "@deepfamily/chain-client";
import { useTransactionCenter } from "../../transactions";
import type { ShieldedSubmissionTracking } from "../services/shieldedSubmissionTracking";
import type { ShieldedSubmissionAnchor } from "../services/shieldedWalletSubmission";

export type ShieldedTrackedSubmission = ShieldedSubmissionTracking & {
  id: string; label: string; kind: "action" | "approval" | "authorization";
};

type SubmissionSpec = Pick<ShieldedTrackedSubmission, "id" | "label" | "kind"> &
  Partial<Pick<ShieldedTrackedSubmission, "pool" | "outputCommitments">>;

/** Coordinate public records without retaining credentials, private notes, or witnesses. */
export function useShieldedSubmissionCoordinator(input: {
  chainId: bigint;
  poolAddress: string;
  tracking: MutableRefObject<ShieldedTrackedSubmission | null>;
  isCurrent: () => boolean;
  onPending: (tracking: ShieldedTrackedSubmission) => void;
  onSettled: (tracking: ShieldedTrackedSubmission, status: number) => void;
  onRejected: () => void;
}) {
  const centre = useTransactionCenter();
  const latestCentre = useRef(centre);
  latestCentre.current = centre;
  return {
    capture(spec: SubmissionSpec, provider: Provider) {
      const record = { ...spec, provider, chainId: input.chainId };
      let local: ShieldedTrackedSubmission = record;
      const onSubmitting = (anchor: ShieldedSubmissionAnchor) => {
        local = { ...record, ...anchor };
        latestCentre.current?.upsert({
          id: spec.id, kind: "shielded", label: spec.label, phase: "busy",
          shieldedSubmission: {
            chainId: String(input.chainId), poolAddress: input.poolAddress, kind: spec.kind,
            ...anchor, ...(spec.outputCommitments ? { outputCommitments: spec.outputCommitments } : {}),
          },
        });
        if (!input.isCurrent()) return;
        input.tracking.current = local;
        input.onPending(local);
      };
      const onBroadcast = (hash: string) => {
        local = { ...local, hash };
        latestCentre.current?.upsert({
          id: spec.id, kind: "shielded", label: spec.label, phase: "busy", transactionHash: hash,
        });
        if (!input.isCurrent() || (input.tracking.current && input.tracking.current.id !== spec.id)) return;
        input.tracking.current = local;
        input.onPending(local);
      };
      return {
        onSubmitting,
        onBroadcast,
        onReceipt(hash: string, status: number | null) {
          if (status === null) return;
          latestCentre.current?.upsert({
            id: spec.id, kind: "shielded", label: spec.label,
            phase: status === 1 ? "done" : "failed", transactionHash: hash, error: null,
          });
          if (!input.isCurrent() || input.tracking.current?.id !== spec.id) return;
          input.tracking.current = null;
          input.onSettled({ ...local, hash }, status);
        },
        onError(cause: unknown) {
          const context = getChainErrorDetails(cause);
          if (context.transactionHash) onBroadcast(context.transactionHash);
          if (local.hash) return;
          const error = cause && typeof cause === "object" ? cause as Record<string, unknown> : undefined;
          if (error?.receipt || (error?.info as any)?.sendTransactionHash) return;
          const estimationFailed = context.category === "validation" && context.operation === "estimate";
          const walletRequestPending = context.category === "wallet" && context.code === "WALLET_REQUEST_PENDING";
          if (context.category !== "cancelled" && context.code !== "INSUFFICIENT_FUNDS" && !estimationFailed && !walletRequestPending) return;
          latestCentre.current?.upsert({ id: spec.id, kind: "shielded", label: spec.label, phase: "failed" });
          if (input.isCurrent() && input.tracking.current?.id === spec.id) {
            input.tracking.current = null;
            input.onRejected();
          }
        },
      };
    },
  };
}
