import { useTranslation } from "react-i18next";
import { getFieldErrorA11y, modalFieldSm } from "../../../../shared/ui";
import { Field } from "./ConfigControls";

export interface ContractAddressFieldProps {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

export default function ContractAddressField({
  value,
  onChange,
  error,
}: ContractAddressFieldProps) {
  const { t } = useTranslation();
  const { fieldProps, errorProps } = getFieldErrorA11y({
    invalid: Boolean(error),
    errorId: "config-reader-address-error",
  });

  return (
    <Field
      label={t("familyTree.config.readerAddress")}
      htmlFor="config-reader-address"
      error={error ? t(error, "Reader address format error") : undefined}
      errorProps={errorProps}
    >
      <input
        id="config-reader-address"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${modalFieldSm(Boolean(error))} font-mono`}
        {...fieldProps}
      />
    </Field>
  );
}
