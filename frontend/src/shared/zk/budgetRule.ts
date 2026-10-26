/**
 * A budget rule is public text that a qualified family member shares with payers.
 * The wallet Worker validates it against the selected pool; the page only reads
 * its schedule to preview a deposit.
 */
export const BUDGET_RULE_FIELDS = [
  "familyCommitment",
  "parentVersion",
  "rate",
  "periodDays",
  "policySalt",
  "allocationKeyCommitment",
] as const;
export type BudgetRulePolicy = Record<(typeof BUDGET_RULE_FIELDS)[number], bigint>;
export interface BudgetRule {
  chainId: string;
  poolAddress: string;
  policy: BudgetRulePolicy;
}

const PREFIX = "dfpolicy.";
const MAX_RULE_LENGTH = 4096;

export function encodeBudgetRule(rule: Record<string, string>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(rule));
  return `${PREFIX}${btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "")}`;
}

export function decodeBudgetRule(encoded: string): BudgetRule {
  const text = encoded.trim();
  if (!text.startsWith(PREFIX) || text.length > MAX_RULE_LENGTH)
    throw new Error("Invalid receiving budget rule");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(
      atob(text.slice(PREFIX.length).replace(/-/gu, "+").replace(/_/gu, "/")),
    ) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid receiving budget rule");
  }
  if (typeof raw.chainId !== "string" || typeof raw.poolAddress !== "string")
    throw new Error("Invalid receiving budget rule");
  const policy = Object.fromEntries(
    BUDGET_RULE_FIELDS.map((name) => {
      const value = raw[name];
      if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value))
        throw new Error("Invalid receiving budget rule");
      return [name, BigInt(value)];
    }),
  ) as BudgetRulePolicy;
  return { chainId: raw.chainId, poolAddress: raw.poolAddress, policy };
}
