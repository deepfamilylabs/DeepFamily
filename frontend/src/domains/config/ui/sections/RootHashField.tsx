import { useTranslation } from "react-i18next";
import { getFieldErrorA11y, modalFieldSm } from "../../../../shared/ui";
import { Field } from "./ConfigControls";

export interface RootHashFieldProps {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

export default function RootHashField({ value, onChange, error }: RootHashFieldProps) {
  const { t } = useTranslation();
  const { fieldProps, errorProps } = getFieldErrorA11y({
    invalid: Boolean(error),
    errorId: "config-root-hash-error",
  });

  return (
    <Field
      label={t("familyTree.config.root")}
      htmlFor="config-root-hash"
      error={error ? t(error, "Root Hash format error") : undefined}
      errorProps={errorProps}
    >
      <input
        id="config-root-hash"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${modalFieldSm(Boolean(error))} font-mono`}
        {...fieldProps}
      />
    </Field>
  );
}
