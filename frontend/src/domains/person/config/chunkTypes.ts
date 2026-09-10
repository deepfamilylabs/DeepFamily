/**
 * Story Chunk Types Configuration
 *
 * Defines the reserved mint biography and 19 editable chunk types for person biographies
 *
 * Each chunk type includes:
 * - value: Numeric identifier (0-19)
 * - key: Translation key for i18n
 * - icon: Lucide icon component
 * - colorClass: Tailwind color classes for text
 * - borderColorClass: Tailwind color classes for borders
 *
 * Design Philosophy:
 * - These are content TYPE TAGS, not mutually exclusive chapters
 * - Multiple chunks can share the same type (e.g., multiple "Life Events")
 * - Types can be used in any order, allowing flexible storytelling
 * - Ordered by natural reading flow: Overview → Early Years → Life Narrative → Specialized Topics → Closing
 */

import type { LucideIcon } from "lucide-react";
import {
  FileCheck,
  Baby,
  GraduationCap,
  Calendar,
  Briefcase,
  BookOpen,
  Award,
  Lightbulb,
  Quote,
  Home,
  Heart,
  Users,
  Handshake,
  MessageSquare,
  AlertCircle,
  Star,
  Image,
  BookMarked,
  StickyNote,
  Edit3,
} from "lucide-react";

export interface ChunkTypeConfig {
  value: number;
  key: string;
  label: string;
  icon: LucideIcon;
  colorClass: string;
  borderColorClass: string;
}

export interface ChunkTypeOption {
  value: number;
  label: string;
  icon: LucideIcon;
  color: string;
}

/**
 * Type 0 is the immutable mint biography. The 19 editable content tags occupy
 * 1–19, from Summary through Notes. Tags may repeat and appear in any order.
 */
export const CHUNK_TYPES: readonly ChunkTypeConfig[] = [
  {
    value: 0,
    key: "biography",
    label: "Biography",
    icon: BookOpen,
    colorClass: "text-blue-600 dark:text-blue-400",
    borderColorClass: "border-blue-600 dark:border-blue-400",
  },
  // ==================== OPENING ====================
  {
    value: 1,
    key: "summary",
    label: "Summary",
    icon: FileCheck,
    colorClass: "text-blue-600 dark:text-blue-400",
    borderColorClass: "border-blue-600 dark:border-blue-400",
  },

  // ==================== EARLY YEARS ====================
  {
    value: 2,
    key: "earlyLife",
    label: "Early Life",
    icon: Baby,
    colorClass: "text-pink-600 dark:text-pink-400",
    borderColorClass: "border-pink-600 dark:border-pink-400",
  },
  {
    value: 3,
    key: "education",
    label: "Education",
    icon: GraduationCap,
    colorClass: "text-indigo-600 dark:text-indigo-400",
    borderColorClass: "border-indigo-600 dark:border-indigo-400",
  },

  // ==================== MAIN NARRATIVE ====================
  {
    value: 4,
    key: "lifeEvents",
    label: "Life Events",
    icon: Calendar,
    colorClass: "text-sky-600 dark:text-sky-400",
    borderColorClass: "border-sky-600 dark:border-sky-400",
  },

  // ==================== SPECIALIZED TOPICS ====================
  {
    value: 5,
    key: "career",
    label: "Career",
    icon: Briefcase,
    colorClass: "text-slate-600 dark:text-slate-400",
    borderColorClass: "border-slate-600 dark:border-slate-400",
  },
  {
    value: 6,
    key: "works",
    label: "Works",
    icon: BookOpen,
    colorClass: "text-green-600 dark:text-green-400",
    borderColorClass: "border-green-600 dark:border-green-400",
  },
  {
    value: 7,
    key: "achievements",
    label: "Achievements",
    icon: Award,
    colorClass: "text-yellow-600 dark:text-yellow-400",
    borderColorClass: "border-yellow-600 dark:border-yellow-400",
  },
  {
    value: 8,
    key: "philosophy",
    label: "Philosophy",
    icon: Lightbulb,
    colorClass: "text-amber-600 dark:text-amber-400",
    borderColorClass: "border-amber-600 dark:border-amber-400",
  },
  {
    value: 9,
    key: "quotes",
    label: "Quotes",
    icon: Quote,
    colorClass: "text-purple-600 dark:text-purple-400",
    borderColorClass: "border-purple-600 dark:border-purple-400",
  },

  // ==================== PERSONAL LIFE ====================
  {
    value: 10,
    key: "family",
    label: "Family",
    icon: Home,
    colorClass: "text-red-600 dark:text-red-400",
    borderColorClass: "border-red-600 dark:border-red-400",
  },
  {
    value: 11,
    key: "lifestyle",
    label: "Lifestyle",
    icon: Heart,
    colorClass: "text-rose-600 dark:text-rose-400",
    borderColorClass: "border-rose-600 dark:border-rose-400",
  },
  {
    value: 12,
    key: "relations",
    label: "Relations",
    icon: Users,
    colorClass: "text-cyan-600 dark:text-cyan-400",
    borderColorClass: "border-cyan-600 dark:border-cyan-400",
  },

  // ==================== SOCIAL ENGAGEMENT ====================
  {
    value: 13,
    key: "activities",
    label: "Activities",
    icon: Handshake,
    colorClass: "text-emerald-600 dark:text-emerald-400",
    borderColorClass: "border-emerald-600 dark:border-emerald-400",
  },
  {
    value: 14,
    key: "anecdotes",
    label: "Anecdotes",
    icon: MessageSquare,
    colorClass: "text-orange-600 dark:text-orange-400",
    borderColorClass: "border-orange-600 dark:border-orange-400",
  },
  {
    value: 15,
    key: "controversies",
    label: "Controversies",
    icon: AlertCircle,
    colorClass: "text-pink-700 dark:text-pink-400",
    borderColorClass: "border-pink-700 dark:border-pink-400",
  },

  // ==================== CLOSING ====================
  {
    value: 16,
    key: "legacy",
    label: "Legacy",
    icon: Star,
    colorClass: "text-violet-600 dark:text-violet-400",
    borderColorClass: "border-violet-600 dark:border-violet-400",
  },
  {
    value: 17,
    key: "gallery",
    label: "Media",
    icon: Image,
    colorClass: "text-fuchsia-600 dark:text-fuchsia-400",
    borderColorClass: "border-fuchsia-600 dark:border-fuchsia-400",
  },
  {
    value: 18,
    key: "references",
    label: "References",
    icon: BookMarked,
    colorClass: "text-blue-700 dark:text-blue-300",
    borderColorClass: "border-blue-700 dark:border-blue-300",
  },
  {
    value: 19,
    key: "notes",
    label: "Notes",
    icon: StickyNote,
    colorClass: "text-gray-600 dark:text-gray-400",
    borderColorClass: "border-gray-600 dark:border-gray-400",
  },
] as const;

