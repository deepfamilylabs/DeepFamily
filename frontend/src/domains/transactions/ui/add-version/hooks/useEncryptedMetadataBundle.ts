import { useCallback, useMemo, useState, type RefObject } from "react";
import { sha256Hex } from "../../../../../shared/crypto/metadataCrypto";
import { sanitizeErrorForLogging } from "../../../../../shared/lib/errors";
import { cryptoWorkerCall } from "../../../../../shared/workers/cryptoWorkerClient";
import { addVersionSchema } from "../model/addVersionSchema";
import type {
  AddVersionFormData,
  AddVersionFormInput,
  AddVersionT,
  EncryptedMetadataBundle,
  IdentitySaltSelections,
} from "../model/addVersionTypes";

interface UseEncryptedMetadataBundleArgs {
  t: AddVersionT;
  personHasPassphrase: boolean;
  personHasPassphraseRef: () => boolean;
  getPersonPassphrase: () => string;
  encryptionPasswordRef: RefObject<HTMLInputElement | null>;
  confirmEncryptionPasswordRef: RefObject<HTMLInputElement | null>;
  buildMetadataPayload: (
    tagValue: string,
    processedData: AddVersionFormData,
    identitySaltSelections: IdentitySaltSelections,
  ) => Promise<unknown>;
  resolveIdentitySaltSelections: () => IdentitySaltSelections;
  setMetadataCid: (cid: string) => void;
}

