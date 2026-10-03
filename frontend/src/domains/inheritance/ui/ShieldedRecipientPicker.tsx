import { useTranslation } from "react-i18next";
import type { ShieldedRecipientOption } from "../services/shieldedRecipientOptions";
import { FieldBlock, shortHex } from "./inheritanceControls";

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30";

export function ShieldedRecipientPicker({
  label,
  value,
  onChange,
  options,
  loading,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly ShieldedRecipientOption[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  const visible = options.filter((option) => option.eligible);
  const selected = visible.find(
    (option) => option.personHash.toLowerCase() === value.trim().toLowerCase(),
  );
  return (
    <div className="space-y-2">
      <FieldBlock label={label}>
        <select
          aria-label={label}
          className={INPUT_CLASS}
          value={selected?.personHash ?? ""}
          onChange={(event) => onChange(event.target.value)}
          disabled={loading}
        >
          <option value="">
            {loading
              ? t("shielded.recipientPicker.loading")
              : t(
                  visible.length
                    ? "shielded.recipientPicker.placeholder"
                    : "shielded.recipientPicker.emptyChildren",
                )}
          </option>
          {visible.map((option, index) => (
            <option key={option.personHash.toLowerCase()} value={option.personHash}>
              {option.label ?? t("shielded.recipientPicker.childFallback", { index: index + 1 })}{" "}
              {shortHex(option.personHash)}
            </option>
          ))}
        </select>
      </FieldBlock>
      {value.trim() ? (
        <p className="break-all text-xs text-ink-muted">
          {t("shielded.recipientPicker.manualLabel")}: <code>{value.trim()}</code>
        </p>
      ) : null}
      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer">{t("shielded.recipientPicker.manual")}</summary>
        <input
          aria-label={t("shielded.recipientPicker.manualLabel")}
          className={`${INPUT_CLASS} mt-2`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0x…"
        />
      </details>
    </div>
  );
}
