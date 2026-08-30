import { AlertTriangle, Shield } from "lucide-react";
import { ConsentCheckbox } from "../../shared/ConsentCheckbox";
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
    <div className="p-4 rounded-xl border border-hairline bg-surface">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-[10px] bg-danger/12 flex items-center justify-center shrink-0">
          <Shield className="w-[18px] h-[18px] text-danger" aria-hidden />
        </div>
        <div className="space-y-3 w-full pt-1">
          <p className="text-[13px] font-semibold text-ink">
            {t("mintNFT.consentTitle", "Informed consent (required)")}
          </p>
          <div className="space-y-2">
            {items.map((item) => (
              <ConsentCheckbox
                key={item.key}
                checked={consents[item.key]}
                onChange={() => onToggleConsent(item.key)}
              >
                {item.label}
              </ConsentCheckbox>
            ))}
          </div>
          {consentError && (
            <div
              className="flex items-center gap-2 p-3 rounded-lg bg-danger/15 border border-danger/25 animate-fade-in"
              role="alert"
              aria-live="assertive"
            >
              <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-300 font-bold">{consentError}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
