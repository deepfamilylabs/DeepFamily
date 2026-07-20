import type { Ref } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Shield,
  UserPlus,
  Users,
} from "lucide-react";
import type { UseFormRegister } from "react-hook-form";
import type { IdentitySaltMode } from "../../../../../shared/crypto/identityHash";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../../../person";
import type {
  AddVersionFormInput,
  AddVersionT,
  ParentKind,
  ParentStatus,
  PersonInfoPublic,
} from "../model/addVersionTypes";
import { IdentityRecoveryModePanel } from "./IdentityRecoveryModePanel";

interface ParentIdentitySectionProps {
  t: AddVersionT;
  kind: ParentKind;
  formResetKey: number;
  expanded: boolean;
  status: ParentStatus;
  calcRef: Ref<PersonHashCalculatorHandle>;
  hasPassphrase: boolean;
  identityMode: IdentitySaltMode;
  recoverySaltHex: string;
  register: UseFormRegister<AddVersionFormInput>;
  onExpandedChange: (value: boolean) => void;
  onInfoChange: (value: PersonInfoPublic) => void;
  onHasPassphraseChange: (value: boolean) => void;
  onIdentityModeChange: (value: IdentitySaltMode) => void;
  onRecoverySaltHexChange: (value: string) => void;
}

function StatusIndicator({ status }: { status: ParentStatus }) {
  const config = {
    empty: { icon: UserPlus, color: "text-gray-400", bg: "bg-gray-100 dark:bg-gray-700" },
    partial: {
      icon: AlertTriangle,
      color: "text-amber-500",
      bg: "bg-amber-100 dark:bg-amber-900/30",
    },
    complete: { icon: Check, color: "text-green-500", bg: "bg-green-100 dark:bg-green-900/30" },
  };
  const { icon: Icon, color, bg } = config[status];

  return (
    <div className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${bg}`}>
      <Icon className={`w-4 h-4 ${color}`} />
    </div>
  );
}

export function ParentIdentitySection({
  t,
  kind,
  formResetKey,
  expanded,
  status,
  calcRef,
  hasPassphrase,
  identityMode,
  recoverySaltHex,
  register,
  onExpandedChange,
  onInfoChange,
  onHasPassphraseChange,
  onIdentityModeChange,
  onRecoverySaltHexChange,
}: ParentIdentitySectionProps) {
  const isFather = kind === "father";
  const title = isFather
    ? t("addVersion.fatherInfo", "Father Information")
    : t("addVersion.motherInfo", "Mother Information");
  const versionField = isFather ? "fatherVersionIndex" : "motherVersionIndex";
  const iconClass =
    status === "complete"
      ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
      : isFather
        ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
        : "bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400";

  return (
    <div className={`space-y-2 ${isFather ? "" : "mt-2!"}`}>
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-200 group ${
          expanded
            ? "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800"
            : "bg-white dark:bg-gray-950 border-gray-100 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-xs"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${iconClass}`}>
            <Users className="w-4 h-4" />
          </div>
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</h3>
              {status !== "empty" && <StatusIndicator status={status} />}
            </div>
            {status !== "empty" && (
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  status === "complete"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                }`}
              >
                {status === "partial"
                  ? t("addVersion.partial", "Partial")
                  : t("addVersion.complete", "Complete")}
              </span>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" />
        )}
      </button>

      <div
        className={`p-1 space-y-4 transition-all duration-300 ease-in-out ${expanded ? "opacity-100 max-h-[2000px]" : "opacity-0 max-h-0 overflow-hidden"}`}
      >
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 space-y-4">
          <div className="p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-100/50 dark:border-blue-900/30">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed opacity-90">
                {t(
                  "addVersion.parentInfoNotice",
                  "Providing parent info locally generates zero-knowledge proofs for family linking (only hash values go on-chain) and earns DEEP token rewards. Parent info must match their actual versions exactly (incl. passphrase) to establish connection.",
                )}
              </p>
            </div>
          </div>

          <PersonHashCalculator
            ref={calcRef}
            key={`${kind}-${formResetKey}`}
            showTitle={false}
            collapsible={false}
            className="border-0 shadow-none bg-transparent"
            identityMode={identityMode}
            identitySaltHex={identityMode === "random" ? recoverySaltHex : undefined}
            initialValues={{
              fullName: "",
              gender: isFather ? 1 : 2,
              birthYear: 0,
              birthMonth: 0,
              birthDay: 0,
              isBirthBC: false,
            }}
            onPublicFormChange={(formData) => {
              onInfoChange({
                fullName: formData.fullName,
                gender: formData.gender,
                birthYear: formData.birthYear,
                birthMonth: formData.birthMonth,
                birthDay: formData.birthDay,
                isBirthBC: formData.isBirthBC,
              });
              onHasPassphraseChange(formData.hasPassphrase);
              if (!formData.hasPassphrase) {
                onIdentityModeChange("deterministic");
              }
            }}
          />

          {hasPassphrase && (
            <IdentityRecoveryModePanel
              t={t}
              compact
              mode={identityMode}
              recoverySaltHex={recoverySaltHex}
              onModeChange={onIdentityModeChange}
              onRecoverySaltHexChange={onRecoverySaltHexChange}
              title={t("addVersion.parentIdentityMode", "Parent Identity Recovery Mode")}
              hint={t(
                "addVersion.parentIdentityModeHint",
                "Use enhanced mode only when the parent identity was originally created with a saved recovery salt.",
              )}
              saltLabel={t("addVersion.parentRecoverySalt", "Parent Recovery Salt")}
              saltPlaceholder={
                isFather
                  ? t(
                      "addVersion.parentRecoverySaltPlaceholder",
                      "Paste the father's saved recovery salt",
                    )
                  : t(
                      "addVersion.parentRecoverySaltPlaceholderMother",
                      "Paste the mother's saved recovery salt",
                    )
              }
            />
          )}

          <div className="w-full sm:w-auto">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("addVersion.versionIndex", "Version Index")}
              <span className="ml-2 text-xs text-gray-400 font-normal">
                ({t("addVersion.versionIndexHint")})
              </span>
            </label>
            <input
              type="number"
              min="0"
              {...register(versionField, {
                setValueAs: (value) => (value === "" ? "" : parseInt(value, 10)),
              })}
              className="w-full sm:w-32 h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-hidden transition-all"
              placeholder="0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
