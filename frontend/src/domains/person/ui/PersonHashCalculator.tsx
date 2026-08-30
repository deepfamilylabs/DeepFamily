/**
 * PersonHashCalculator
 *
 * UI component for computing an identity hash (keccak256(identityCommitment))
 * used by DeepFamily ZK flows. When a passphrase is present, the identity secret
 * is derived locally via Argon2id in a worker before computing the final hash.
 * Security note: callers should prefer `onPublicFormChange`/imperative ref APIs
 * to avoid lifting the passphrase into parent state.
 */
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useId,
} from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { ChevronDown, Eye, EyeOff, Info } from "lucide-react";
import { CopyIconButton, MODAL_FIELD_SM, ModalShell, OVERLAY_Z_INDEX, useListboxA11y, useToast } from "../../../shared/ui";
import {
  validatePassphraseStrength,
  normalizePassphraseForHash,
  classifyProtocolPassphraseRisk,
  getGraphemeLength as getGraphemeLengthUtil,
  type ProtocolPassphraseRisk,
} from "../../../shared/crypto/passphraseStrength";
import { computeIdentityHash, computePersonHash } from "../../../shared/crypto/identityHash";
import { safeCanonicalizeFullName } from "../../../shared/identity/fullName";
import { cryptoWorkerCall } from "../../../shared/workers/cryptoWorkerClient";

const MAX_FULL_NAME_BYTES = 256;

const getByteLength = (str: string): number => {
  return new TextEncoder().encode(str).length;
};
const getGraphemeLength = getGraphemeLengthUtil;

// Field error component
const FieldError: React.FC<{ message?: string }> = ({ message }) => (
  <div className={`text-xs h-4 leading-4 ${message ? "text-danger" : "text-transparent"}`}>
    {message || "placeholder"}
  </div>
);

