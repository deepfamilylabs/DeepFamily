import { useEffect, useMemo, useState } from "react";
import { usePersonGateway } from "../../../person";
import { useConfig } from "../../context";
import { isHash32, summarizeDataSourceHealth } from "../../model";
import type { DataSourceHealth, RootHealth } from "../../model";

/**
 * Whether the configured data source actually holds anything on the chain it is
 * currently pointed at.
 *
 * A reader address and a root hash only mean something against one chain, so a
 * network switch can leave both naming nothing — and that failure looks exactly
 * like a family with no records yet. This asks the chain both questions so the
 * status bar can say which, instead of showing a healthy RPC over an empty tree.
 *
 * The root is only asked about once the reader has resolved: without a working
 * reader the question cannot be put at all, and a thrown call would read as "the
 * root is missing" when the truth is that nothing was ever asked.
 *
 * One caller — the status bar chip. Keep it that way, or the probe below runs
 * once per mounted consumer.
 */
export function useDataSourceHealth(): DataSourceHealth {
  const { readerAddress, contractAddress, moduleResolutionError, rootHash, rootVersionIndex } =
    useConfig();
  const gateway = usePersonGateway();
  const [root, setRoot] = useState<RootHealth>("idle");

  const rootIsAskable = Boolean(gateway) && Boolean(contractAddress) && isHash32(rootHash);

  useEffect(() => {
    if (!gateway || !rootIsAskable) {
      setRoot("idle");
      return;
    }

    let cancelled = false;
    setRoot("checking");

    void (async () => {
      try {
        // One row is enough — the total rides along with the page.
        const { totalVersions } = await gateway.listVersionEndorsements(rootHash, 0, 1);
        if (cancelled) return;
        if (totalVersions <= 0) {
          setRoot("missing");
        } else if (rootVersionIndex > totalVersions) {
          setRoot("versionMissing");
        } else {
          setRoot("ok");
        }
      } catch {
        if (!cancelled) setRoot("unreachable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gateway, rootIsAskable, rootHash, rootVersionIndex]);

  return useMemo(
    () =>
      summarizeDataSourceHealth({
        readerAddress,
        contractAddress,
        moduleResolutionError,
        root,
      }),
    [readerAddress, contractAddress, moduleResolutionError, root],
  );
}
