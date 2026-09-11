import { TransactionSuccessSummary, type SuccessRow } from "../shared/TransactionSuccessSummary";

type EndorseSuccessResultProps = {
  t: (key: string, fallback: string) => string;
  successResult: {
    personHash: string;
    versionIndex: number;
    endorsementFee: string;
    transactionHash: string;
  };
  deepTokenDecimals: number;
  deepTokenSymbol: string;
};

export function EndorseSuccessResult({
  t,
  successResult,
  deepTokenSymbol,
}: EndorseSuccessResultProps) {
  const rows: SuccessRow[] = [
    { label: t("transaction.rowHash", "Hash"), value: successResult.personHash, mono: true },
    { label: t("transaction.rowVersion", "Version"), value: String(successResult.versionIndex) },
    {
      label: t("transaction.rowFee", "Fee"),
      value: `${successResult.endorsementFee} ${deepTokenSymbol}`,
    },
    {
      label: t("transaction.rowTransaction", "Transaction"),
      value: successResult.transactionHash,
      mono: true,
    },
  ];

  return (
    <TransactionSuccessSummary
      t={t}
      title={t("endorse.successTitle", "Endorsement Successful")}
      description={t("endorse.successDesc", "Your endorsement has been recorded on-chain")}
      rows={rows}
    />
  );
}
