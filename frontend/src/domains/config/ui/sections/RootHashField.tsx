import { useTranslation } from "react-i18next";
import { getFieldErrorA11y, modalFieldSm } from "../../../../shared/ui";
import { Field } from "./ConfigControls";

/** What the chain had to say about the hash currently in the field. */
export type RootHashPresence = "idle" | "checking" | "present" | "absent";

export interface RootHashFieldProps {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  presence?: RootHashPresence;
  /** Named in the message, since the panel shows the network nowhere else. */
  networkName?: string;
}

/**
 * The root person's hash, with whether the chain in use actually carries it.
 *
 * Checked against what is typed rather than what was saved: a hash is cheap to
 * look up and the answer decides whether saving is worth doing at all. That is
 * the one way this differs from the reader field above, which can only report on
 * the address that was actually tried.
 *
 * Like that field, it speaks up only while checking and when the answer is bad.
 * A hash the chain carries needs no notice — the version list below fills in.
 */
export default function RootHashField({
  value,
  onChange,
  error,
  presence = "idle",
  networkName,
}: RootHashFieldProps) {
  const { t } = useTranslation();
  // A malformed hash was never put to the chain, so the format complaint stands
  // alone rather than stacking with a verdict about it.
  const absent = !error && presence === "absent";
  const { fieldProps, errorProps } = getFieldErrorA11y({
    invalid: Boolean(error) || absent,
    errorId: "config-root-hash-error",
  });
  const network = networkName ?? t("statusBar.unknownNetwork", "Unknown network");

  return (
    <Field
      label={t("familyTree.config.root")}
      htmlFor="config-root-hash"
      hint={
        !error && presence === "checking"
          ? t("familyTree.config.rootChecking", "Looking for this person…")
          : undefined
      }
      error={
        error
          ? t(error, "Root Hash format error")
          : absent
            ? t("familyTree.config.rootAbsent", "No person with this hash on {{network}}", {
                network,
              })
            : undefined
      }
      errorProps={errorProps}
    >
      <input
        id="config-root-hash"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${modalFieldSm(Boolean(error) || absent)} font-mono`}
        {...fieldProps}
      />
    </Field>
  );
}
