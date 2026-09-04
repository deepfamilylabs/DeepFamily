import type { DataSourceProblem } from "../model";

export type DataSourceProblemText = {
  /** Fits the status bar chip, in place of the liveness word. */
  labelKey: string;
  labelFallback: string;
  /** The whole sentence, for the network menu and the switch announcement. */
  detailKey: string;
  detailFallback: string;
};

/**
 * One wording per problem, so the chip and its tooltip never describe the same
 * broken data source differently.
 *
 * None of them name the chain: the chip does, an inch away, and a name spliced
 * mid-sentence lands badly in Chinese — one that ends in Han characters leaves a
 * stray space before whatever particle follows it.
 */
export const DATA_SOURCE_PROBLEM_TEXT: Record<DataSourceProblem, DataSourceProblemText> = {
  readerUnset: {
    labelKey: "dataSource.readerUnset",
    labelFallback: "No contract set",
    detailKey: "dataSource.readerUnsetDetail",
    detailFallback: "No contract address is configured for this network",
  },
  readerUnreachable: {
    labelKey: "dataSource.readerUnreachable",
    labelFallback: "Contract not found",
    detailKey: "dataSource.readerUnreachableDetail",
    detailFallback: "No contract is deployed at the configured address",
  },
  rootMissing: {
    labelKey: "dataSource.rootMissing",
    labelFallback: "Root not found",
    detailKey: "dataSource.rootMissingDetail",
    detailFallback:
      "This root person is not recorded on this network. Pick another root in family settings",
  },
  rootVersionMissing: {
    labelKey: "dataSource.rootVersionMissing",
    labelFallback: "Root version missing",
    detailKey: "dataSource.rootVersionMissingDetail",
    detailFallback:
      "The root person is here, but not the version selected. Pick a version in family settings",
  },
  rootUnreachable: {
    labelKey: "dataSource.rootUnreachable",
    labelFallback: "Root check failed",
    detailKey: "dataSource.rootUnreachableDetail",
    detailFallback: "The root person could not be checked. The RPC may be flaky",
  },
};
