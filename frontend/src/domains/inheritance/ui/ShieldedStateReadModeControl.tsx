import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { ShieldedStateReadMode } from "../../../shared/config/shieldedStateReadMode";

/** Public read preference shown inside the unlocked workspace. */
export function ShieldedStateReadModeControl({
  value,
  disabled,
  onChange,
}: {
  value: ShieldedStateReadMode;
  disabled: boolean;
  onChange: (value: ShieldedStateReadMode) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 rounded-[20px] border border-hairline bg-surface p-5"
    >
      <legend className="px-1 text-sm font-medium text-ink">
        {t("shielded.stateReadMode.title")}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["rebuild", "chain"] as const).map((mode) => (
          <label key={mode} className="flex min-w-0 items-start gap-3 text-sm text-ink">
            <input
              type="radio"
              name={`${id}-state-read-mode`}
              value={mode}
              checked={value === mode}
              disabled={disabled}
              aria-label={t(`shielded.stateReadMode.${mode}`)}
              aria-describedby={`${id}-${mode}-description`}
              onChange={() => { if (!disabled) onChange(mode); }}
              className="mt-1 accent-primary"
            />
            <span className="min-w-0 space-y-1">
              <span className="block font-medium">{t(`shielded.stateReadMode.${mode}`)}</span>
              <span id={`${id}-${mode}-description`} className="block text-xs leading-relaxed text-ink-muted">
                {t(`shielded.stateReadMode.${mode}Description`)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
