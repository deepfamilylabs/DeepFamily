import { Lock } from "lucide-react";
import type { UseFormRegister } from "react-hook-form";
import type { AddVersionFormInput, AddVersionT } from "../model/addVersionTypes";

export interface MetadataEncryptionSectionProps {
  t: AddVersionT;
  register: UseFormRegister<AddVersionFormInput>;
  isSubmitting: boolean;
}

export function MetadataEncryptionSection({
  t,
  register,
  isSubmitting,
}: MetadataEncryptionSectionProps) {
  return (
    <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800 mt-2!">
      <div className="space-y-2">
        <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
          {t("addVersion.tag", "Revision label")}
        </label>
        <input
          {...register("tag")}
          disabled={isSubmitting}
          className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-hidden transition-all disabled:opacity-60"
          placeholder={t("addVersion.tagPlaceholder", "Optional private revision label")}
        />
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {t(
            "addVersion.tagPrivateNotice",
            "The label is encrypted with the biography and is not searchable on-chain.",
          )}
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
          {t("addVersion.biography", "Private version biography")}
        </label>
        <textarea
          {...register("biography")}
          disabled={isSubmitting}
          rows={8}
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-hidden transition-all disabled:opacity-60 whitespace-pre-wrap"
          placeholder={t(
            "addVersion.biographyPlaceholder",
            "This immutable biography is encrypted on this device before it is stored on-chain.",
          )}
        />
      </div>

      <div className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-900/10 p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Lock className="w-4 h-4" />
          </div>
          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
            {t(
              "addVersion.unifiedPassphraseNotice",
              "Your identity passphrase also unlocks this version's person, parent, label, and biography data. No separate metadata password or CID is created. The final DFM1 envelope is written on-chain in the same transaction.",
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
