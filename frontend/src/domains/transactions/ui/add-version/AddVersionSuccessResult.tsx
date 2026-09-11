import { ethers } from "ethers";
import { TransactionSuccessSummary, type SuccessRow } from "../shared/TransactionSuccessSummary";

type AddVersionT = (key: string, fallback: string, options?: Record<string, unknown>) => string;

type AddVersionSuccessResultProps = {
  t: AddVersionT;
  successResult: {
    hash: string;
    index: number;
    rewardAmount: string | number | bigint;
    transactionHash: string;
    events: { PersonVersionAdded?: any };
  };
};

export function AddVersionSuccessResult({ t, successResult }: AddVersionSuccessResultProps) {
  const added = successResult.events.PersonVersionAdded;
  const reward = formatReward(successResult.rewardAmount);

  const rows: SuccessRow[] = [
    { label: t("transaction.rowHash", "Hash"), value: successResult.hash, mono: true },
    { label: t("transaction.rowVersion", "Version"), value: String(successResult.index) },
    // A version is a node and its two edges; the edges are what a genealogy is
    // made of, so they belong here — but only where a link actually exists.
    ...parentRow(t, t("transaction.rowFather", "Father"), added?.fatherHash, added?.fatherVersionIndex),
    ...parentRow(t, t("transaction.rowMother", "Mother"), added?.motherHash, added?.motherVersionIndex),
    // Only when something was actually mined: a zero row is not a result.
    ...(reward ? [{ label: t("transaction.rowReward", "Reward"), value: `${reward} DEEP` }] : []),
    {
      label: t("transaction.rowTransaction", "Transaction"),
      value: successResult.transactionHash,
      mono: true,
    },
  ];

  return (
    <TransactionSuccessSummary
      t={t}
      title={t("addVersion.successTitle", "Version Added Successfully")}
      description={t("addVersion.successDesc", "The person version has been added to the blockchain")}
      rows={rows}
    />
  );
}

function parentRow(
  t: AddVersionT,
  label: string,
  hash: unknown,
  versionIndex: unknown,
): SuccessRow[] {
  const value = typeof hash === "string" ? hash : "";
  if (!value || value === ethers.ZeroHash) return [];
  const pinned = Number(versionIndex ?? 0);
  return [
    {
      label,
      // Index 0 means the link names the person, not one of their versions, so
      // there is nothing to say about it.
      value: pinned
        ? `${value} · ${t("transaction.rowVersionSuffix", "version {{index}}", { index: pinned })}`
        : value,
      mono: true,
      copyValue: value,
    },
  ];
}

function formatReward(amount: string | number | bigint) {
  try {
    const raw = BigInt(amount ?? 0);
    if (raw === 0n) return null;
    return Number(ethers.formatUnits(raw, 18)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  } catch {
    return null;
  }
}
