/**
 * Story Chunk Types Configuration
 *
 * Defines the 18 comprehensive chunk types for person biographies,
 * based on Wikipedia and Baidu Baike standards.
 *
 * Each chunk type includes:
 * - value: Numeric identifier (0-17)
 * - key: Translation key for i18n
 * - iconName: Lucide icon component name
 * - colorClass: Tailwind color classes for display
 */

import type { LucideIcon } from 'lucide-react'
import {
  FileCheck, Baby, BookOpen, Award, Briefcase, Lightbulb,
  Quote, MessageSquare, Home, Calendar, Users, Handshake,
  StickyNote, AlertCircle, Image, Star, BookMarked, Edit3, Palette, BadgeCheck
} from 'lucide-react'

export interface ChunkTypeConfig {
  value: number
  key: string
  label: string
  icon: LucideIcon
  colorClass: string
  borderColorClass: string
}

export interface ChunkTypeOption {
  value: number
  label: string
  icon: LucideIcon
  color: string
}

/**
 * All 18 chunk types for person biographies
 *
 * Categories:
 * 0. Summary - Brief overview
 * 1. Early Life - Birth, childhood, education
 * 2. Biography - Detailed life story
 * 3. Achievements - Major accomplishments, honors
 * 4. Works - Publications, creations, products
 * 5. Philosophy - Thoughts, beliefs, values
 * 6. Quotes - Famous sayings, memorable words
 * 7. Anecdotes - Stories, interesting facts
 * 8. Family - Family members, marriage, children
 * 9. Lifestyle - Hobbies, interests, daily life
 * 10. Relations - Interpersonal relationships
 * 11. Activities - Social activities, charity
 * 12. Positions - Jobs, titles, roles
 * 13. Controversies - Controversial events
 * 14. Gallery - Photos, images, media
 * 15. Legacy - Influence, evaluation, commemoration
 * 16. References - Sources, citations
 * 17. Notes - Additional notes, corrections
 */
export const CHUNK_TYPES: readonly ChunkTypeConfig[] = [
  { value: 0, key: 'summary', label: 'Summary', icon: FileCheck, colorClass: 'text-blue-600 dark:text-blue-400', borderColorClass: 'border-blue-600 dark:border-blue-400' },
  { value: 1, key: 'earlyLife', label: 'Early Life', icon: Baby, colorClass: 'text-pink-600 dark:text-pink-400', borderColorClass: 'border-pink-600 dark:border-pink-400' },
  { value: 2, key: 'biography', label: 'Biography', icon: BookOpen, colorClass: 'text-indigo-600 dark:text-indigo-400', borderColorClass: 'border-indigo-600 dark:border-indigo-400' },
  { value: 3, key: 'achievements', label: 'Achievements', icon: Award, colorClass: 'text-yellow-600 dark:text-yellow-400', borderColorClass: 'border-yellow-600 dark:border-yellow-400' },
  { value: 4, key: 'works', label: 'Works', icon: Briefcase, colorClass: 'text-green-600 dark:text-green-400', borderColorClass: 'border-green-600 dark:border-green-400' },
  { value: 5, key: 'philosophy', label: 'Philosophy', icon: Lightbulb, colorClass: 'text-amber-600 dark:text-amber-400', borderColorClass: 'border-amber-600 dark:border-amber-400' },
  { value: 6, key: 'quotes', label: 'Quotes', icon: Quote, colorClass: 'text-purple-600 dark:text-purple-400', borderColorClass: 'border-purple-600 dark:border-purple-400' },
  { value: 7, key: 'anecdotes', label: 'Anecdotes', icon: MessageSquare, colorClass: 'text-orange-600 dark:text-orange-400', borderColorClass: 'border-orange-600 dark:border-orange-400' },
  { value: 8, key: 'family', label: 'Family', icon: Home, colorClass: 'text-red-600 dark:text-red-400', borderColorClass: 'border-red-600 dark:border-red-400' },
  { value: 9, key: 'lifestyle', label: 'Lifestyle', icon: Calendar, colorClass: 'text-teal-600 dark:text-teal-400', borderColorClass: 'border-teal-600 dark:border-teal-400' },
  { value: 10, key: 'relations', label: 'Relations', icon: Users, colorClass: 'text-cyan-600 dark:text-cyan-400', borderColorClass: 'border-cyan-600 dark:border-cyan-400' },
  { value: 11, key: 'activities', label: 'Activities', icon: Handshake, colorClass: 'text-emerald-600 dark:text-emerald-400', borderColorClass: 'border-emerald-600 dark:border-emerald-400' },
  { value: 12, key: 'positions', label: 'Positions', icon: BadgeCheck, colorClass: 'text-slate-600 dark:text-slate-400', borderColorClass: 'border-slate-600 dark:border-slate-400' },
  { value: 13, key: 'controversies', label: 'Controversies', icon: AlertCircle, colorClass: 'text-rose-600 dark:text-rose-400', borderColorClass: 'border-rose-600 dark:border-rose-400' },
  { value: 14, key: 'gallery', label: 'Gallery', icon: Image, colorClass: 'text-fuchsia-600 dark:text-fuchsia-400', borderColorClass: 'border-fuchsia-600 dark:border-fuchsia-400' },
  { value: 15, key: 'legacy', label: 'Legacy', icon: Star, colorClass: 'text-violet-600 dark:text-violet-400', borderColorClass: 'border-violet-600 dark:border-violet-400' },
  { value: 16, key: 'references', label: 'References', icon: BookMarked, colorClass: 'text-blue-700 dark:text-blue-300', borderColorClass: 'border-blue-700 dark:border-blue-300' },
  { value: 17, key: 'notes', label: 'Notes', icon: StickyNote, colorClass: 'text-gray-600 dark:text-gray-400', borderColorClass: 'border-gray-600 dark:border-gray-400' }
] as const

