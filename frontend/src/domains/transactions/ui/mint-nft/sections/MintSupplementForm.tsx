import { useEffect, useId, useState } from "react";
import type { FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Lock } from "lucide-react";
import { getFieldErrorA11y } from "../../../../../shared/ui";
import { ThemedSelect } from "../../shared/ThemedSelect";
import type { MintNFTFormValues, MintNFTT } from "../model/mintNftTypes";

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
  const isDeathBC = Boolean(watch("isDeathBC"));
  const currentYear = new Date().getFullYear();
  const storyErrorId = "mint-nft-story-error";
  const tokenUriHintId = "mint-nft-token-uri-hint";
  const tokenUriErrorId = "mint-nft-token-uri-error";
  const storyA11y = getFieldErrorA11y({
    invalid: Boolean(errors.story),
    errorId: storyErrorId,
  });
  const tokenUriA11y = getFieldErrorA11y({
    invalid: Boolean(errors.tokenURI),
    errorId: tokenUriErrorId,
    describedByIds: [tokenUriHintId],
  });
  const canOfferBiographyCopy =
    typeof validatedBiography === "string" && validatedBiography.length > 0;

  useEffect(() => {
    setBiographyCopyConfirmed(false);
  }, [validatedBiography]);

  return (
    <>
      <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t("mintNFT.supplementalInfo", "Supplemental Information")}
        </h3>

        <div className="p-3 bg-orange-50/50 dark:bg-orange-900/10 rounded-2xl border border-orange-100 dark:border-orange-900/30">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
            <p className="text-xs text-orange-700 dark:text-orange-300 leading-relaxed font-medium">
              {t(
                "mintNFT.supplementalInfoImmutable",
                "Supplemental information will be permanently stored on the blockchain and cannot be modified after submission. Please fill in carefully.",
              )}
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                {t("mintNFT.birthPlace", "Birth Place")}
              </label>
              <input
                {...register("birthPlace")}
                className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-hidden transition-all"
                placeholder={t("mintNFT.birthPlacePlaceholder", "Enter birth place")}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                {t("mintNFT.deathPlace", "Death Place")}
              </label>
              <input
                {...register("deathPlace")}
                className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-hidden transition-all"
                placeholder={t(
                  "mintNFT.deathPlacePlaceholder",
                  "Enter death place (if applicable)",
                )}
              />
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {t("mintNFT.deathDate", "Death Date (if applicable)")}
            </h4>

            <div className="flex flex-nowrap items-start gap-1">
              <div className="flex items-start gap-1">
                <div className="w-20 relative">
                  <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                    {t("search.hashCalculator.isBirthBC")}
                  </label>
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
                  <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                    {t("mintNFT.deathYear", "Death Year")}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={isDeathBC ? 9999 : currentYear}
                    placeholder={isDeathBC ? "<10000" : "<=" + currentYear}
                    className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-400 focus:ring-2 focus:ring-orange-500/30 dark:focus:ring-orange-400/30 outline-hidden transition"
                    {...register("deathYear", {
                      setValueAs: (value) => (value === "" ? "" : parseInt(value, 10)),
                    })}
                  />
                </div>
              </div>

              <div className="w-24">
                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                  {t("search.hashCalculator.birthMonthLabel")}
                </label>
                <input
                  type="number"
                  min="0"
                  max="12"
                  placeholder={t("search.hashCalculator.birthMonth")}
                  className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-400 focus:ring-2 focus:ring-orange-500/30 dark:focus:ring-orange-400/30 outline-hidden transition"
                  {...register("deathMonth", {
                    setValueAs: (value) => (value === "" ? "" : parseInt(value, 10)),
                  })}
                />
              </div>

              <div className="w-24">
                <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                  {t("search.hashCalculator.birthDayLabel")}
                </label>
                <input
                  type="number"
                  min="0"
                  max="31"
                  placeholder={t("search.hashCalculator.birthDay")}
                  className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-orange-500 dark:focus:border-orange-400 focus:ring-2 focus:ring-orange-500/30 dark:focus:ring-orange-400/30 outline-hidden transition"
                  {...register("deathDay", {
                    setValueAs: (value) => (value === "" ? "" : parseInt(value, 10)),
                  })}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
              {t("mintNFT.story", "Life Story Summary")}
            </label>
            {canOfferBiographyCopy && (
              <div className="mb-3 space-y-3 rounded-xl border border-red-200 bg-red-50/70 p-3 dark:border-red-900/40 dark:bg-red-900/10">
                <p className="text-xs font-medium leading-relaxed text-red-800 dark:text-red-200">
                  {t(
                    "mintNFT.copyBiographyWarning",
                    "An unlocked private biography is available for this exact version. Copying it into the NFT story makes that text permanently public on-chain.",
                  )}
                </p>
                <label
                  htmlFor={biographyCopyConfirmationId}
                  className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-red-900 dark:text-red-100"
                >
                  <input
                    id={biographyCopyConfirmationId}
                    type="checkbox"
                    checked={biographyCopyConfirmed}
                    onChange={(event) => setBiographyCopyConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-red-300 text-red-600 focus:ring-red-500"
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
                  {t("mintNFT.copyBiographyToStory", "Copy biography into public story")}
                </button>
              </div>
            )}
            <textarea
              {...register("story")}
              rows={4}
              {...storyA11y.fieldProps}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-hidden transition-all resize-none"
              placeholder={t("mintNFT.storyPlaceholder", "Enter a brief life story summary...")}
            />
            {errors.story && (
              <p {...storyA11y.errorProps} className="mt-1 text-xs text-red-500 font-bold">
                {String(errors.story.message)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800">
        <div>
          <label className="block text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t("mintNFT.tokenURI", "Token URI")}
          </label>
          <input
            {...register("tokenURI")}
            {...tokenUriA11y.fieldProps}
            className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-hidden transition-all"
            placeholder="https://... or ipfs://..."
          />
          <p
            id={tokenUriHintId}
            className="mt-2 text-xs text-gray-500 dark:text-gray-400 font-medium"
          >
            {t("mintNFT.tokenURIHint", "Optional: URL or IPFS hash for NFT metadata")}
          </p>
          {errors.tokenURI && (
            <p {...tokenUriA11y.errorProps} className="mt-1 text-xs text-red-500 font-bold">
              {String(errors.tokenURI.message)}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
