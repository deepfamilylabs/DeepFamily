import { z } from "zod";
import type { MintNFTT } from "./mintNftTypes";

export function isValidTokenUri(value: string) {
  if (value === "") return true;
  if (value.startsWith("ipfs://")) return value.length > "ipfs://".length;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const createMintNFTSchema = (t: MintNFTT) =>
  z
    .object({
      birthPlace: z.string().max(256, t("mintNFT.validation.birthPlaceTooLong")),
      isDeathBC: z.boolean(),
      deathYear: z.union([z.number().int().min(0).max(9999), z.string()]).transform((value) => {
        if (value === "" || value === undefined) return 0;
        return typeof value === "string" ? (value === "" ? 0 : parseInt(value, 10)) : value;
      }),
      deathMonth: z.union([z.number().int().min(0).max(12), z.string()]).transform((value) => {
        if (value === "" || value === undefined) return 0;
        return typeof value === "string" ? (value === "" ? 0 : parseInt(value, 10)) : value;
      }),
      deathDay: z.union([z.number().int().min(0).max(31), z.string()]).transform((value) => {
        if (value === "" || value === undefined) return 0;
        return typeof value === "string" ? (value === "" ? 0 : parseInt(value, 10)) : value;
      }),
      deathPlace: z.string().max(256, t("mintNFT.validation.deathPlaceTooLong")),
      story: z.string().max(256, t("mintNFT.validation.storyTooLong")),
      tokenURI: z
        .string()
        .max(256, t("mintNFT.validation.tokenURITooLong"))
        .optional()
        .or(z.literal(""))
        .refine((value) => isValidTokenUri(value ?? ""), t("mintNFT.validation.invalidTokenURI")),
    })
    .refine(
      (data) => {
        if (!data.isDeathBC && data.deathYear > new Date().getFullYear()) {
          return false;
        }
        return true;
      },
      {
        message: t("mintNFT.validation.yearExceedsCurrent"),
        path: ["deathYear"],
      },
    );

export type MintNFTSchema = ReturnType<typeof createMintNFTSchema>;
