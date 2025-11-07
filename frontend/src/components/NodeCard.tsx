import React from 'react'
import { getGenderColor } from '../constants/genderColors'

export interface NodeCardProps {
  w: number
  h: number
  minted: boolean
  selected: boolean
  hover: boolean
  versionText: string
  titleText?: string
  tagText?: string
  gender?: number
  birthPlace?: string
  birthDateText?: string
  shortHashText: string
  endorsementCount?: number
  totalVersions?: number  // Total number of versions for this person
}

const PADDING_X = 12
const TITLE_START_Y = 26
const TITLE_LINE_H = 18
const TITLE_TO_TAG_GAP = 6
const BODY_LINE_H = 16
const BODY_LINE_GAP = 4
const FOOTER_BADGE_H = 16
const FOOTER_PADDING = 12
const SMALL_CHAR_W = 7
const TAG_BADGE_H = 16
const TAG_GAP = 4
const GENDER_DOT_R = 4

function buildStarPath(cx: number, cy: number, spikes = 5, outerR = 6.5, innerR = 3.5): string {
  const step = Math.PI / spikes
  let rot = -Math.PI / 2
  let path = ''
  for (let i = 0; i < spikes * 2; i++) {
    const r = (i % 2 === 0) ? outerR : innerR
    const x = cx + Math.cos(rot) * r
    const y = cy + Math.sin(rot) * r
    path += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`)
    rot += step
  }
  path += ' Z'
  return path
}

export default function NodeCard(props: NodeCardProps) {
  const { w, h, minted, selected, hover, versionText, titleText, tagText, gender, birthPlace, birthDateText, shortHashText, endorsementCount, totalVersions } = props

  // Only show badge when totalVersions is explicitly passed (deduplicate mode) and > 1
  const hasMultipleVersions = typeof totalVersions === 'number' && totalVersions > 1

  const baseRect = minted
    ? 'fill-emerald-50 dark:fill-emerald-900/20 stroke-emerald-300 dark:stroke-emerald-400'
    : selected
      ? 'fill-amber-50 dark:fill-amber-900/20 stroke-amber-400 dark:stroke-amber-400/80'
      : 'fill-white/70 dark:fill-slate-900/40 stroke-slate-300 dark:stroke-slate-600'
  const hoverStroke = (!selected && hover) ? 'stroke-blue-500 dark:stroke-blue-400' : ''
  const cardShadow = hover ? 'shadow-lg' : 'shadow-md'

  const innerWidth = w - PADDING_X * 2
  const hasTitle = Boolean(titleText)
  const tag = (tagText || '').trim()

  const genderClass = getGenderColor(gender, 'SVG_FILL')

  const showTag = Boolean(tag)

  const yTag = TITLE_START_Y + (hasTitle ? TITLE_TO_TAG_GAP : 0)
  const textW = (tag || '').length * SMALL_CHAR_W
  const padLeft = 6
  const padRight = 6
  const badgeW = Math.min(w - PADDING_X * 2, Math.max(30, textW + padLeft + padRight))

  // Bottom-up layout to avoid collision when card height is reduced.
  // Hash stays at bottom-left; birth date sits above hash; birth place sits above date.
  const footerHashY = h - FOOTER_PADDING - 2
  const bodyY2 = footerHashY - (BODY_LINE_H + BODY_LINE_GAP) // birth date
  const bodyY1 = bodyY2 - (BODY_LINE_H + BODY_LINE_GAP) // birth place

  // Determine if there is space to render tag and divider without colliding with body
  const tagFits = showTag ? ((yTag + TAG_BADGE_H + 4) < bodyY1) : false
  const renderTag = showTag && tagFits
  const dividerY = renderTag
    ? (yTag + TAG_BADGE_H + TAG_GAP)
    : (TITLE_START_Y + (hasTitle ? 1 : 0) * TITLE_LINE_H)
  const dividerSafeY = Math.min(dividerY, bodyY1 - (BODY_LINE_GAP + 6))

  return (
    <>
      <rect
        width={w}
        height={h}
        rx={12}
        ry={12}
        className={`${baseRect} ${hoverStroke} ${cardShadow} transition-colors transition-shadow`}
        strokeWidth={minted || selected ? 2 : 1}
      />
      <rect width={w} height={h} rx={12} ry={12} fill="url(#cardGlossGrad)" className="dark:opacity-0" />

      {/* Multi-version badge: background bar at top with rounded corners */}
      {hasMultipleVersions && (
        <>
          {/* Light blue background bar at top with rounded corners - fits inside card */}
          <path
            d={`M 1 12 Q 1 1 12 1 L ${w - 12} 1 Q ${w - 1} 1 ${w - 1} 12 L ${w - 1} 12 L 1 12 Z`}
            className={`${minted ? 'fill-sky-500/20 dark:fill-sky-500/20' : selected ? 'fill-blue-500/20 dark:fill-blue-500/20' : 'fill-cyan-500/20 dark:fill-cyan-500/20'}`}
          />
        </>
      )}

      {/* Version display at top-right corner */}
      <text className="font-mono">
        <tspan
          x={w - 7}
          y={8}
          textAnchor="end"
          dominantBaseline="middle"
          className={`text-[10px] ${minted ? 'fill-emerald-600 dark:fill-emerald-400' : selected ? 'fill-amber-600 dark:fill-amber-300' : 'fill-slate-600 dark:fill-slate-400'}`}
        >
          {hasMultipleVersions ? `T${totalVersions}:${versionText}` : versionText}
        </tspan>
      </text>

      {/* Gender dot (top-left corner) */}
      <circle cx={9} cy={7} r={GENDER_DOT_R} className={genderClass} />

      {/* Title */}
      {hasTitle && (
        <foreignObject
          x={PADDING_X}
          y={TITLE_START_Y - TITLE_LINE_H + 4}
          width={innerWidth}
          height={TITLE_LINE_H + 4}
          pointerEvents="none"
        >
          <div
            className={`font-medium text-[15px] leading-[18px] ${minted ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100'} overflow-hidden text-ellipsis whitespace-nowrap`}
          >
            {titleText}
          </div>
        </foreignObject>
      )}

      {/* TAG badge (hidden if insufficient height) */}
      {renderTag && (
        <>
          <rect x={PADDING_X} y={yTag} width={badgeW} height={TAG_BADGE_H} rx={8} ry={8} className={`${minted ? 'fill-emerald-100 dark:fill-emerald-800/60' : 'fill-slate-100 dark:fill-slate-800/60'}`} />
          <foreignObject x={PADDING_X} y={yTag} width={badgeW} height={TAG_BADGE_H} pointerEvents="none">
            <div
              className={`font-mono text-[11px] leading-[16px] ${minted ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300'} overflow-hidden text-ellipsis whitespace-nowrap px-[6px]`}
            >
              {tag}
            </div>
          </foreignObject>
        </>
      )}

      {/* Divider line (if title exists, moves up with height compression, at most below body upper boundary) */}
      {hasTitle && dividerSafeY > TITLE_START_Y + 2 && (
        <line x1={PADDING_X} x2={w - PADDING_X} y1={dividerSafeY} y2={dividerSafeY} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={1} />
      )}

      {/* Additional NFT information */}
      {minted && (birthPlace || birthDateText) && (
        <>
          {birthPlace && (
            <foreignObject
              x={PADDING_X}
              y={bodyY1 - BODY_LINE_H + 2}
              width={innerWidth}
              height={BODY_LINE_H + 2}
              pointerEvents="none"
            >
              <div
                className={`font-sans text-[12px] leading-[16px] ${minted ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300'} overflow-hidden text-ellipsis whitespace-nowrap`}
              >
                {birthPlace}
              </div>
            </foreignObject>
          )}
          {birthDateText && (
            <text className="font-sans">
              <tspan x={PADDING_X} y={bodyY2} className={`text-[12px] ${minted ? 'fill-emerald-600 dark:fill-emerald-400' : 'fill-slate-600 dark:fill-slate-400'}`}>{birthDateText}</tspan>
            </text>
          )}
        </>
      )}

      {/* Bottom: left short hash + right star endorsement */}
      <text className="font-mono">
        <tspan x={PADDING_X} y={h - FOOTER_PADDING - 2} className={`text-[12px] ${minted ? 'fill-emerald-700 dark:fill-emerald-300' : 'fill-slate-600 dark:fill-slate-400'}`}>{shortHashText}</tspan>
      </text>
      {typeof endorsementCount === 'number' && (
        (() => { const txt = String(endorsementCount); const badgeW = Math.max(24, 12 + txt.length * 7); const x = w - badgeW - (FOOTER_PADDING - 2); const y = h - FOOTER_PADDING - FOOTER_BADGE_H; const cx = x + 8; const cy = y + FOOTER_BADGE_H / 2; const starPath = buildStarPath(cx, cy); return (
          <>
            <rect x={x} y={y} width={badgeW} height={FOOTER_BADGE_H} rx={8} ry={8} className={`${minted ? 'fill-emerald-100 dark:fill-emerald-800/60' : 'fill-slate-100 dark:fill-slate-800/60'} stroke-transparent`} />
            <path d={starPath} className={`${minted ? 'fill-emerald-500' : 'fill-slate-500'}`} />
            <text className="font-mono"><tspan x={x + 8 + 8} y={y + 12} textAnchor="start" className={`text-[12px] ${minted ? 'fill-emerald-700 dark:fill-emerald-300' : 'fill-slate-700 dark:fill-slate-300'}`}>{txt}</tspan></text>
          </>
        ) })()
      )}
    </>
  )
}
