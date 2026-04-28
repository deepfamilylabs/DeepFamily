import type { Ref } from "react";
import { AlertTriangle, Download, Eye, EyeOff, Lock } from "lucide-react";
import type { UseFormRegister } from "react-hook-form";
import type { AddVersionFormInput, AddVersionT } from "../model/addVersionTypes";

export interface MetadataEncryptionSectionProps {
  t: AddVersionT;
  register: UseFormRegister<AddVersionFormInput>;
  isSubmitting: boolean;
  personHasPassphrase: boolean;
  encryptionPasswordRef: Ref<HTMLInputElement>;
  confirmEncryptionPasswordRef: Ref<HTMLInputElement>;
  encryptionError: string | null;
  usePersonPassphraseForEncryption: boolean;
  showEncryptionPassword: boolean;
  showConfirmEncryptionPassword: boolean;
  showManualEncryptionInputs: boolean;
  onUsePersonPassphraseForEncryptionChange: (checked: boolean) => void;
  onEncryptionErrorClear: () => void;
  onToggleEncryptionPassword: () => void;
  onToggleConfirmEncryptionPassword: () => void;
  onDownloadMetadata: () => void;
}

export function MetadataEncryptionSection({
  t,
  register,
  isSubmitting,
  personHasPassphrase,
  encryptionPasswordRef,
  confirmEncryptionPasswordRef,
  encryptionError,
  usePersonPassphraseForEncryption,
  showEncryptionPassword,
  showConfirmEncryptionPassword,
  showManualEncryptionInputs,
  onUsePersonPassphraseForEncryptionChange,
  onEncryptionErrorClear,
  onToggleEncryptionPassword,
  onToggleConfirmEncryptionPassword,
  onDownloadMetadata,
}: MetadataEncryptionSectionProps) {
  return (
    <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800 !mt-2">
      <div className="space-y-2">
        <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
          {t("addVersion.tag", "Tag")}
        </label>
        <input
          {...register("tag")}
          className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all"
          placeholder={t("addVersion.tagPlaceholder", "Optional tag (e.g. 'Standard Version')")}
        />
      </div>

      <div className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-900/10 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-900 dark:text-gray-100">
                {t("addVersion.encryptionPassword", "Metadata Encryption")}
                <span className="text-red-500 ml-1">*</span>
              </label>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className="relative flex items-center">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={usePersonPassphraseForEncryption}
                onChange={(event) => onUsePersonPassphraseForEncryptionChange(event.target.checked)}
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </div>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors">
              {t("addVersion.usePassphraseForEncryption", "Use identity passphrase")}
            </span>
          </label>
        </div>

        {showManualEncryptionInputs ? (
          <div className="space-y-3 pt-2 animate-fadeIn">
            {usePersonPassphraseForEncryption && !personHasPassphrase && (
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-lg border border-amber-100 dark:border-amber-900/30">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>
                  {t(
                    "addVersion.passphraseMissingForEncryption",
                    "Identity passphrase is empty. Please enter an encryption password or set a passphrase above.",
                  )}
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative group">
                <input
                  type={showEncryptionPassword ? "text" : "password"}
                  ref={encryptionPasswordRef}
                  onChange={onEncryptionErrorClear}
                  className="h-11 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 pr-10 text-sm placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
                  placeholder={t(
                    "addVersion.encryptionPasswordPlaceholder",
                    "Password (min 8 chars)",
                  )}
                  inputMode="text"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={onToggleEncryptionPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
                >
                  {showEncryptionPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="relative group">
                <input
                  type={showConfirmEncryptionPassword ? "text" : "password"}
                  ref={confirmEncryptionPasswordRef}
                  onChange={onEncryptionErrorClear}
                  className="h-11 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 pr-10 text-sm placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
                  placeholder={t("addVersion.encryptionPasswordConfirm", "Confirm password")}
                  inputMode="text"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={onToggleConfirmEncryptionPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
                >
                  {showConfirmEncryptionPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {encryptionError && (
              <p className="text-xs text-red-500 dark:text-red-400 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {encryptionError}
              </p>
            )}
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug pl-1">
              {t(
                "addVersion.encryptionNotice",
                "Metadata is encrypted locally before generating CID. Please keep your password safe, as it cannot be recovered if lost.",
              )}
            </p>
          </div>
        ) : (
          <div className="pl-1 pt-1">
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {t(
                "addVersion.encryptionNotice",
                "Metadata is encrypted locally before generating CID. Please keep your password safe, as it cannot be recovered if lost.",
              )}
            </p>
            {encryptionError && (
              <p className="text-xs text-red-500 dark:text-red-400 font-medium mt-1">
                {encryptionError}
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
          {t("addVersion.metadataCID", "Metadata CID")}
          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {t("addVersion.autoGenerated", "Auto-generated")}
          </span>
        </label>
        <div className="flex gap-2">
          <input
            {...register("metadataCID")}
            readOnly
            className="flex-1 h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 text-sm text-gray-500 dark:text-gray-400 font-mono text-xs placeholder-gray-400 outline-none cursor-not-allowed select-all"
            placeholder={t(
              "addVersion.metadataCIDPlaceholder",
              "Generated from encrypted metadata...",
            )}
          />
          <button
            type="button"
            onClick={onDownloadMetadata}
            disabled={isSubmitting}
            className="px-4 h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 shadow-sm"
            title={t("addVersion.downloadMetadata", "Download metadata JSON")}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">{t("addVersion.download", "Download")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
