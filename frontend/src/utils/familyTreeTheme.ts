export type FamilyTreeThemeMode = "svg" | "html";

export type FamilyTreeThemeText = { svg: string; html: string };

export type FamilyTreeNodeTheme = {
  baseShapeClass: string;
  baseShapeStrokeWidth: number;

  titleText: FamilyTreeThemeText;
  shortHashText: FamilyTreeThemeText;
  versionText: FamilyTreeThemeText;
  infoText: FamilyTreeThemeText;

  tagBadgeBgClass: string;
  tagBadgeText: FamilyTreeThemeText;

  endorseBadgeBgClass: string;
  endorseStarClass: string;
  endorseCountText: FamilyTreeThemeText;
};

type ThemeColors = {
  base: string;
  stroke: string;
  title: string;
  body: string;
  meta: string;
  badgeBg: string;
  badgeText: string;
  star: string;
};

const createTheme = (color: string): ThemeColors => {
  // Colors that are naturally light need darker text shades for contrast
  const isLightColor = ["yellow", "lime", "amber", "cyan", "green"].includes(color);
  
  // Define shades based on contrast needs
  // Title: Darkest
  const titleShade = isLightColor ? 900 : 700;
  const titleDarkShade = isLightColor ? 100 : 300;

  // Body: Medium (Info text like Birth Date/Place)
  const bodyShade = isLightColor ? 800 : 600;
  const bodyDarkShade = isLightColor ? 200 : 400;

  // Meta: Lightest legible (Hash, Version)
  const metaShade = isLightColor ? 700 : 500;
  const metaDarkShade = isLightColor ? 300 : 500;

  return {
    base: `fill-${color}-50 dark:fill-${color}-900/20`,
    stroke: `stroke-${color}-300 dark:stroke-${color}-400`,
    
    // All text uses the theme color, just different shades
    title: `text-${color}-${titleShade} dark:text-${color}-${titleDarkShade}`,
    body: `text-${color}-${bodyShade} dark:text-${color}-${bodyDarkShade}`,
    meta: `text-${color}-${metaShade} dark:text-${color}-${metaDarkShade}`,
    
    badgeBg: `fill-${color}-100 dark:fill-${color}-800/60`,
    badgeText: `text-${color}-${titleShade} dark:text-${color}-${titleDarkShade}`,
    star: `fill-${color}-500`,
  };
};

const THEMES: Record<string, ThemeColors> = {
  default: createTheme("emerald"),
  slate: createTheme("slate"),
  red: createTheme("red"),
  orange: createTheme("orange"),
  amber: createTheme("amber"),
  yellow: createTheme("yellow"),
  lime: createTheme("lime"),
  green: createTheme("green"),
  emerald: createTheme("emerald"),
  teal: createTheme("teal"),
  cyan: createTheme("cyan"),
  sky: createTheme("sky"),
  blue: createTheme("blue"),
  indigo: createTheme("indigo"),
  violet: createTheme("violet"),
  purple: createTheme("purple"),
  fuchsia: createTheme("fuchsia"),
  pink: createTheme("pink"),
  rose: createTheme("rose"),
};

export function getFamilyTreeNodeTheme(opts: {
  minted: boolean;
  selected: boolean;
  themeName?: string;
}): FamilyTreeNodeTheme {
  const { minted, selected, themeName = "default" } = opts;
  const theme = THEMES[themeName] || THEMES["default"];

  const baseShapeClass = minted
    ? `${theme.base} ${theme.stroke}`
    : selected
      ? "fill-amber-50 dark:fill-amber-900/20 stroke-amber-400 dark:stroke-amber-400/80"
      : "fill-white/70 dark:fill-slate-900/40 stroke-slate-300 dark:stroke-slate-600";

  const baseShapeStrokeWidth = minted ? 1 : selected ? 2 : 1;

  const titleText: FamilyTreeThemeText = minted
    ? {
        html: theme.title,
        svg: theme.title.replace(/text-/g, "fill-"),
      }
    : { html: "text-slate-900 dark:text-slate-100", svg: "fill-slate-900 dark:fill-slate-100" };

  const shortHashText: FamilyTreeThemeText = minted
    ? {
        html: theme.meta,
        svg: theme.meta.replace(/text-/g, "fill-"),
      }
    : { html: "text-slate-600 dark:text-slate-400", svg: "fill-slate-600 dark:fill-slate-400" };

  const versionText: FamilyTreeThemeText = minted
    ? {
        html: theme.body,
        svg: theme.body.replace(/text-/g, "fill-"),
      }
    : selected
      ? { html: "text-amber-600 dark:text-amber-300", svg: "fill-amber-600 dark:fill-amber-300" }
      : { html: "text-slate-600 dark:text-slate-400", svg: "fill-slate-600 dark:fill-slate-400" };

  const tagBadgeBgClass = minted
    ? theme.badgeBg
    : "fill-slate-100 dark:fill-slate-800/60";

  const tagBadgeText: FamilyTreeThemeText = minted
    ? {
        html: theme.badgeText,
        svg: theme.badgeText.replace(/text-/g, "fill-"),
      }
    : { html: "text-slate-700 dark:text-slate-300", svg: "fill-slate-700 dark:fill-slate-300" };

  const endorseBadgeBgClass = tagBadgeBgClass;
  const endorseStarClass = minted ? theme.star : "fill-slate-500";
  const endorseCountText = tagBadgeText;

  const infoText: FamilyTreeThemeText = minted
    ? {
        html: theme.body,
        svg: theme.body.replace(/text-/g, "fill-"),
      }
    : { html: "text-slate-600 dark:text-slate-400", svg: "fill-slate-600 dark:fill-slate-400" };

  return {
    baseShapeClass,
    baseShapeStrokeWidth,
    titleText,
    shortHashText,
    versionText,
    infoText,
    tagBadgeBgClass,
    tagBadgeText,
    endorseBadgeBgClass,    endorseStarClass,
    endorseCountText,
  };
}
