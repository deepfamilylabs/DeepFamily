import type {
  ShieldedFundingChild,
  ShieldedFundingEntry,
  ShieldedPolicySummary,
  ShieldedTemplateSummary,
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

export type ShieldedFundingHeir = { personHash: string; identitySuiteId?: number; label?: string };

/** Initial funding and refills require a current direct-child endorsement trusted by the selected parent version. */
export function listShieldedFundingHeirs(
  family: { children: readonly ShieldedFundingChild[] } | null | undefined,
  fundingVersion: string,
  labels?: ReadonlyMap<string, string>,
  funding?: {
    policy?: ShieldedPolicySummary;
    templates?: readonly ShieldedTemplateSummary[];
  },
): ShieldedFundingHeir[] {
  let refillHeirs: Set<string> | undefined;
  if (funding?.policy?.refillOnly) {
    const handle = funding.policy.handle;
    refillHeirs = new Set(
      funding.templates
        ?.filter((template) => template.policyHandle === handle)
        .map((template) => template.personHash.toLowerCase()),
    );
  }
  const children =
    family?.children.filter(
      (child) =>
        child.eligible &&
        String(child.rootVersionIndex) === fundingVersion &&
        (!refillHeirs || refillHeirs.has(child.personHash.toLowerCase())),
    ) ?? [];
  return children.map(({ personHash, identitySuiteId }) => ({
    personHash,
    identitySuiteId,
    label: labels?.get(personHash.toLowerCase()),
  }));
}

export function shieldedFundingEntryLabelKey(entry: ShieldedFundingEntry): string {
  return `shielded.walletKeys.${SHIELDED_FUNDING_ENTRY_KEYS[entry].label}`;
}
