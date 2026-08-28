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
    <div className="p-5 rounded-2xl border border-red-200/50 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10 backdrop-blur-sm mt-8!">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-red-600 dark:text-red-400" />
        </div>
        <div className="space-y-3 w-full pt-1">
          <p className="text-sm font-bold text-gray-900 dark:text-red-100">
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
              className="flex items-center gap-2 p-3 rounded-lg bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800 animate-fade-in"
              role="alert"
              aria-live="assertive"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-300 font-bold">{consentError}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
