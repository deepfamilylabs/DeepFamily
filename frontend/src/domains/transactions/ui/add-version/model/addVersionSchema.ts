import { z } from "zod";

/** Tags are capped in UTF-8 bytes, not characters: a CJK character takes three. */
export const TAG_MAX_BYTES = 256;

export const utf8Length = (value: string) => new TextEncoder().encode(value).length;

export const addVersionSchema = z.object({
  fatherVersionIndex: z
    .union([z.number().int().min(0), z.literal("")])
    .transform((value) => (value === "" ? 0 : value)),
  motherVersionIndex: z
    .union([z.number().int().min(0), z.literal("")])
    .transform((value) => (value === "" ? 0 : value)),
  tag: z
    .string()
    .refine((value) => utf8Length(value) <= TAG_MAX_BYTES, "Tag exceeds 256 UTF-8 bytes"),
  biography: z.string(),
});
