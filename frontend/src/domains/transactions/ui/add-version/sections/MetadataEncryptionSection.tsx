import { useId } from "react";
import type { UseFormRegister } from "react-hook-form";
import { MODAL_LABEL, MODAL_TEXTAREA, modalField } from "../../../../../shared/ui";
import { TAG_MAX_BYTES, utf8Length } from "../model/addVersionSchema";
import type { AddVersionFormInput, AddVersionT } from "../model/addVersionTypes";

export interface MetadataEncryptionSectionProps {
  t: AddVersionT;
  register: UseFormRegister<AddVersionFormInput>;
  isSubmitting: boolean;
  /** The tag as typed, for its live byte count. */
  tagValue?: string;
  /** The schema turned the tag down on submit. */
  tagInvalid?: boolean;
}

/**
 * The version's private tag and biography. The tag is capped in bytes rather
 * than characters — a CJK character takes three — so it counts them as you
 * type, and the count and the field turn red once it is over, instead of the
 * submit failing without a sign.
 */
export function MetadataEncryptionSection({
  t,
  register,
  isSubmitting,
  tagValue = "",
  tagInvalid = false,
}: MetadataEncryptionSectionProps) {
  const tagId = useId();
  const biographyId = useId();
  const tagCountId = `${tagId}-count`;
  const tagBytes = utf8Length(tagValue);
  const tagOverLimit = tagInvalid || tagBytes > TAG_MAX_BYTES;

  return (
    <div className="space-y-4 pt-4 border-t border-hairline mt-2!">
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={tagId} className={MODAL_LABEL}>
            {t("addVersion.tag", "Tag")}
          </label>
          <span
            id={tagCountId}
            className={`text-[11px] tabular-nums ${tagOverLimit ? "text-danger" : "text-ink-subtle"}`}
          >
            {tagBytes}/{TAG_MAX_BYTES}
          </span>
        </div>
        <input
          id={tagId}
          {...register("tag")}
          aria-invalid={tagOverLimit || undefined}
          aria-describedby={tagCountId}
          disabled={isSubmitting}
          className={`${modalField(tagOverLimit)} disabled:opacity-60`}
          placeholder={t("addVersion.tagPlaceholder", "e.g. From the family register")}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor={biographyId} className={MODAL_LABEL}>
          {t("addVersion.biography", "Biography")}
        </label>
        <textarea
          id={biographyId}
          {...register("biography")}
          disabled={isSubmitting}
          rows={5}
          className={`${MODAL_TEXTAREA} disabled:opacity-60 whitespace-pre-wrap`}
          placeholder={t("addVersion.biographyPlaceholder", "Life story, deeds, family memories…")}
        />
      </div>
    </div>
  );
}
