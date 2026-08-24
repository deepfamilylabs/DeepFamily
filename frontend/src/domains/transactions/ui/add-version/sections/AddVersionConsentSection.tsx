import { AlertTriangle, Shield } from "lucide-react";
import { ConsentCheckbox } from "../../shared/ConsentCheckbox";
import { PASSPHRASE_RISK_CONSENT_KEYS } from "../model/addVersionPassphraseConsent";
import type {
  AddVersionConsents,
  AddVersionIdentityRole,
  AddVersionPassphraseConsentContext,
  AddVersionPassphraseRisk,
  AddVersionT,
} from "../model/addVersionTypes";

interface AddVersionConsentSectionProps {
  t: AddVersionT;
  consents: AddVersionConsents;
  passphraseContext: AddVersionPassphraseConsentContext;
  consentError: string | null;
  onToggleConsent: (key: keyof AddVersionConsents) => void;
}

function riskConsentLabel(
  t: AddVersionT,
  role: AddVersionIdentityRole,
  risk: Exclude<AddVersionPassphraseRisk, "ordinary">,
): string {
  if (risk === "unicode-whitespace") {
    const labels = {
      person: t(
        "addVersion.consentPersonWhitespacePassphrase",
        "I explicitly accept that this person's identity passphrase consists only of Unicode White_Space after NFKD normalization. It is not trimmed, but it is highly guessable and cannot provide meaningful secrecy.",
      ),
      father: t(
        "addVersion.consentFatherWhitespacePassphrase",
        "I explicitly accept that the father's identity passphrase consists only of Unicode White_Space after NFKD normalization. It is not trimmed, but it is highly guessable and cannot provide meaningful identity protection.",
      ),
      mother: t(
        "addVersion.consentMotherWhitespacePassphrase",
        "I explicitly accept that the mother's identity passphrase consists only of Unicode White_Space after NFKD normalization. It is not trimmed, but it is highly guessable and cannot provide meaningful identity protection.",
      ),
    };
    return labels[role];
  }

  const labels = {
    person: t(
      "addVersion.consentPersonEmptyPassphrase",
      "I explicitly choose an empty identity passphrase for this person. Anyone can decrypt every envelope with one file Argon2id run and, once the identity fields are known, reproduce the identity witness with one identity Argon2id run reused across versions. AES-256-GCM cannot restore secrecy, and this identity choice cannot be changed or recovered.",
    ),
    father: t(
      "addVersion.consentFatherEmptyPassphrase",
      "I explicitly choose an empty identity passphrase for the father. Anyone who knows the identity fields can reproduce this identity witness, AES-256-GCM cannot restore missing passphrase entropy, and this identity choice cannot be changed or recovered.",
    ),
    mother: t(
      "addVersion.consentMotherEmptyPassphrase",
      "I explicitly choose an empty identity passphrase for the mother. Anyone who knows the identity fields can reproduce this identity witness, AES-256-GCM cannot restore missing passphrase entropy, and this identity choice cannot be changed or recovered.",
    ),
  };
  return labels[role];
}

export function AddVersionConsentSection({
  t,
  consents,
  passphraseContext,
  consentError,
  onToggleConsent,
}: AddVersionConsentSectionProps) {
  const items: Array<{ key: keyof AddVersionConsents; label: string }> = [
    {
      key: "hash",
      label: t(
        "addVersion.consentHash",
        "I understand the encrypted envelope, its payload hash, and a keyed version commitment are permanently public on-chain and cannot be removed.",
      ),
    },
    {
      key: "age",
      label: t("addVersion.consentAge", "I confirm the person is 18 years or older."),
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
        "I understand anyone can permanently attempt offline passphrase guesses. An empty passphrase makes the encrypted metadata effectively public, and AES cannot restore missing entropy.",
      ),
    },
  ];

  for (const role of ["person", "father", "mother"] as const) {
    const risk = passphraseContext.risks[role];
    if (!passphraseContext.present[role] || risk === "ordinary") continue;
    items.push({
      key: PASSPHRASE_RISK_CONSENT_KEYS[role],
      label: riskConsentLabel(t, role, risk),
    });
  }

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