/**
 * Map of chunk type values to their configurations
 */
export const CHUNK_TYPE_MAP = new Map<number, ChunkTypeConfig>(
  CHUNK_TYPES.map(type => [type.value, type])
)

/**
 * Get chunk type configuration by value
 */
export function getChunkTypeConfig(value: number | string | null | undefined): ChunkTypeConfig | undefined {
  if (value === null || value === undefined) return undefined
  const numValue = typeof value === 'string' ? parseInt(value, 10) : value
  if (isNaN(numValue)) return undefined
  return CHUNK_TYPE_MAP.get(numValue)
}

/**
 * Get the translation key for a chunk type
 */
export function getChunkTypeI18nKey(value: number | string | null | undefined): string {
  const config = getChunkTypeConfig(value)
  return config ? `chunkTypes.${config.key}` : 'chunkTypes.unknown'
}

/**
 * Get the icon component for a chunk type
 */
export function getChunkTypeIcon(value: number | string | null | undefined): LucideIcon {
  const config = getChunkTypeConfig(value)
  return config?.icon || Edit3
}

/**
 * Get the color class for a chunk type
 */
export function getChunkTypeColorClass(value: number | string | null | undefined): string {
  const config = getChunkTypeConfig(value)
  return config?.colorClass || 'text-gray-600 dark:text-gray-400'
}

/**
 * Get the border color class for a chunk type
 */
export function getChunkTypeBorderColorClass(value: number | string | null | undefined): string {
  const config = getChunkTypeConfig(value)
  return config?.borderColorClass || 'border-gray-600 dark:border-gray-400'
}

/**
 * Get chunk type options with translations
 * Use this in React components with useTranslation hook
 *
 * @param t - Translation function from useTranslation
 * @returns Array of chunk type options with translated labels
 *
 * @example
 * ```tsx
 * const { t } = useTranslation()
 * const options = getChunkTypeOptions(t)
 * ```
 */
export function getChunkTypeOptions(t: any): ChunkTypeOption[] {
  return CHUNK_TYPES.map(type => ({
    value: type.value,
    label: t(`chunkTypes.${type.key}`, type.label),
    icon: type.icon,
    color: type.colorClass
  }))
}
