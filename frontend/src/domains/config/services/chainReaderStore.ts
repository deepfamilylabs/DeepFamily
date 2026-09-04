const STORAGE_KEY = "ft:readerByChain";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export type ChainReaderMap = Record<string, string>;

function isChainId(chainId: number): boolean {
  return Number.isSafeInteger(chainId) && chainId > 0;
}

/**
 * The reader address last known to work on each chain.
 *
 * A reader is deployed per chain, so the one saved in config only means anything
 * against the RPC it was resolved through. Switching networks used to leave the
 * previous chain's address behind and quietly resolve nothing; this remembers
 * what answered where, so coming back to a chain restores its entrypoint.
 *
 * Only addresses that actually resolved are written — a guess never gets
 * recorded as if it were known.
 */
export function loadChainReaders(): ChainReaderMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([key, value]) => /^\d+$/.test(key) && typeof value === "string" && ADDRESS_RE.test(value),
    ) as [string, string][];
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function getChainReader(chainId: number): string {
  if (!isChainId(chainId)) return "";
  return loadChainReaders()[String(chainId)] || "";
}

export function rememberChainReader(chainId: number, readerAddress: string): void {
  if (!isChainId(chainId)) return;
  const normalized = (readerAddress || "").trim();
  if (!ADDRESS_RE.test(normalized)) return;

  const current = loadChainReaders();
  if (current[String(chainId)] === normalized) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...current, [String(chainId)]: normalized }),
    );
  } catch {
    /* ignore quota / serialization errors */
  }
}
