/**
 * Gender color constants for consistent styling across all views
 */

export const GENDER_COLORS = {
  // SVG fill classes for NodeCard
  SVG_FILL: {
    MALE: "fill-sky-500", // Male - Blue
    FEMALE: "fill-pink-400", // Female - Pink
    OTHER: "fill-violet-500", // Other - Purple
    UNKNOWN: "fill-slate-400", // Unknown - Gray
  },

  // Background classes for FamilyTree and other components
  BG: {
    MALE: "bg-sky-500", // Male - Blue
    FEMALE: "bg-pink-400", // Female - Pink
    OTHER: "bg-violet-500", // Other - Purple
    UNKNOWN: "bg-slate-400", // Unknown - Gray
  },

  // Text color classes
  TEXT: {
    MALE: "text-sky-500", // Male - Blue
    FEMALE: "text-pink-400", // Female - Pink
    OTHER: "text-violet-500", // Other - Purple
    UNKNOWN: "text-slate-400", // Unknown - Gray
  },

  // Border color classes
  BORDER: {
    MALE: "border-sky-500", // Male - Blue
    FEMALE: "border-pink-400", // Female - Pink
    OTHER: "border-violet-500", // Other - Purple
    UNKNOWN: "border-slate-400", // Unknown - Gray
  },
} as const;

/**
 * Hex color values for D3 and other libraries that need hex colors
 */
export const GENDER_HEX_COLORS = {
  MALE: "#0ea5e9", // sky-500
  FEMALE: "#f472b6", // pink-400
  OTHER: "#8b5cf6", // violet-500
  UNKNOWN: "#94a3b8", // slate-400
} as const;

/**
 * Get gender color class by gender value and color type
 */
export function getGenderColor(
  gender: number | undefined,
  type: keyof typeof GENDER_COLORS = "BG",
): string {
  const colors = GENDER_COLORS[type];

  switch (gender) {
    case 1:
      return colors.MALE;
    case 2:
      return colors.FEMALE;
    case 3:
      return colors.OTHER;
    default:
      return colors.UNKNOWN;
  }
}

/**
 * Get gender hex color by gender value
 */
export function getGenderColorHex(gender: number | undefined): string {
  switch (gender) {
    case 1:
      return GENDER_HEX_COLORS.MALE;
    case 2:
      return GENDER_HEX_COLORS.FEMALE;
    case 3:
      return GENDER_HEX_COLORS.OTHER;
    default:
      return GENDER_HEX_COLORS.UNKNOWN;
  }
}

/**
 * Gender constants for reference
 */
export const GENDER = {
  UNKNOWN: 0,
  MALE: 1,
  FEMALE: 2,
  OTHER: 3,
} as const;

export type GenderType = (typeof GENDER)[keyof typeof GENDER];