// Simple themed select component
const ThemedSelect: React.FC<{
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
  className?: string;
}> = ({ value, onChange, options, className = "" }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const {
    activeIndex,
    activeOptionId,
    getOptionId,
    handleButtonKeyDown,
    selectOption,
    setActiveIndex,
  } = useListboxA11y({
    open,
    options,
    selectedIndex,
    listboxId,
    getOptionKey: (option) => option.value,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
    onSelect: (option) => {
      onChange(option.value);
      setOpen(false);
    },
    buttonRef,
    focusButtonOnSelect: true,
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const current = options.find((o) => o.value === value)?.label ?? "";
  const handleRootBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const nextFocusedElement = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!event.currentTarget.contains(nextFocusedElement)) {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} onBlur={handleRootBlur} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleButtonKeyDown}
        className="w-full h-10 px-3 rounded-lg border border-hairline-strong bg-surface text-left text-xs text-ink focus:outline-hidden focus:ring-3 focus:ring-primary/15 hover:bg-surface-alt/60 transition flex items-center justify-between"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
      >
        <span className="truncate">{current}</span>
        <ChevronDown size={16} className="text-ink-muted" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-hairline bg-surface shadow-lg overflow-hidden">
          <ul id={listboxId} role="listbox" className="max-h-60 overflow-auto">
            {options.map((o, index) => (
              <li
                key={o.value}
                id={getOptionId(o, index)}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  selectOption(index);
                }}
                className={`px-3 py-2 text-xs cursor-pointer select-none transition-colors ${
                  o.value === value
                    ? "bg-primary/10 text-orange-700 dark:text-orange-300"
                    : index === activeIndex
                      ? "bg-surface-muted text-ink"
                      : "text-ink hover:bg-surface-muted"
                }`}
              >
                {o.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// Hash form schema and types
const optionalPassphrase = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((val) => (typeof val === "string" ? val : ""));

const hashFormSchema = z.object({
  fullName: z
    .string()
    .min(1)
    .refine((val) => safeCanonicalizeFullName(val).length > 0, "Name required")
    .refine(
      (val) => getByteLength(safeCanonicalizeFullName(val)) <= MAX_FULL_NAME_BYTES,
      "Name exceeds max bytes",
    ),
  isBirthBC: z.boolean(),
  birthYear: z
    .union([z.number().int().min(0).max(10000), z.literal("")])
    .transform((val) => (val === "" ? 0 : val)),
  birthMonth: z
    .union([z.number().int().min(0).max(12), z.literal("")])
    .transform((val) => (val === "" ? 0 : val)),
  birthDay: z
    .union([z.number().int().min(0).max(31), z.literal("")])
    .transform((val) => (val === "" ? 0 : val)),
  gender: z.number().int().min(0).max(3),
  passphrase: optionalPassphrase,
});

export type HashForm = z.infer<typeof hashFormSchema>;

export type PublicHashForm = Omit<HashForm, "passphrase"> & { hasPassphrase: boolean };
export type SecretHashInputs = { passphrase: string; confirmPassphrase?: string };

type HashFormInput = {
  fullName: string;
  isBirthBC: boolean;
  birthYear?: number | "";
  birthMonth?: number | "";
  birthDay?: number | "";
  gender: number;
};

// Password strength calculation (uses shared utility from passphraseStrength.ts)
// Note: This is a simple wrapper that maintains backward compatibility with the UI
const calculatePasswordStrength = (password: string) => {
  return validatePassphraseStrength(password, false);
};

// Hash calculation function using Poseidon (matches circuit and contract)
export { computePersonHash, computeIdentityHash };

// Component props interface
interface PersonHashCalculatorProps {
  className?: string;
  onPublicFormChange?: (formData: PublicHashForm) => void;
  /** Fires with the computed identity hash ("" while empty/computing). */
  onComputedHashChange?: (hash: string) => void;
  onPassphraseChange?: (risk: ProtocolPassphraseRisk) => void;
  showTitle?: boolean;
  collapsible?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  initialValues?: {
    fullName?: string;
    gender?: number;
    birthYear?: number;
    birthMonth?: number;
    birthDay?: number;
    isBirthBC?: boolean;
  };
  identitySuiteId?: number;
  requirePassphraseConfirmation?: boolean;
}

export type PersonHashCalculatorHandle = {
  getPublicFormData: () => PublicHashForm;
  getSecretInputs: () => SecretHashInputs;
  hasPassphrase: () => boolean;
  passphrasesMatch: () => boolean;
  clearSecretInputs: () => void;
};

export const PersonHashCalculator = forwardRef<
  PersonHashCalculatorHandle,
  PersonHashCalculatorProps
>(
  (
    {
      className = "",
      onPublicFormChange,
      onComputedHashChange,
      onPassphraseChange,
      showTitle = true,
      collapsible = false,
      isOpen = true,
      onToggle,
      initialValues,
      identitySuiteId = 1,
      requirePassphraseConfirmation = false,
    },
    ref,
  ) => {
    const { t, i18n } = useTranslation();
    const [internalOpen, setInternalOpen] = useState(true);
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [showConfirmPassphrase, setShowConfirmPassphrase] = useState(false);
    const [showPassphraseHelp, setShowPassphraseHelp] = useState(false);
    const [passphraseRevision, setPassphraseRevision] = useState(0);
    const toast = useToast();
    const passphraseInputRef = useRef<HTMLInputElement | null>(null);
    const confirmPassphraseInputRef = useRef<HTMLInputElement | null>(null);
    const passphraseHelpTitleId = useId();
    const passphraseHelpDescriptionId = useId();

    // Use external state if provided, otherwise use internal state
    const currentOpen = collapsible ? (onToggle ? isOpen : internalOpen) : true;
    const handleToggle = () => {
      if (onToggle) {
        onToggle();
      } else {
        setInternalOpen(!internalOpen);
      }
    };

    // Create schema with translations
    const hashFormSchema = useMemo(
      () =>
        z
          .object({
            fullName: z
              .string()
              .min(1, t("search.validation.required"))
              .refine((val) => safeCanonicalizeFullName(val).length > 0, {
                message: t("search.validation.required"),
              })
              .refine(
                (val) => getByteLength(safeCanonicalizeFullName(val)) <= MAX_FULL_NAME_BYTES,
                {
                  message: t("search.validation.nameTooLong"),
                },
              ),
            isBirthBC: z.boolean(),
            birthYear: z
              .union([
                z
                  .number()
                  .int()
                  .min(0, t("search.validation.yearRange"))
                  .max(9999, t("search.validation.yearRange")),
                z.literal(""),
              ])
              .optional()
              .transform((val) => (val === "" || val === undefined ? 0 : val)),
            birthMonth: z
              .union([
                z
                  .number()
                  .int()
                  .min(0, t("search.validation.monthRange"))
                  .max(12, t("search.validation.monthRange")),
                z.literal(""),
              ])
              .optional()
              .transform((val) => (val === "" || val === undefined ? 0 : val)),
            birthDay: z
              .union([
                z
                  .number()
                  .int()
                  .min(0, t("search.validation.dayRange"))
                  .max(31, t("search.validation.dayRange")),
                z.literal(""),
              ])
              .optional()
              .transform((val) => (val === "" || val === undefined ? 0 : val)),
            gender: z.number().int().min(0).max(3),
          })
          .refine(
            (data) => {
              // If AD (Anno Domini), the year must not exceed the current year
              if (!data.isBirthBC && data.birthYear > new Date().getFullYear()) {
                return false;
              }
              return true;
            },
            {
              message: t("search.validation.yearExceedsCurrent"),
              path: ["birthYear"],
            },
          ),
      [t],
    );

    const {
      register,
      formState: { errors },
      setValue,
      watch,
      getValues,
    } = useForm<HashFormInput>({
      resolver: zodResolver(hashFormSchema),
      defaultValues: {
        fullName: initialValues?.fullName || "",
        isBirthBC: initialValues?.isBirthBC || false,
        birthYear: initialValues?.birthYear || "",
        birthMonth: initialValues?.birthMonth || "",
        birthDay: initialValues?.birthDay || "",
        gender: initialValues?.gender || 0,
      },
    });

    // Watch for form changes and notify parent
    const fullName = watch("fullName");
    const isBirthBC = watch("isBirthBC");
    const birthYear = watch("birthYear");
    const birthMonth = watch("birthMonth");
    const birthDay = watch("birthDay");
    const gender = watch("gender");

    const normalizedPassphrase = useMemo(
      () => normalizePassphraseForHash(passphraseInputRef.current?.value ?? ""),
      [passphraseRevision],
    );
    const passphraseGraphemeLength = useMemo(
      () => getGraphemeLength(normalizedPassphrase),
      [normalizedPassphrase],
    );
    const hasPassphrase = normalizedPassphrase.length > 0;
    // Calculate password strength
    const passwordStrength = useMemo(() => {
      return calculatePasswordStrength(normalizedPassphrase);
    }, [normalizedPassphrase]);

    const buildTransformedData = (values?: Partial<HashFormInput>): HashForm => {
      const snapshot = values ?? getValues();
      return {
        fullName: safeCanonicalizeFullName(snapshot.fullName || ""),
        isBirthBC: snapshot.isBirthBC || false,
        birthYear:
          snapshot.birthYear === "" || snapshot.birthYear === undefined
            ? 0
            : Number(snapshot.birthYear),
        birthMonth:
          snapshot.birthMonth === "" || snapshot.birthMonth === undefined
            ? 0
            : Number(snapshot.birthMonth),
        birthDay:
          snapshot.birthDay === "" || snapshot.birthDay === undefined
            ? 0
            : Number(snapshot.birthDay),
        gender: Number(snapshot.gender || 0),
        passphrase: passphraseInputRef.current?.value ?? "",
      };
    };

    const [computedHash, setComputedHash] = useState("");
    const [isComputingHash, setIsComputingHash] = useState(false);

    const onComputedHashChangeRef = useRef(onComputedHashChange);
    useEffect(() => {
      onComputedHashChangeRef.current = onComputedHashChange;
    }, [onComputedHashChange]);
    useEffect(() => {
      onComputedHashChangeRef.current?.(computedHash);
    }, [computedHash]);

    const onPublicFormChangeRef = useRef(onPublicFormChange);

    useEffect(() => {
      onPublicFormChangeRef.current = onPublicFormChange;
    }, [onPublicFormChange]);

    useImperativeHandle(
      ref,
      () => ({
        getPublicFormData: () => {
          const data = buildTransformedData();
          const { passphrase: _passphrase, ...rest } = data;
          return { ...rest, hasPassphrase: normalizePassphraseForHash(_passphrase).length > 0 };
        },
        getSecretInputs: () => ({
          passphrase: passphraseInputRef.current?.value ?? "",
          ...(requirePassphraseConfirmation
            ? { confirmPassphrase: confirmPassphraseInputRef.current?.value ?? "" }
            : {}),
        }),
        hasPassphrase: () =>
          normalizePassphraseForHash(passphraseInputRef.current?.value ?? "").length > 0,
        passphrasesMatch: () =>
          !requirePassphraseConfirmation ||
          normalizePassphraseForHash(passphraseInputRef.current?.value ?? "") ===
            normalizePassphraseForHash(confirmPassphraseInputRef.current?.value ?? ""),
        clearSecretInputs: () => {
          if (passphraseInputRef.current) passphraseInputRef.current.value = "";
          if (confirmPassphraseInputRef.current) confirmPassphraseInputRef.current.value = "";
          setPassphraseRevision((revision) => revision + 1);
        },
      }),
      [getValues, passphraseRevision, requirePassphraseConfirmation],
    );

    useEffect(() => {
      const transformedData = buildTransformedData({
        fullName,
        isBirthBC,
        birthYear,
        birthMonth,
        birthDay,
        gender: Number(gender || 0),
      });
      const { passphrase: _passphrase, ...rest } = transformedData;
      onPublicFormChangeRef.current?.({
        ...rest,
        hasPassphrase: normalizePassphraseForHash(_passphrase).length > 0,
      });
    }, [fullName, isBirthBC, birthYear, birthMonth, birthDay, gender, passphraseRevision]);

    useEffect(() => {
      const transformedData = buildTransformedData({
        fullName,
        isBirthBC,
        birthYear,
        birthMonth,
        birthDay,
        gender: Number(gender || 0),
      });
      if (!transformedData.fullName.length) {
        setComputedHash("");
        setIsComputingHash(false);
        return;
      }

      let cancelled = false;
      const timer = window.setTimeout(
        () => {
          setIsComputingHash(true);
          cryptoWorkerCall(
            "computeIdentityHash",
            {
              input: { ...transformedData, identitySuiteId },
            },
            { timeoutMs: 180_000 },
          )
            .then(({ identityHash }) => {
              if (!cancelled) {
                setComputedHash(identityHash);
              }
            })
            .catch(() => {
              if (!cancelled) {
                setComputedHash("");
              }
            })
            .finally(() => {
              if (!cancelled) {
                setIsComputingHash(false);
              }
            });
        },
        hasPassphrase ? 250 : 0,
      );

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [
      fullName,
      isBirthBC,
      birthYear,
      birthMonth,
      birthDay,
      gender,
      passphraseRevision,
      identitySuiteId,
    ]);

    const content = (
      <div className="space-y-2">
        <div className="w-full space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
                {t("search.hashCalculator.name")} <span className="text-danger">*</span>
              </label>
              <input
                className={MODAL_FIELD_SM}
                placeholder={t("search.hashCalculator.nameInputPlaceholder")}
                {...register("fullName")}
              />
              <FieldError message={errors.fullName?.message} />
            </div>

            <div className="w-28 sm:w-28 shrink-0">
              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
                {t("search.hashCalculator.gender")}
              </label>
              <ThemedSelect
                value={Number(gender ?? 0)}
                onChange={(v) => setValue("gender", v, { shouldValidate: true, shouldDirty: true })}
                options={[
                  { value: 0, label: t("search.hashCalculator.genderOptions.unknown") },
                  { value: 1, label: t("search.hashCalculator.genderOptions.male") },
                  { value: 2, label: t("search.hashCalculator.genderOptions.female") },
                  { value: 3, label: t("search.hashCalculator.genderOptions.other") },
                ]}
              />
              <FieldError message={errors.gender?.message} />
            </div>
          </div>

          <div className="flex flex-nowrap items-start gap-1">
            <div className="flex items-start gap-1">
              <div className="w-20">
                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
                  {t("search.hashCalculator.isBirthBC")}
                </label>
                <ThemedSelect
                  value={isBirthBC ? 1 : 0}
                  onChange={(v) =>
                    setValue("isBirthBC", v === 1, { shouldValidate: true, shouldDirty: true })
                  }
                  options={[
                    { value: 0, label: t("search.hashCalculator.bcOptions.ad") },
                    { value: 1, label: t("search.hashCalculator.bcOptions.bc") },
                  ]}
                />
                <FieldError />
              </div>

              <div className="w-20 sm:w-[120px]">
                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
                  {t("search.hashCalculator.birthYearLabel")}
                </label>
                <input
                  type="number"
                  min="0"
                  max={isBirthBC ? 9999 : new Date().getFullYear()}
                  placeholder={isBirthBC ? "<10000" : "<=" + new Date().getFullYear()}
                  className={MODAL_FIELD_SM}
                  {...register("birthYear", {
                    setValueAs: (v) => (v === "" ? "" : parseInt(v, 10)),
                  })}
                />
                <FieldError message={errors.birthYear?.message} />
              </div>
            </div>

            <div className="w-24">
              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
                {t("search.hashCalculator.birthMonthLabel")}
              </label>
              <input
                type="number"
                min="0"
                max="12"
                placeholder={t("search.hashCalculator.birthMonth")}
                className={MODAL_FIELD_SM}
                {...register("birthMonth", {
                  setValueAs: (v) => (v === "" ? "" : parseInt(v, 10)),
                })}
              />
              <FieldError message={errors.birthMonth?.message} />
            </div>

            <div className="w-24">
              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
                {t("search.hashCalculator.birthDayLabel")}
              </label>
              <input
                type="number"
                min="0"
                max="31"
                placeholder={t("search.hashCalculator.birthDay")}
                className={MODAL_FIELD_SM}
                {...register("birthDay", { setValueAs: (v) => (v === "" ? "" : parseInt(v, 10)) })}
              />
              <FieldError message={errors.birthDay?.message} />
            </div>
          </div>
          <div className="w-full mt-2">
            <div className="flex items-center gap-2 mb-1">
              <label className="flex flex-wrap items-center gap-1 text-[11px] font-semibold uppercase tracking-normal sm:tracking-wide text-ink-muted whitespace-normal sm:whitespace-nowrap leading-tight">
                {t("search.hashCalculator.passphrase", "Identity passphrase")}
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowPassphraseHelp(!showPassphraseHelp)}
                  className="text-ink-subtle hover:text-primary transition-colors"
                  aria-label={t(
                    "search.hashCalculator.passphraseHelp.buttonAriaLabel",
                    "Identity passphrase help",
                  )}
                >
                  <Info size={14} />
                </button>
                <ModalShell
                  isOpen={showPassphraseHelp}
                  onClose={() => setShowPassphraseHelp(false)}
                  ariaLabelledBy={passphraseHelpTitleId}
                  ariaDescribedBy={passphraseHelpDescriptionId}
                  closeLabel={t("common.close", "Close")}
                  bare
                  zIndex={OVERLAY_Z_INDEX.nestedModal}
                >
                  <div
                    className={`fixed ${OVERLAY_Z_INDEX.nestedModal} top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 max-w-[90vw] p-4 bg-surface border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div
                          id={passphraseHelpTitleId}
                          className="font-semibold text-ink"
                        >
                          {t(
                            "search.hashCalculator.passphraseHelp.title",
                            "Passphrase Information",
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowPassphraseHelp(false)}
                          className="w-6 h-6 flex items-center justify-center text-ink-subtle hover:text-gray-600 dark:hover:text-gray-300 hover:bg-surface-muted rounded-sm"
                          aria-label={t("common.close", "Close")}
                        >
                          ×
                        </button>
                      </div>

                      <div id={passphraseHelpDescriptionId} className="space-y-3 text-sm">
                        <div className="text-ink-muted">
                          <div className="mb-1 font-medium text-blue-600 dark:text-blue-400">
                            {t(
                              "search.hashCalculator.passphraseHelp.privacy",
                              "Privacy Protection",
                            )}
                          </div>
                          <div className="text-xs leading-relaxed">
                            {t(
                              "search.hashCalculator.passphraseHelp.privacyDesc",
                              "Adds an extra protection layer to your identity hash, preventing others from guessing your identity through name and birth date.",
                            )}
                          </div>
                        </div>

                        <div className="text-ink-muted">
                          <div className="mb-1 font-medium text-green-600 dark:text-green-400">
                            {t(
                              "search.hashCalculator.passphraseHelp.optional",
                              "Completely Optional",
                            )}
                          </div>
                          <div className="text-xs leading-relaxed">
                            {t(
                              "search.hashCalculator.passphraseHelp.optionalDesc",
                              "Can be left blank, but using longer family mottos, poems, or emoji combinations is recommended for enhanced privacy.",
                            )}
                          </div>
                        </div>

                        <div className="text-ink-muted">
                          <div className="mb-1 font-medium text-primary">
                            {t("search.hashCalculator.passphraseHelp.remember", "Please Remember")}
                          </div>
                          <div className="text-xs leading-relaxed">
                            {t(
                              "search.hashCalculator.passphraseHelp.rememberDesc",
                              "Passphrases cannot be recovered. Forgetting it will generate a different identity hash.",
                            )}
                          </div>
                        </div>

                        <div className="text-ink-muted">
                          <div className="mb-1 font-medium text-indigo-600 dark:text-indigo-400">
                            {t(
                              "search.hashCalculator.passphraseHelp.privacyNoteTitle",
                              "Local Only",
                            )}
                          </div>
                          <div className="text-xs leading-relaxed text-ink-muted dark:text-gray-300">
                            {t(
                              "search.hashCalculator.passphraseHelp.privacyNote",
                              "The passphrase is hashed locally only; nothing is uploaded or stored.",
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </ModalShell>
              </div>
            </div>
            <div className="relative">
              <input
                type={showPassphrase ? "text" : "password"}
                className={`${MODAL_FIELD_SM} pr-10`}
                placeholder={t(
                  "search.hashCalculator.passphrasePlaceholder",
                  "Enter any characters—family mottos or secret phrases. 15+ characters with mixed symbols recommended",
                )}
                inputMode="text"
                autoCapitalize="none"
                autoComplete="new-password"
                autoCorrect="off"
                spellCheck={false}
                lang={i18n.language}
                ref={passphraseInputRef}
                onChange={() => {
                  setPassphraseRevision((r) => r + 1);
                  onPassphraseChange?.(
                    classifyProtocolPassphraseRisk(passphraseInputRef.current?.value ?? ""),
                  );
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus:outline-hidden"
                aria-label={
                  showPassphrase
                    ? t(
                        "search.hashCalculator.passphraseVisibility.hide",
                        "Hide identity passphrase",
                      )
                    : t(
                        "search.hashCalculator.passphraseVisibility.show",
                        "Show identity passphrase",
                      )
                }
              >
                {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {requirePassphraseConfirmation ? (
              <div className="relative mt-2">
                <input
                  type={showConfirmPassphrase ? "text" : "password"}
                  className={`${MODAL_FIELD_SM} pr-10`}
                  placeholder={t(
                    "search.hashCalculator.confirmPassphrasePlaceholder",
                    "Repeat the identity passphrase (empty is allowed)",
                  )}
                  inputMode="text"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  autoCorrect="off"
                  spellCheck={false}
                  lang={i18n.language}
                  ref={confirmPassphraseInputRef}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassphrase((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus:outline-hidden"
                  aria-label={
                    showConfirmPassphrase
                      ? t("search.hashCalculator.passphraseVisibility.hide", "Hide passphrase")
                      : t("search.hashCalculator.passphraseVisibility.show", "Show passphrase")
                  }
                >
                  {showConfirmPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            ) : null}

            {hasPassphrase && (
              <div className="mt-1 text-[11px] text-ink-muted">
                {t("search.hashCalculator.passphraseCharCount", {
                  count: passphraseGraphemeLength,
                })}
              </div>
            )}

            {/* Password strength indicator */}
            {hasPassphrase && (
              <div className="mt-1 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 flex-1">
                    {/* 5-level indicator bars */}
                    <div
                      className={`h-1 flex-1 rounded ${
                        passwordStrength.level === "weak"
                          ? "bg-red-400"
                          : passwordStrength.entropy >= 50
                            ? "bg-red-400"
                            : "bg-gray-200 dark:bg-gray-600"
                      }`}
                    />
                    <div
                      className={`h-1 flex-1 rounded ${
                        passwordStrength.level === "medium"
                          ? "bg-orange-400"
                          : passwordStrength.entropy >= 80
                            ? "bg-orange-400"
                            : "bg-gray-200 dark:bg-gray-600"
                      }`}
                    />
                    <div
                      className={`h-1 flex-1 rounded ${
                        passwordStrength.level === "strong"
                          ? "bg-yellow-400"
                          : passwordStrength.entropy >= 128
                            ? "bg-yellow-400"
                            : "bg-gray-200 dark:bg-gray-600"
                      }`}
                    />
                    <div
                      className={`h-1 flex-1 rounded ${
                        passwordStrength.level === "very-strong"
                          ? "bg-green-400"
                          : passwordStrength.entropy >= 192
                            ? "bg-green-400"
                            : "bg-gray-200 dark:bg-gray-600"
                      }`}
                    />
                    <div
                      className={`h-1 flex-1 rounded ${
                        passwordStrength.level === "excellent"
                          ? "bg-blue-500"
                          : "bg-gray-200 dark:bg-gray-600"
                      }`}
                    />
                  </div>
                  <span
                    className={`text-xs font-medium whitespace-nowrap ${
                      passwordStrength.level === "weak"
                        ? "text-danger"
                        : passwordStrength.level === "medium"
                          ? "text-primary"
                          : passwordStrength.level === "strong"
                            ? "text-yellow-600 dark:text-yellow-400"
                            : passwordStrength.level === "very-strong"
                              ? "text-green-600 dark:text-green-400"
                              : "text-blue-600 dark:text-blue-400"
                    }`}
                  >
                    {passwordStrength.level === "weak"
                      ? t("search.hashCalculator.passwordStrength.weak", "Weak")
                      : passwordStrength.level === "medium"
                        ? t("search.hashCalculator.passwordStrength.medium", "Medium")
                        : passwordStrength.level === "strong"
                          ? t("search.hashCalculator.passwordStrength.strong", "Strong")
                          : passwordStrength.level === "very-strong"
                            ? t("search.hashCalculator.passwordStrength.veryStrong", "Very Strong")
                            : t("search.hashCalculator.passwordStrength.excellent", "Excellent")}
                  </span>
                </div>
                {/* Display entropy */}
                <div className="text-[11px] text-ink-muted">
                  {t(
                    "search.hashCalculator.entropyDisplay",
                    "Raw entropy: {{raw}} bits · Adjusted strength score: {{adjusted}}",
                    {
                      raw: Math.round(passwordStrength.rawEntropy),
                      adjusted: Math.round(passwordStrength.entropy),
                    },
                  )}
                </div>
                {passwordStrength.level === "weak" && (
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    {t(
                      "search.hashCalculator.passwordTips.weak",
                      "Tip: Use at least 15+ mixed characters or 20+ letters for better security",
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {(computedHash || isComputingHash) && (
          <div className="space-y-2">
            {/* Local calculation result */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:overflow-hidden">
              <span className="shrink-0 text-xs text-ink-muted">
                {t("search.hashCalculator.calculatedHash")}:
              </span>
              {isComputingHash ? (
                <span className="font-mono text-xs text-ink-muted">
                  {t("search.hashCalculator.calculatingHash", "Computing identity hash...")}
                </span>
              ) : (
                <>
                  <HashInline
                    value={computedHash}
                    className="font-mono text-sm leading-none text-ink-muted tracking-tight"
                    wrapOnMobile
                  />
                  <CopyIconButton
                    onClick={async () => {
                      try {
                        if (
                          navigator.clipboard &&
                          typeof navigator.clipboard.writeText === "function"
                        ) {
                          await navigator.clipboard.writeText(computedHash);
                          toast.success(t("search.copied"));
                          return;
                        }
                      } catch {}
                      try {
                        const ta = document.createElement("textarea");
                        ta.value = computedHash;
                        ta.style.position = "fixed";
                        ta.style.left = "-9999px";
                        document.body.appendChild(ta);
                        ta.focus();
                        ta.select();
                        const ok = document.execCommand("copy");
                        document.body.removeChild(ta);
                        if (ok) {
                          toast.success(t("search.copied"));
                        } else {
                          toast.error(t("search.copyFailed"));
                        }
                      } catch {
                        toast.error(t("search.copyFailed"));
                      }
                    }}
                    label={t("search.copy")}
                    size="sm"
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );

    if (!collapsible) {
      // If className contains borderless styles, return content directly
      if (className.includes("border-0") || className.includes("shadow-none")) {
        return <div className={className}>{content}</div>;
      }

      return (
        <div
          className={`rounded-lg border border-hairline/70 bg-surface shadow-xs overflow-hidden ${className}`}
        >
          {showTitle && (
            <div className="bg-orange-50 dark:bg-gray-800/60 px-4 py-2 border-b border-hairline/60">
              <h3 className="text-sm font-semibold text-ink">
                {t("search.hashCalculator.title")}
              </h3>
            </div>
          )}
          <div className="py-6 px-3">{content}</div>
        </div>
      );
    }

    return (
      <div
        className={`rounded-lg border border-hairline/70 bg-surface shadow-xs overflow-hidden ${className}`}
      >
        <div
          className="bg-orange-50 dark:bg-gray-800/60 px-4 py-2 flex items-center justify-between cursor-pointer border-b border-hairline/60"
          onClick={handleToggle}
        >
          {showTitle && (
            <h3 className="text-sm font-semibold text-ink">
              {t("search.hashCalculator.title")}
            </h3>
          )}
          <button
            type="button"
            className="text-sm px-2 py-1 rounded-sm border bg-surface border-hairline-strong text-ink-muted hover:bg-surface-alt transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle();
            }}
            aria-expanded={currentOpen}
          >
            {currentOpen ? "-" : "+"}
          </button>
        </div>
        {currentOpen && <div className="py-4 px-3">{content}</div>}
      </div>
    );
  },
);

export default PersonHashCalculator;

// Inline hash renderer: shows full when fits; otherwise 10...8 middle ellipsis
/**
 * Hashes and addresses render in full inside dialogs — no measure-and-truncate.
 * `wrapOnMobile` is kept so call sites can opt into wrapping at narrow widths;
 * everywhere else the value breaks across lines rather than being abbreviated.
 */
const HashInline: React.FC<{
  value: string;
  className?: string;
  titleText?: string;
  wrapOnMobile?: boolean;
}> = ({ value, className = "", titleText, wrapOnMobile = false }) => (
  <span
    className={`min-w-0 break-all ${wrapOnMobile ? "w-full sm:w-auto" : ""} ${className}`}
    title={titleText ?? value}
  >
    {value}
  </span>
);
