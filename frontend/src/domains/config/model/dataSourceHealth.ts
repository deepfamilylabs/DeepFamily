/** How the entry reader is doing on the chain currently configured. */
export type ReaderHealth = "unset" | "checking" | "ok" | "unreachable";

/** Whether the configured root person is actually on that chain. */
export type RootHealth = "idle" | "checking" | "ok" | "missing" | "versionMissing" | "unreachable";

/**
 * The one thing worth telling the user, worst first. `null` means the network,
 * the reader and the root all line up.
 */
export type DataSourceProblem =
  | "readerUnset"
  | "readerUnreachable"
  | "rootMissing"
  | "rootVersionMissing"
  | "rootUnreachable";

export type DataSourceHealth = {
  reader: ReaderHealth;
  root: RootHealth;
  problem: DataSourceProblem | null;
  /** An answer is still on its way; say nothing yet rather than blaming a chain. */
  isChecking: boolean;
};

export type DataSourceHealthInput = {
  readerAddress: string;
  /** Non-empty once the reader has resolved the main contract behind it. */
  contractAddress: string;
  moduleResolutionError: string | null;
  root: RootHealth;
};

/**
 * Reads a network switch's aftermath as one verdict.
 *
 * Reader and root fail for unrelated reasons but present the same way — an empty
 * tree — so they are diagnosed in order: an unreachable reader explains a root
 * that cannot be found, and reporting both would name a consequence as a cause.
 */
export function summarizeDataSourceHealth(input: DataSourceHealthInput): DataSourceHealth {
  const reader: ReaderHealth = !input.readerAddress.trim()
    ? "unset"
    : input.moduleResolutionError
      ? "unreachable"
      : input.contractAddress
        ? "ok"
        : "checking";

  const root = reader === "ok" ? input.root : "idle";
  const isChecking = reader === "checking" || root === "checking";

  const problem = ((): DataSourceProblem | null => {
    if (reader === "unset") return "readerUnset";
    if (reader === "unreachable") return "readerUnreachable";
    if (root === "missing") return "rootMissing";
    if (root === "versionMissing") return "rootVersionMissing";
    if (root === "unreachable") return "rootUnreachable";
    return null;
  })();

  return { reader, root, problem, isChecking };
}
