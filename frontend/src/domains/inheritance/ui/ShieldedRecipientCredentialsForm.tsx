import { forwardRef, useId, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { IdentityFields } from "@deepfamily/protocol-core";
import { FieldBlock } from "./inheritanceControls";

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-primary/30";

export type ShieldedRecipientCredentials = {
  identity: IdentityFields;
  rawPassphrase: string;
};

export type ShieldedRecipientCredentialsFormHandle = {
  /** Read the secret once and clear its input before returning to the caller. */
  readAndClear: () => ShieldedRecipientCredentials;
  clearSecretInputs: () => void;
};

/** Recipient credentials stay in uncontrolled DOM fields until the payment starts. */
export const ShieldedRecipientCredentialsForm = forwardRef<
  ShieldedRecipientCredentialsFormHandle
>(function ShieldedRecipientCredentialsForm(_props, ref) {
  const { t } = useTranslation();
  const id = useId();
  const fullNameRef = useRef<HTMLInputElement>(null);
  const genderRef = useRef<HTMLSelectElement>(null);
  const eraRef = useRef<HTMLSelectElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    clearSecretInputs: () => {
      if (passphraseRef.current) passphraseRef.current.value = "";
    },
    readAndClear: () => {
      const rawPassphrase = passphraseRef.current?.value ?? "";
      if (passphraseRef.current) passphraseRef.current.value = "";
      return {
        identity: {
          fullName: fullNameRef.current?.value ?? "",
          gender: Number(genderRef.current?.value ?? "0"),
          isBirthBC: eraRef.current?.value === "bc",
          birthYear: Number(yearRef.current?.value || "0"),
          birthMonth: Number(monthRef.current?.value || "0"),
          birthDay: Number(dayRef.current?.value || "0"),
        },
        rawPassphrase,
      };
    },
  }));

  return (
    <div className="space-y-3">
      <FieldBlock label={t("search.hashCalculator.name")} htmlFor={`${id}-name`}>
        <input
          id={`${id}-name`}
          ref={fullNameRef}
          className={INPUT_CLASS}
          autoComplete="off"
          maxLength={256}
        />
      </FieldBlock>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldBlock label={t("search.hashCalculator.gender")} htmlFor={`${id}-gender`}>
          <select id={`${id}-gender`} ref={genderRef} className={INPUT_CLASS} defaultValue="0">
            <option value="0">{t("search.hashCalculator.genderOptions.unknown")}</option>
            <option value="1">{t("search.hashCalculator.genderOptions.male")}</option>
            <option value="2">{t("search.hashCalculator.genderOptions.female")}</option>
            <option value="3">{t("search.hashCalculator.genderOptions.other")}</option>
          </select>
        </FieldBlock>
        <FieldBlock label={t("search.hashCalculator.isBirthBC")} htmlFor={`${id}-era`}>
          <select id={`${id}-era`} ref={eraRef} className={INPUT_CLASS} defaultValue="ad">
            <option value="ad">{t("search.hashCalculator.bcOptions.ad")}</option>
            <option value="bc">{t("search.hashCalculator.bcOptions.bc")}</option>
          </select>
        </FieldBlock>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <FieldBlock label={t("search.hashCalculator.birthYearLabel")} htmlFor={`${id}-year`}>
          <input
            id={`${id}-year`}
            ref={yearRef}
            className={INPUT_CLASS}
            type="number"
            inputMode="numeric"
            min={0}
            max={9999}
            step={1}
          />
        </FieldBlock>
        <FieldBlock label={t("search.hashCalculator.birthMonthLabel")} htmlFor={`${id}-month`}>
          <input
            id={`${id}-month`}
            ref={monthRef}
            className={INPUT_CLASS}
            type="number"
            inputMode="numeric"
            min={0}
            max={12}
            step={1}
          />
        </FieldBlock>
        <FieldBlock label={t("search.hashCalculator.birthDayLabel")} htmlFor={`${id}-day`}>
          <input
            id={`${id}-day`}
            ref={dayRef}
            className={INPUT_CLASS}
            type="number"
            inputMode="numeric"
            min={0}
            max={31}
            step={1}
          />
        </FieldBlock>
      </div>
      <FieldBlock label={t("search.hashCalculator.passphrase")} htmlFor={`${id}-passphrase`}>
        <input
          id={`${id}-passphrase`}
          ref={passphraseRef}
          className={INPUT_CLASS}
          type="password"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </FieldBlock>
    </div>
  );
});
