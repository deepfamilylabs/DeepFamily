import type {
  ShieldedFundingEntry,
  ShieldedWalletSummary,
} from "../../../shared/workers/shieldedAssetWorkerTypes";

export const SHIELDED_PERIOD_DAY_PRESETS = [1, 7, 14, 21, 30, 90, 180, 365] as const;

export const SHIELDED_FUNDING_ENTRY_KEYS: Record<
  ShieldedFundingEntry,
  { label: string; hint: string }
> = {
  public: { label: "publicEntry", hint: "publicHint" },
  privateConvenient: { label: "convenientEntry", hint: "convenientHint" },
  privateIndependent: { label: "independentEntry", hint: "independentHint" },
};

export type ShieldedFundingHeir = { personHash: string; label?: string };

/** Eligible children of the chosen parent version, plus every heir already on the arrangement. */
export function listShieldedFundingHeirs(
  wallet: ShieldedWalletSummary | null,
  policyHandle: string,
  fundingVersion: string,
  labels?: ReadonlyMap<string, string>,
): ShieldedFundingHeir[] {
  return Array.from(
    new Map(
      [
        ...(wallet?.children.filter(
          (child) => child.eligible && String(child.rootVersionIndex) === fundingVersion,
        ) ?? []),
        ...(wallet?.templates.filter((item) => item.policyHandle === policyHandle) ?? []),
      ].map((heir) => [
        heir.personHash.toLowerCase(),
        { personHash: heir.personHash, label: labels?.get(heir.personHash.toLowerCase()) },
      ]),
    ).values(),
  );
}

export function shieldedFundingEntryLabelKey(entry: ShieldedFundingEntry): string {
  return `shielded.walletKeys.${SHIELDED_FUNDING_ENTRY_KEYS[entry].label}`;
}
