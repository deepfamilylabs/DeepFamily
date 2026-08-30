import type { UseFormRegister } from "react-hook-form";
import type { AddVersionFormInput, AddVersionT } from "../model/addVersionTypes";
import { MODAL_FIELD, MODAL_TEXTAREA } from "../../../../../shared/ui";

export interface MetadataEncryptionSectionProps {
  t: AddVersionT;
  register: UseFormRegister<AddVersionFormInput>;
  isSubmitting: boolean;
}

export function MetadataEncryptionSection({
  t,
  register,
  isSubmitting,
}: MetadataEncryptionSectionProps) {
  return (
    <div className="space-y-4 pt-4 border-t border-hairline mt-2!">
      <div className="space-y-2">
        <label className="block text-xs font-semibold text-ink mb-1.5">
          {t("addVersion.tag", "Revision label")}
        </label>
        <input
          {...register("tag")}
          disabled={isSubmitting}
          className={`${MODAL_FIELD} disabled:opacity-60`}
          placeholder={t("addVersion.tagPlaceholder", "Optional private revision label")}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-semibold text-ink mb-1.5">
          {t("addVersion.biography", "Private version biography")}
        </label>
        <textarea
          {...register("biography")}
          disabled={isSubmitting}
          rows={8}
          className={`${MODAL_TEXTAREA} disabled:opacity-60 whitespace-pre-wrap`}
          placeholder={t(
            "addVersion.biographyPlaceholder",
            "This immutable biography is encrypted on this device before it is stored on-chain.",
          )}
        />
      </div>
    </div>
  );
}
