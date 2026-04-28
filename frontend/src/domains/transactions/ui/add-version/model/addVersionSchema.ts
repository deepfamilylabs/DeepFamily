import { z } from "zod";

export const addVersionSchema = z.object({
  fatherVersionIndex: z
    .union([z.number().int().min(0), z.literal("")])
    .transform((value) => (value === "" ? 0 : value)),
  motherVersionIndex: z
    .union([z.number().int().min(0), z.literal("")])
    .transform((value) => (value === "" ? 0 : value)),
  tag: z.string().max(50, "Tag too long"),
  metadataCID: z.string().optional(),
});
