import { useTranslation } from "react-i18next";
import {
  DATA_SOURCE_PROBLEM_TEXT,
  useDataSourceHealth,
  useNetworkName,
} from "../../domains/config";
import { useChainStatus, type ChainLiveness } from "./useChainStatus";

const DOT_CLASSES: Record<ChainLiveness, string> = {
  connecting: "bg-warning animate-pulse motion-reduce:animate-none",
  live: "bg-success",
  offline: "bg-danger",
};

/** The RPC answers, but what it was asked for is not there. */
const DEGRADED_DOT = "bg-warning";

export type ReadSourceStatus = {
  networkName: string;
  /** Head block of the read RPC, or null before the first successful poll. */
  blockNumber: number | null;
  /** The liveness word, or — when the RPC answers but the data does not — which data is missing. */
  stateLabel: string;
  /** The longer sentence behind `stateLabel`. */
  title: string;
  dotClassName: string;
};

/**
 * The read RPC's state, worded for the status bar's network chip.
 *
 * A live RPC is not the same as a usable data source — the reader or the root
 * can be absent on the chain just switched to — so when the endpoint answers but
 * the data behind it does not, the label says which, in place of the liveness
 * word, and the title carries the whole sentence.
 */
export function useReadSourceStatus(): ReadSourceStatus {
  const { t } = useTranslation();
  const { liveness, blockNumber } = useChainStatus();
  const health = useDataSourceHealth();
  const networkName = useNetworkName();

  const livenessLabel = {
    connecting: t("statusBar.connecting", "Connecting"),
    live: t("statusBar.live", "Live"),
    offline: t("statusBar.offline", "Offline"),
  }[liveness];

  // An unreachable RPC is its own explanation; only blame the data behind one
  // that is actually answering.
  const problem = liveness === "live" && !health.isChecking ? health.problem : null;
  const problemText = problem ? DATA_SOURCE_PROBLEM_TEXT[problem] : null;

  return {
    networkName,
    blockNumber,
    stateLabel: problemText ? t(problemText.labelKey, problemText.labelFallback) : livenessLabel,
    title: problemText
      ? t(problemText.detailKey, problemText.detailFallback)
      : t("statusBar.changeNetwork", "Change network"),
    dotClassName: problemText ? DEGRADED_DOT : DOT_CLASSES[liveness],
  };
}