export function useEncryptedMetadataBundle({
  t,
  personHasPassphrase,
  personHasPassphraseRef,
  getPersonPassphrase,
  encryptionPasswordRef,
  confirmEncryptionPasswordRef,
  buildMetadataPayload,
  resolveIdentitySaltSelections,
  setMetadataCid,
}: UseEncryptedMetadataBundleArgs) {
  const [encryptionError, setEncryptionError] = useState<string | null>(null);
  const [usePersonPassphraseForEncryption, setUsePersonPassphraseForEncryption] = useState(true);
  const [encryptedMetadata, setEncryptedMetadata] = useState<EncryptedMetadataBundle | null>(null);
  const [showEncryptionPassword, setShowEncryptionPassword] = useState(false);
  const [showConfirmEncryptionPassword, setShowConfirmEncryptionPassword] = useState(false);

  const showManualEncryptionInputs = useMemo(
    () => !usePersonPassphraseForEncryption || !personHasPassphrase,
    [personHasPassphrase, usePersonPassphraseForEncryption],
  );

  const clearPasswordInputs = useCallback(() => {
    if (encryptionPasswordRef.current) encryptionPasswordRef.current.value = "";
    if (confirmEncryptionPasswordRef.current) confirmEncryptionPasswordRef.current.value = "";
  }, [confirmEncryptionPasswordRef, encryptionPasswordRef]);

  const reset = useCallback(() => {
    clearPasswordInputs();
    setEncryptionError(null);
    setEncryptedMetadata(null);
    setUsePersonPassphraseForEncryption(true);
    setShowEncryptionPassword(false);
    setShowConfirmEncryptionPassword(false);
  }, [clearPasswordInputs]);

  const validateEncryptionPassword = useCallback(() => {
    const canUseIdentityPassphrase = usePersonPassphraseForEncryption && personHasPassphraseRef();
    if (canUseIdentityPassphrase) {
      setEncryptionError(null);
      return true;
    }

    const encryptionPassword = (encryptionPasswordRef.current?.value ?? "").trim();
    const confirmEncryptionPassword = confirmEncryptionPasswordRef.current?.value ?? "";
    if (!encryptionPassword) {
      setEncryptionError(
        t("addVersion.encryptionPasswordRequired", "Please enter encryption password"),
      );
      return false;
    }
    if (encryptionPassword.length < 8) {
      setEncryptionError(
        t("addVersion.encryptionPasswordWeak", "Password must be at least 8 characters"),
      );
      return false;
    }
    if (encryptionPassword !== confirmEncryptionPassword) {
      setEncryptionError(t("addVersion.encryptionPasswordMismatch", "Passwords do not match"));
      return false;
    }
    setEncryptionError(null);
    return true;
  }, [
    confirmEncryptionPasswordRef,
    encryptionPasswordRef,
    personHasPassphraseRef,
    t,
    usePersonPassphraseForEncryption,
  ]);

  const resolveEncryptionPassword = useCallback(() => {
    const canUseIdentityPassphrase = usePersonPassphraseForEncryption && personHasPassphraseRef();
    if (canUseIdentityPassphrase) {
      return getPersonPassphrase();
    }
    return (encryptionPasswordRef.current?.value ?? "").trim();
  }, [
    encryptionPasswordRef,
    getPersonPassphrase,
    personHasPassphraseRef,
    usePersonPassphraseForEncryption,
  ]);

  const prepareEncryptedMetadata = useCallback(
    async (
      tagValue: string,
      processedData: AddVersionFormData,
      password: string,
      identitySaltSelections: IdentitySaltSelections,
    ) => {
      const metadataPayload = await buildMetadataPayload(
        tagValue,
        processedData,
        identitySaltSelections,
      );
      const metadataJson = JSON.stringify(metadataPayload);
      const bundlePlainHash = sha256Hex(metadataJson);

      const { passwordFingerprint } = await cryptoWorkerCall("passwordFingerprint", { password });
      if (
        encryptedMetadata &&
        encryptedMetadata.plainHash === bundlePlainHash &&
        encryptedMetadata.passwordFingerprint === passwordFingerprint
      ) {
        return encryptedMetadata;
      }

      const bundleResult = await cryptoWorkerCall("encryptMetadataBundleV2", {
        plaintextJson: metadataJson,
        password,
      });
      const bundle = {
        json: bundleResult.encryptedJson,
        cid: bundleResult.cid,
        plainHash: bundleResult.plainHash,
        passwordFingerprint: bundleResult.passwordFingerprint,
      };
      setEncryptedMetadata(bundle);
      return bundle;
    },
    [buildMetadataPayload, encryptedMetadata],
  );

  const handleDownloadMetadata = useCallback(
    async (formValues: AddVersionFormInput) => {
      try {
        if (!validateEncryptionPassword()) return;
        const processedData = addVersionSchema.parse(formValues);
        const identitySaltSelections = resolveIdentitySaltSelections();
        const { json, cid } = await prepareEncryptedMetadata(
          processedData.tag,
          processedData,
          resolveEncryptionPassword(),
          identitySaltSelections,
        );
        setMetadataCid(cid);

        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `metadata-encrypted-${cid || Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error("Download metadata failed", sanitizeErrorForLogging(error));
        setEncryptionError(
          t(
            "addVersion.encryptionFailed",
            "Failed to encrypt or export metadata, please try again",
          ),
        );
      }
    },
    [
      prepareEncryptedMetadata,
      resolveEncryptionPassword,
      resolveIdentitySaltSelections,
      setMetadataCid,
      t,
      validateEncryptionPassword,
    ],
  );

  return {
    encryptionError,
    usePersonPassphraseForEncryption,
    showEncryptionPassword,
    showConfirmEncryptionPassword,
    showManualEncryptionInputs,
    encryptedMetadata,
    onEncryptionErrorClear: () => setEncryptionError(null),
    onUsePersonPassphraseForEncryptionChange: (checked: boolean) => {
      setUsePersonPassphraseForEncryption(checked);
      if (checked) clearPasswordInputs();
      if (checked && encryptionError) setEncryptionError(null);
    },
    onToggleEncryptionPassword: () => setShowEncryptionPassword((value) => !value),
    onToggleConfirmEncryptionPassword: () => setShowConfirmEncryptionPassword((value) => !value),
    handleDownloadMetadata,
    prepareEncryptedMetadata,
    reset,
    resolveEncryptionPassword,
    validateEncryptionPassword,
  };
}
