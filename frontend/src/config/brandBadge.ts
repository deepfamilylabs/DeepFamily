/**
 * Brand Badge Configuration
 * Controls the badge display next to the DeepFamily logo
 */

export type BadgeType = 'alpha' | 'beta' | 'rc' | 'dev' | 'preview' | 'demo' | 'testnet' | 'mainnet' | 'none'

export interface BadgeConfig {
  text: string
  className: string
  colorClasses: string
}

const BADGE_CONFIGS: Record<BadgeType, BadgeConfig | null> = {
  alpha: {
    text: 'ALPHA',
    className: 'bg-gradient-to-r from-amber-400 to-orange-500 dark:from-amber-500 dark:to-orange-600',
    colorClasses: 'text-white shadow-sm'
  },
  beta: {
    text: 'BETA',
    className: 'bg-gradient-to-r from-blue-400 to-cyan-500 dark:from-blue-500 dark:to-cyan-600',
    colorClasses: 'text-white shadow-sm'
  },
  rc: {
    text: 'RC',
    className: 'bg-gradient-to-r from-purple-400 to-pink-500 dark:from-purple-500 dark:to-pink-600',
    colorClasses: 'text-white shadow-sm'
  },
  dev: {
    text: 'DEV',
    className: 'bg-gradient-to-r from-gray-400 to-gray-600 dark:from-gray-500 dark:to-gray-700',
    colorClasses: 'text-white shadow-sm'
  },
  preview: {
    text: 'PREVIEW',
    className: 'bg-gradient-to-r from-violet-400 to-indigo-500 dark:from-violet-500 dark:to-indigo-600',
    colorClasses: 'text-white shadow-sm'
  },
  demo: {
    text: 'DEMO',
    className: 'bg-gradient-to-r from-green-400 to-emerald-500 dark:from-green-500 dark:to-emerald-600',
    colorClasses: 'text-white shadow-sm'
  },
  testnet: {
    text: 'TESTNET',
    className: 'bg-gradient-to-r from-yellow-400 to-amber-500 dark:from-yellow-500 dark:to-amber-600',
    colorClasses: 'text-gray-900 dark:text-white shadow-sm'
  },
  mainnet: {
    text: 'MAINNET',
    className: 'bg-gradient-to-r from-emerald-400 to-teal-500 dark:from-emerald-500 dark:to-teal-600',
    colorClasses: 'text-white shadow-sm'
  },
  none: null
}

/**
 * Get the current badge configuration from environment
 */
export function getBadgeConfig(): BadgeConfig | null {
  const badgeType = (import.meta.env.VITE_BRAND_BADGE || 'none').toLowerCase() as BadgeType

  // Validate badge type
  if (!BADGE_CONFIGS.hasOwnProperty(badgeType)) {
    console.warn(`Invalid VITE_BRAND_BADGE value: "${badgeType}". Using "none".`)
    return null
  }

  return BADGE_CONFIGS[badgeType]
}

/**
 * Check if badge should be displayed
 */
export function shouldShowBadge(): boolean {
  return getBadgeConfig() !== null
}
