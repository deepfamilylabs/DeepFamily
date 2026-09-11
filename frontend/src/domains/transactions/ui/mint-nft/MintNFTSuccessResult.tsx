import { TransactionSuccessSummary, type SuccessRow } from "../shared/TransactionSuccessSummary";

type MintNFTSuccessResultProps = {
  t: (key: string, fallback: string) => string;
  successResult: {
    tokenId: number;
    personHash: string;
    versionIndex: number;
    transactionHash: string;
  };
};

export function MintNFTSuccessResult({ t, successResult }: MintNFTSuccessResultProps) {
  const rows: SuccessRow[] = [
    { label: t("transaction.rowTokenId", "Token ID"), value: `#${successResult.tokenId}` },
    { label: t("transaction.rowHash", "Hash"), value: successResult.personHash, mono: true },
    { label: t("transaction.rowVersion", "Version"), value: String(successResult.versionIndex) },
    {
      label: t("transaction.rowTransaction", "Transaction"),
      value: successResult.transactionHash,
      mono: true,
    },
  ];

  return (
    <TransactionSuccessSummary
      t={t}
      title={t("mintNFT.successTitle", "NFT Minted Successfully")}
      description={t("mintNFT.successDesc", "Your NFT has been created on the blockchain")}
      rows={rows}
    />
  );
}
