export type FamilyTreeThemeMode = 'svg' | 'html'

export type FamilyTreeThemeText = { svg: string; html: string }

export type FamilyTreeNodeTheme = {
  baseShapeClass: string
  baseShapeStrokeWidth: number

  titleText: FamilyTreeThemeText
  shortHashText: FamilyTreeThemeText
  versionText: FamilyTreeThemeText

  tagBadgeBgClass: string
  tagBadgeText: FamilyTreeThemeText

  endorseBadgeBgClass: string
  endorseStarClass: string
  endorseCountText: FamilyTreeThemeText
}

export function getFamilyTreeNodeTheme(opts: { minted: boolean; selected: boolean }): FamilyTreeNodeTheme {
  const { minted, selected } = opts

  const baseShapeClass = minted
    ? 'fill-emerald-50 dark:fill-emerald-900/20 stroke-emerald-300 dark:stroke-emerald-400'
    : selected
      ? 'fill-amber-50 dark:fill-amber-900/20 stroke-amber-400 dark:stroke-amber-400/80'
      : 'fill-white/70 dark:fill-slate-900/40 stroke-slate-300 dark:stroke-slate-600'

  const baseShapeStrokeWidth = minted ? 1 : selected ? 2 : 1

  const titleText: FamilyTreeThemeText = minted
    ? { html: 'text-emerald-700 dark:text-emerald-300', svg: 'fill-emerald-700 dark:fill-emerald-300' }
    : { html: 'text-slate-900 dark:text-slate-100', svg: 'fill-slate-900 dark:fill-slate-100' }

  const shortHashText: FamilyTreeThemeText = minted
    ? { html: 'text-emerald-700 dark:text-emerald-300', svg: 'fill-emerald-700 dark:fill-emerald-300' }
    : { html: 'text-slate-600 dark:text-slate-400', svg: 'fill-slate-600 dark:fill-slate-400' }

  const versionText: FamilyTreeThemeText = minted
    ? { html: 'text-emerald-600 dark:text-emerald-400', svg: 'fill-emerald-600 dark:fill-emerald-400' }
    : selected
      ? { html: 'text-amber-600 dark:text-amber-300', svg: 'fill-amber-600 dark:fill-amber-300' }
      : { html: 'text-slate-600 dark:text-slate-400', svg: 'fill-slate-600 dark:fill-slate-400' }

  const tagBadgeBgClass = minted
    ? 'fill-emerald-100 dark:fill-emerald-800/60'
    : 'fill-slate-100 dark:fill-slate-800/60'

  const tagBadgeText: FamilyTreeThemeText = minted
    ? { html: 'text-emerald-700 dark:text-emerald-300', svg: 'fill-emerald-700 dark:fill-emerald-300' }
    : { html: 'text-slate-700 dark:text-slate-300', svg: 'fill-slate-700 dark:fill-slate-300' }

  const endorseBadgeBgClass = tagBadgeBgClass
  const endorseStarClass = minted ? 'fill-emerald-500' : 'fill-slate-500'
  const endorseCountText = tagBadgeText

  return {
    baseShapeClass,
    baseShapeStrokeWidth,
    titleText,
    shortHashText,
    versionText,
    tagBadgeBgClass,
    tagBadgeText,
    endorseBadgeBgClass,
    endorseStarClass,
    endorseCountText
  }
}
