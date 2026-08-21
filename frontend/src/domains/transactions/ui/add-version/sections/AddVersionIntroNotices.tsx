import { AlertTriangle } from "lucide-react";
import type { AddVersionT } from "../model/addVersionTypes";

export function AddVersionIntroNotices({ t }: { t: AddVersionT }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="flex gap-3 rounded-2xl border border-amber-100 bg-amber-50/50 p-4 text-amber-900 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-100">
        <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
        <p className="text-xs font-medium leading-relaxed opacity-90">
          {t(
            "mintNFT.legalTruthfulNotice",
            "Submit only lawful, truthful information you are authorized to preserve. Encryption does not remove privacy, consent, or data-protection obligations.",
          )}
        </p>
      </div>
      <div className="flex gap-3 rounded-2xl border border-red-100 bg-red-50/50 p-4 text-red-900 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-100">
        <AlertTriangle className="w-5 h-5 shrink-0 text-red-500" />
        <p className="text-xs font-medium leading-relaxed opacity-90">
          {t(
            "addVersion.ageRequirement",
            "The person being added must be 18 years or older. Do not submit minors' identities.",
          )}
        </p>
      </div>
    </div>
  );
}
