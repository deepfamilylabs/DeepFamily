import {
  classifyTreeRootCheckError,
  classifyTreeSessionConnectionError,
  type TreeSessionStatus,
} from "./treeSessionErrors";
import { ensureTreeProviderReady, ensureTreeRootExists } from "./treeSessionPreflight";

export type TreeSessionStartupResult =
  | { ok: true }
  | {
      ok: false;
      stage: "provider" | "root";
      status: TreeSessionStatus;
      isRootInvalid: boolean;
      error: unknown;
    };

export async function verifyTreeSessionStartup(options: {
  provider: unknown;
  api: any;
  rootHash: string;
  rootVersionIndex: number;
  versionDetailsTtlMs: number;
}): Promise<TreeSessionStartupResult> {
  try {
    await ensureTreeProviderReady(options.provider);
  } catch (error) {
    return {
      ok: false,
      stage: "provider",
      status: classifyTreeSessionConnectionError(error),
      isRootInvalid: false,
      error,
    };
  }

  try {
    if (!options.api) throw new Error("Contract not ready");
    await ensureTreeRootExists({
      api: options.api,
      rootHash: options.rootHash,
      rootVersionIndex: options.rootVersionIndex,
      versionDetailsTtlMs: options.versionDetailsTtlMs,
    });
    return { ok: true };
  } catch (error) {
    const { status, isRootInvalid } = classifyTreeRootCheckError(error);
    return {
      ok: false,
      stage: "root",
      status,
      isRootInvalid,
      error,
    };
  }
}
