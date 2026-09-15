import { ConsentSection } from "../../shared/ConsentSection";
import type { MintConsents, MintNFTT } from "../model/mintNftTypes";

export interface MintConsentSectionProps {
  t: MintNFTT;
  consents: MintConsents;
  consentError: string | null;
  onToggleConsent: (key: keyof MintConsents) => void;
}

export function MintConsentSection({
  t,
  consents,
  consentError,
  onToggleConsent,
}: MintConsentSectionProps) {
  const items: Array<{ key: keyof MintConsents; label: string }> = [
    {
      key: "public",
      label: t(
        "mintNFT.consentPublic",
        "I understand this mint makes the entered info permanently public on-chain and undeletable.",
      ),
    },
    {
      key: "age",
      label: t("mintNFT.consentAge", "I confirm the person is 18 years or older."),
    },
    {
      key: "legal",
      label: t(
        "mintNFT.consentLegal",
        "I confirm the data is lawful, truthful, and authorized for public disclosure without extra private content.",
      ),
    },
  ];

  return (
    <ConsentSection
      title={t("mintNFT.consentTitle", "Informed consent (required)")}
      items={items}
      consents={consents}
      error={consentError}
      onToggle={onToggleConsent}
    />
  );
}
