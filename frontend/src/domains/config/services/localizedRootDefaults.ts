import { getLocalizedRootHash, getLocalizedRootVersionIndex } from "../../../shared/config/env";

type RootDefaults = {
  rootHash: string;
  rootVersionIndex: number;
};

type RootLocaleSuffix = "EN" | "ZH";

const ROOT_LOCALE_SUFFIXES: RootLocaleSuffix[] = ["EN", "ZH"];

function isHash32(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value.trim());
}

function normalizeHash(value: string | undefined | null): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function getRootLocaleSuffix(language: string | undefined | null): RootLocaleSuffix {
  const normalized = String(language || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return normalized.startsWith("zh") ? "ZH" : "EN";
}

export function getLocalizedDefaultRoot(
  language: string | undefined | null,
  defaults: RootDefaults,
) {
  const suffix = getRootLocaleSuffix(language);
  const localizedHash = getLocalizedRootHash(suffix).trim();
  const localizedVersion = getLocalizedRootVersionIndex(suffix);

  return {
    hash: isHash32(localizedHash) ? localizedHash : defaults.rootHash,
    version:
      Number.isFinite(localizedVersion) && localizedVersion > 0
        ? localizedVersion
        : defaults.rootVersionIndex,
    suffix,
  };
}

export function getKnownDefaultRootHashes(defaults: RootDefaults): string[] {
  const hashes = [
    defaults.rootHash,
    ...ROOT_LOCALE_SUFFIXES.map((suffix) => getLocalizedRootHash(suffix)),
  ];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const hash of hashes) {
    const normalized = normalizeHash(hash);
    if (!normalized || !isHash32(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

export function shouldAutoSwitchLocalizedRoot(params: {
  currentRootHash: string | undefined | null;
  defaults: RootDefaults;
}): boolean {
  const current = normalizeHash(params.currentRootHash);
  if (!current) return true;
  return getKnownDefaultRootHashes(params.defaults).includes(current);
}
