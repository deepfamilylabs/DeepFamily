import { ConsentSection } from "../../shared/ConsentSection";
import type { AddVersionConsents, AddVersionT } from "../model/addVersionTypes";

interface AddVersionConsentSectionProps {
  t: AddVersionT;
  consents: AddVersionConsents;
  consentError: string | null;
  onToggleConsent: (key: keyof AddVersionConsents) => void;
}

export function AddVersionConsentSection({
  t,
  consents,
  consentError,
  onToggleConsent,
}: AddVersionConsentSectionProps) {
  const items: Array<{ key: keyof AddVersionConsents; label: string }> = [
    {
      key: "hash",
      label: t(
        "addVersion.consentHash",
        "I understand this version's encrypted content and its verification values go on-chain permanently and cannot be deleted or modified.",
      ),
    },
    {
      key: "legal",
      label: t(
        "addVersion.consentLegal",
        "I confirm the data is lawful, truthful, and authorized for disclosure; no extra private content is included.",
      ),
    },
    {
      key: "passphrase",
      label: t(
        "addVersion.consentPassphrase",
        "I understand anyone can guess the passphrase offline, without limit or deadline; the weaker it is the easier the content is to unlock, and an empty one is the same as no encryption at all.",
      ),
    },
  ];

  return (
    <ConsentSection
      title={t("addVersion.consentTitle", "Informed consent (required)")}
      items={items}
      consents={consents}
      error={consentError}
      onToggle={onToggleConsent}
    />
  );
}
