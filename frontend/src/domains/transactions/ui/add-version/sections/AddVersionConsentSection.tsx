import { AlertTriangle, Shield } from "lucide-react";
import { ConsentCheckbox } from "../../shared/ConsentCheckbox";
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
    <div className="p-5 rounded-2xl border border-red-200/50 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10 backdrop-blur-sm mt-4!">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-red-600 dark:text-red-400" />
        </div>
        <div className="space-y-3 w-full pt-1">
          <p className="text-sm font-bold text-gray-900 dark:text-red-100">
            {t("addVersion.consentTitle", "Informed consent (required)")}
          </p>

          <div className="space-y-2 pt-1">
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
