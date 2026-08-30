import type { Ref } from "react";
import { MODAL_CHIP, MODAL_FIELD } from "../../../../../shared/ui";
import {
  ChevronDown,
  ChevronRight,
  Shield,
  Users,
} from "lucide-react";
import type { UseFormRegister } from "react-hook-form";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../../../person";
import type {
  AddVersionFormInput,
  AddVersionT,
  ParentKind,
  ParentStatus,
  PersonInfoPublic,
} from "../model/addVersionTypes";

interface ParentIdentitySectionProps {
  t: AddVersionT;
  kind: ParentKind;
  formResetKey: number;
  expanded: boolean;
  status: ParentStatus;
  /** One-line recap shown on the collapsed row (name · year · version). */
  summary?: string;
  calcRef: Ref<PersonHashCalculatorHandle>;
  register: UseFormRegister<AddVersionFormInput>;
  onExpandedChange: (value: boolean) => void;
  onInfoChange: (value: PersonInfoPublic) => void;
  onPassphraseChange: () => void;
}

export function ParentIdentitySection({
  t,
  kind,
  formResetKey,
  expanded,
  status,
  summary,
  calcRef,
  register,
  onExpandedChange,
  onInfoChange,
  onPassphraseChange,
}: ParentIdentitySectionProps) {
  const isFather = kind === "father";
  const title = isFather
    ? t("addVersion.fatherInfo", "Father Information")
    : t("addVersion.motherInfo", "Mother Information");
  const versionField = isFather ? "fatherVersionIndex" : "motherVersionIndex";
  const hint =
    status === "empty"
      ? t("addVersion.parentNotProvided", "Not provided")
      : t("addVersion.parentNeedsVersion", "Version index still missing");

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        aria-expanded={expanded}
        className={`w-full flex items-center gap-3.5 p-3.5 text-left rounded-xl bg-surface border transition-colors focus:outline-hidden focus:ring-3 focus:ring-primary/15 ${
          expanded ? "border-primary/40" : "border-hairline hover:border-hairline-strong"
        }`}
      >
        <span className="w-9 h-9 shrink-0 rounded-[10px] bg-surface-muted flex items-center justify-center">
          <Users className="w-[18px] h-[18px] text-ink-muted" aria-hidden />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-ink truncate">{title}</span>
          <span className="block text-xs text-ink-muted truncate">{summary || hint}</span>
        </span>
        {status !== "empty" && (
          <span
            className={`${MODAL_CHIP} shrink-0 ${
              status === "complete"
                ? "border-success/25 bg-success/10 text-success"
                : "border-warning/25 bg-warning/10 text-warning"
            }`}
          >
            {status === "partial"
              ? t("addVersion.partial", "Partial")
              : t("addVersion.complete", "Complete")}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-[17px] h-[17px] shrink-0 text-ink-subtle" aria-hidden />
        ) : (
          <ChevronRight className="w-[17px] h-[17px] shrink-0 text-ink-subtle" aria-hidden />
        )}
      </button>

      <div
        className={`p-1 space-y-4 transition-all duration-300 ease-in-out ${expanded ? "opacity-100 max-h-[2000px]" : "opacity-0 max-h-0 overflow-hidden"}`}
      >
        <div className="bg-surface rounded-xl border border-hairline p-4 space-y-4">
          <div className="p-3 bg-info/8 rounded-xl border border-info/20">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-info shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                {t(
                  "addVersion.parentInfoNotice",
                  "Providing both parents locally generates zero-knowledge proofs for family linking (only hashes go on-chain). The first complete two-parent commitment for a person hash may receive DEEP utility points; parents do not need to exist on-chain first. Their details must match when linking to their identities later.",
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
            requirePassphraseConfirmation
            onPassphraseChange={onPassphraseChange}
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
            }}
          />

          <div className="w-full sm:w-auto">
            <label className="block text-xs font-semibold text-ink mb-1.5">
              {t("addVersion.versionIndex", "Version Index")}
              <span className="ml-2 text-xs text-ink-subtle font-normal">
                ({t("addVersion.versionIndexHint")})
              </span>
            </label>
            <input
              type="number"
              min="0"
              {...register(versionField, {
                setValueAs: (value) => (value === "" ? "" : parseInt(value, 10)),
              })}
              className={`${MODAL_FIELD} sm:w-32`}
              placeholder="0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