/**
 * Map of chunk type values to their configurations
 */
export const CHUNK_TYPE_MAP = new Map<number, ChunkTypeConfig>(
  CHUNK_TYPES.map((type) => [type.value, type]),
);

/**
 * Get chunk type configuration by value
 */
export function getChunkTypeConfig(
  value: number | string | null | undefined,
): ChunkTypeConfig | undefined {
  if (value === null || value === undefined) return undefined;
  const numValue = typeof value === "string" ? parseInt(value, 10) : value;
  if (isNaN(numValue)) return undefined;
  return CHUNK_TYPE_MAP.get(numValue);
}

/**
 * Get the translation key for a chunk type
 */
export function getChunkTypeI18nKey(value: number | string | null | undefined): string {
  const config = getChunkTypeConfig(value);
  return config ? `chunkTypes.${config.key}` : "chunkTypes.unknown";
}

/**
 * Get the icon component for a chunk type
 */
export function getChunkTypeIcon(value: number | string | null | undefined): LucideIcon {
  const config = getChunkTypeConfig(value);
  return config?.icon || Edit3;
}

/**
 * Get the color class for a chunk type
 */
export function getChunkTypeColorClass(value: number | string | null | undefined): string {
  const config = getChunkTypeConfig(value);
  return config?.colorClass || "text-gray-600 dark:text-gray-400";
}

/**
 * Get the border color class for a chunk type
 */
export function getChunkTypeBorderColorClass(value: number | string | null | undefined): string {
  const config = getChunkTypeConfig(value);
  return config?.borderColorClass || "border-gray-600 dark:border-gray-400";
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
  return CHUNK_TYPES.map((type) => ({
    value: type.value,
    label: t(`chunkTypes.${type.key}`, type.label),
    icon: type.icon,
    color: type.colorClass,
  }));
}

/** Type zero is initialized only by NFT minting. */
export function getEditableChunkTypeOptions(t: any): ChunkTypeOption[] {
  return getChunkTypeOptions(t).filter((type) => type.value !== 0);
}
