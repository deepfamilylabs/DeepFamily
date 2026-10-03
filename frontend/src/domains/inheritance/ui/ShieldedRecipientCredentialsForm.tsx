import { forwardRef, useImperativeHandle, useRef } from "react";
import type { IdentityFields } from "@deepfamily/protocol-core";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../../person";

export type ShieldedRecipientCredentials = {
  identity: IdentityFields;
  rawPassphrase: string;
};

export type ShieldedRecipientCredentialsFormHandle = {
  /** Read the secret once and clear its input before returning to the caller. */
  readAndClear: () => ShieldedRecipientCredentials;
  clearSecretInputs: () => void;
};

/** Shares the unlock form while keeping the recipient's credentials out of parent state. */
export const ShieldedRecipientCredentialsForm = forwardRef<ShieldedRecipientCredentialsFormHandle>(
  function ShieldedRecipientCredentialsForm(_props, ref) {
    const formRef = useRef<PersonHashCalculatorHandle>(null);

    useImperativeHandle(ref, () => ({
      clearSecretInputs: () => formRef.current?.clearSecretInputs(),
      readAndClear: () => {
        const form = formRef.current;
        try {
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
        } finally {
          form?.clearSecretInputs();
        }
      },
    }));

    return (
      <PersonHashCalculator
        ref={formRef}
        showTitle={false}
        collapsible={false}
        computeHash={false}
        showPassphraseGuidance={false}
        className="border-0 bg-transparent p-0 shadow-none"
      />
    );
  },
);
