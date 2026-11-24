import { forwardRef, useImperativeHandle, useRef } from "react";
import type { IdentityFields } from "@deepfamily/protocol-core";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";

export type ShieldedRecipientCredentials = {
  identity: IdentityFields;
  rawPassphrase: string;
};

export type ShieldedRecipientCredentialsFormHandle = {
  /** Read the credentials for a lookup and keep the secret for the code that follows. */
  read: () => ShieldedRecipientCredentials;
  /** Read the secret once and clear its input before returning to the caller. */
  readAndClear: () => ShieldedRecipientCredentials;
  clearSecretInputs: () => void;
};

/**
 * Shares the unlock form while keeping the recipient's credentials out of parent state.
 * The enclosing input resolves the recipient's suite, so the form offers no suite choice.
 */
export const ShieldedRecipientCredentialsForm = forwardRef<
  ShieldedRecipientCredentialsFormHandle,
  { onChange?: () => void }
>(function ShieldedRecipientCredentialsForm({ onChange }, ref) {
  const formRef = useRef<PersonHashCalculatorHandle>(null);

  useImperativeHandle(ref, () => {
    const read = (): ShieldedRecipientCredentials => {
      const form = formRef.current;
      const data = form?.getPublicFormData();
      return {
        identity: {
          fullName: data?.fullName ?? "",
          gender: data?.gender ?? 0,
          isBirthBC: data?.isBirthBC ?? false,
          birthYear: data?.birthYear ?? 0,
          birthMonth: data?.birthMonth ?? 0,
          birthDay: data?.birthDay ?? 0,
        },
        rawPassphrase: form?.getSecretInputs().passphrase ?? "",
      };
    };
    return {
      read,
      clearSecretInputs: () => formRef.current?.clearSecretInputs(),
      readAndClear: () => {
        try {
          return read();
        } finally {
          formRef.current?.clearSecretInputs();
        }
      },
    };
  });

  return (
    <PersonHashCalculator
      ref={formRef}
      onPublicFormChange={onChange}
      autoResolveSuite
      showTitle={false}
      collapsible={false}
      computeHash={false}
      showPassphraseGuidance={false}
      className="border-0 bg-transparent p-0 shadow-none"
    />
  );
});
