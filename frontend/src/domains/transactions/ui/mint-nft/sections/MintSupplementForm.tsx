import { useEffect, useId, useState } from "react";
import type { FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import {
  MODAL_FIELD,
  MODAL_FIELD_SM,
  MODAL_LABEL,
  MODAL_TEXTAREA,
  ModalSectionHeading,
  getFieldErrorA11y,
} from "../../../../../shared/ui";
import { ThemedSelect } from "../../shared/ThemedSelect";
import type { MintNFTFormValues, MintNFTT } from "../model/mintNftTypes";

const FIELD_LABEL = `${MODAL_LABEL} mb-1`;

export interface MintSupplementFormProps {
  t: MintNFTT;
  register: UseFormRegister<MintNFTFormValues>;
  errors: FieldErrors<MintNFTFormValues>;
  setValue: UseFormSetValue<MintNFTFormValues>;
  watch: UseFormWatch<MintNFTFormValues>;
  validatedBiography?: string;
}

export function MintSupplementForm({
  t,
  register,
  errors,
  setValue,
  watch,
  validatedBiography,
}: MintSupplementFormProps) {
  const [biographyCopyConfirmed, setBiographyCopyConfirmed] = useState(false);
  const biographyCopyConfirmationId = useId();
  const birthPlaceId = useId();
  const deathPlaceId = useId();
  const storyId = useId();
  const tokenUriId = useId();
  const isDeathBC = Boolean(watch("isDeathBC"));
  const currentYear = new Date().getFullYear();
  const storyErrorId = "mint-nft-story-error";
  const tokenUriErrorId = "mint-nft-token-uri-error";
  const storyA11y = getFieldErrorA11y({
    invalid: Boolean(errors.story),
    errorId: storyErrorId,
  });
  const tokenUriA11y = getFieldErrorA11y({
    invalid: Boolean(errors.tokenURI),
    errorId: tokenUriErrorId,
  });
  const canOfferBiographyCopy =
    typeof validatedBiography === "string" && validatedBiography.length > 0;

  useEffect(() => {
    setBiographyCopyConfirmed(false);
  }, [validatedBiography]);

  return (
    <div className="space-y-4">
      <ModalSectionHeading>
        {t("mintNFT.supplementalInfo", "Supplemental Information")}
      </ModalSectionHeading>

      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor={birthPlaceId} className={FIELD_LABEL}>
              {t("mintNFT.birthPlace", "Birth Place")}
            </label>
            <input
              id={birthPlaceId}
              {...register("birthPlace")}
              className={MODAL_FIELD}
              placeholder={t("mintNFT.birthPlacePlaceholder", "e.g. Shaoxing, Zhejiang")}
            />
          </div>

          <div>
            <label htmlFor={deathPlaceId} className={FIELD_LABEL}>
              {t("mintNFT.deathPlace", "Death Place")}
            </label>
            <input
              id={deathPlaceId}
              {...register("deathPlace")}
              className={MODAL_FIELD}
              placeholder={t("mintNFT.deathPlacePlaceholder", "e.g. Beijing")}
            />
          </div>
        </div>

        {/* Laid out like the birth date in the identity fields: era, year, month, day. */}
        <div className="flex flex-nowrap items-start gap-1">
          <div className="flex items-start gap-1">
            <div className="w-20 relative">
              <label className={FIELD_LABEL}>{t("search.hashCalculator.isBirthBC")}</label>
              <ThemedSelect
                value={isDeathBC ? 1 : 0}
                onChange={(value) => setValue("isDeathBC", value === 1)}
                options={[
                  { value: 0, label: t("search.hashCalculator.bcOptions.ad") },
                  { value: 1, label: t("search.hashCalculator.bcOptions.bc") },
                ]}
              />
            </div>

            <div className="w-20 sm:w-[120px]">
              <label className={FIELD_LABEL}>{t("mintNFT.deathYear", "Death Year")}</label>
              <input
                type="number"
                min="0"
                max={isDeathBC ? 9999 : currentYear}
                placeholder={isDeathBC ? "<10000" : "<=" + currentYear}
                className={MODAL_FIELD_SM}
                {...register("deathYear", {
                  setValueAs: (value) => (value === "" ? "" : parseInt(value, 10)),
                })}
              />
            </div>
          </div>

          <div className="w-24">
            <label className={FIELD_LABEL}>{t("search.hashCalculator.birthMonthLabel")}</label>
            <input
              type="number"
              min="0"
              max="12"
              placeholder={t("search.hashCalculator.birthMonth")}
              className={MODAL_FIELD_SM}
              {...register("deathMonth", {
                setValueAs: (value) => (value === "" ? "" : parseInt(value, 10)),
              })}
            />
          </div>

          <div className="w-24">
            <label className={FIELD_LABEL}>{t("search.hashCalculator.birthDayLabel")}</label>
            <input
              type="number"
              min="0"
              max="31"
              placeholder={t("search.hashCalculator.birthDay")}
              className={MODAL_FIELD_SM}
              {...register("deathDay", {
                setValueAs: (value) => (value === "" ? "" : parseInt(value, 10)),
              })}
            />
          </div>
        </div>

        <div>
          <label htmlFor={storyId} className={FIELD_LABEL}>
            {t("mintNFT.story", "Life Story Summary")}
          </label>
          {canOfferBiographyCopy && (
            <div className="mb-3 space-y-3 rounded-xl border border-red-200 bg-red-50/70 p-3 dark:border-red-900/40 dark:bg-red-900/10">
              <p className="text-xs font-medium leading-relaxed text-red-700 dark:text-red-300">
                {t(
                  "mintNFT.copyBiographyWarning",
                  "An unlocked private biography is available for this exact version. Copying it into the NFT biography makes that text permanently public on-chain.",
                )}
              </p>
              <label
                htmlFor={biographyCopyConfirmationId}
                className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-red-700 dark:text-red-300"
              >
                <input
                  id={biographyCopyConfirmationId}
                  type="checkbox"
                  checked={biographyCopyConfirmed}
                  onChange={(event) => setBiographyCopyConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-red-300 text-danger focus:ring-red-500"
                />
                <span>
                  {t(
                    "mintNFT.copyBiographyConfirm",
                    "I understand this copies decrypted private biography text into a public, immutable NFT field.",
                  )}
                </span>
              </label>
              <button
                type="button"
                disabled={!biographyCopyConfirmed}
                onClick={() =>
                  setValue("story", validatedBiography, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  })
                }
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("mintNFT.copyBiographyToStory", "Copy into public biography")}
              </button>
            </div>
          )}
          <textarea
            id={storyId}
            {...register("story")}
            rows={4}
            {...storyA11y.fieldProps}
            className={MODAL_TEXTAREA}
            placeholder={t("mintNFT.storyPlaceholder", "Enter a brief life story summary...")}
          />
          {errors.story && (
            <p {...storyA11y.errorProps} className="mt-1 text-xs text-danger font-bold">
              {String(errors.story.message)}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={tokenUriId} className={FIELD_LABEL}>
            {t("mintNFT.tokenURI", "Token URI")}
          </label>
          <input
            id={tokenUriId}
            {...register("tokenURI")}
            {...tokenUriA11y.fieldProps}
            className={MODAL_FIELD}
            placeholder="https://... or ipfs://..."
          />
          {errors.tokenURI && (
            <p {...tokenUriA11y.errorProps} className="mt-1 text-xs text-danger font-bold">
              {String(errors.tokenURI.message)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
