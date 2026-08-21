import { z } from "zod";

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

export const addVersionSchema = z.object({
  fatherVersionIndex: z
    .union([z.number().int().min(0), z.literal("")])
    .transform((value) => (value === "" ? 0 : value)),
  motherVersionIndex: z
    .union([z.number().int().min(0), z.literal("")])
    .transform((value) => (value === "" ? 0 : value)),
  tag: z.string().refine((value) => utf8Length(value) <= 256, "Tag exceeds 256 UTF-8 bytes"),
  biography: z.string(),
});
