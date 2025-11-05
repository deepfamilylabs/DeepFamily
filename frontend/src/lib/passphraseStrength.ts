/**
 * Passphrase Strength Validation Utility
 *
 * Shared logic for validating passphrase strength across the application.
 * Used by PersonHashCalculator and SecureKeyDerivation components.
 */

/**
 * Normalize string for consistent hashing
 * Applies NFC normalization to ensure cross-platform compatibility
 */
export const normalizeForHash = (value: string): string => {
  if (!value) return ''
  const trimmed = value.trim()
  return typeof trimmed.normalize === 'function' ? trimmed.normalize('NFC') : trimmed
}

/**
 * Passphrase strength result
 */
export interface PassphraseStrength {
  isStrong: boolean
  entropy: number
  rawEntropy: number
  level: 'weak' | 'medium' | 'strong' | 'very-strong' | 'excellent'
  recommendation?: string
}

const COMMON_WEAK_PASSWORDS = new Set(
  [
    'password',
    '123456',
    '123456789',
    'qwerty123',
    'letmein',
    'welcome',
    'family2024',
    'deepfamily',
    'abc123',
    '111111',
    '000000',
    'iloveyou',
  ].map(entry => entry.toLowerCase())
)

const KEYBOARD_ROWS = [
  '1234567890',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
]

const MIN_UNICODE_CHARSET = 48

type GraphemeSplitter = (value: string) => string[]

const createGraphemeSplitter = (): GraphemeSplitter => {
  if (typeof Intl !== 'undefined' && typeof (Intl as any).Segmenter === 'function') {
    const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
    return (value: string): string[] => {
      if (!value) return []
      const segments: string[] = []
      for (const item of segmenter.segment(value)) {
        segments.push(item.segment)
      }
      return segments
    }
  }

  return (value: string): string[] => {
    if (!value) return []
    return Array.from(value)
  }
}

const splitGraphemes = createGraphemeSplitter()

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min
  if (value > max) return max
  return value
}

const hasSequentialPattern = (value: string): boolean => {
  if (!value || value.length < 4) return false

  const lower = value.toLowerCase()
  const checkSequence = (sequence: string): boolean => {
    for (let i = 0; i <= lower.length - 4; i += 1) {
      const segment = lower.slice(i, i + 4)
      if (sequence.includes(segment) || sequence.split('').reverse().join('').includes(segment)) {
        return true
      }
    }
    return false
  }

  for (const row of KEYBOARD_ROWS) {
    if (checkSequence(row)) return true
  }

  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  const digits = '0123456789'
  if (checkSequence(alphabet) || checkSequence(digits)) return true

  return false
}

const isRepeatedSequence = (value: string): boolean => {
  if (!value || value.length < 4) return false
  const normalized = value.toLowerCase()
  for (let size = 1; size <= Math.floor(normalized.length / 2); size += 1) {
    if (normalized.length % size !== 0) continue
    const chunk = normalized.slice(0, size)
    if (chunk.repeat(normalized.length / size) === normalized) {
      return true
    }
  }
  return false
}

/**
 * Calculate passphrase strength score.
 *
 * Pipeline:
 * 1. Compute `rawEntropy = length × log2(charset_size)` with charset inferred from actual character classes.
 * 2. Apply a series of heuristic penalties (repetition, pattern, short length) to derive the adjusted `entropy` score.
 *
 * Strength levels (applied to the adjusted entropy score):
 * - weak: < 50 (insufficient)
 * - medium: 50-79 (below recommended)
 * - strong: 80-127 (good security)
 * - very-strong: 128-191 (strong security)
 * - excellent: ≥ 192 (excellent security)
 *
 * @param passphrase - The passphrase to validate
 * @param includeRecommendation - Whether to include recommendation text (default: false)
 * @returns PassphraseStrength object
 */
export function validatePassphraseStrength(
  passphrase: string,
  includeRecommendation: boolean = false
): PassphraseStrength {
  const normalized = normalizeForHash(passphrase)

  if (!normalized) {
    return {
      isStrong: false,
      entropy: 0,
      rawEntropy: 0,
      level: 'weak',
      recommendation: includeRecommendation
        ? '⚠️ Empty passphrase: insufficient security. Strongly recommend 18+ character strong passphrase'
        : undefined,
    }
  }

  const graphemes = splitGraphemes(normalized)
  const length = graphemes.length

  if (length === 0) {
    return {
      isStrong: false,
      entropy: 0,
      rawEntropy: 0,
      level: 'weak',
      recommendation: includeRecommendation
        ? '⚠️ Empty passphrase: insufficient security. Strongly recommend 18+ character strong passphrase'
        : undefined,
    }
  }

  const lowered = normalized.toLowerCase()
  if (COMMON_WEAK_PASSWORDS.has(lowered)) {
    return {
      isStrong: false,
      entropy: 10,
      rawEntropy: 10,
      level: 'weak',
      recommendation: includeRecommendation
        ? '❌ Common passphrase detected. Choose a unique phrase with mixed characters.'
        : undefined,
    }
  }

  // Calculate charset size starting from observed character classes
  const hasLower = /[a-z]/.test(normalized)
  const hasUpper = /[A-Z]/.test(normalized)
  const hasDigit = /[0-9]/.test(normalized)
  const hasSymbol = /[^a-zA-Z0-9\s]/.test(normalized)
  const hasSpace = /\s/.test(normalized)
  const hasUnicode = /[^\x00-\x7F]/.test(normalized)

  let charsetSize = 0
  if (hasLower) charsetSize += 26
  if (hasUpper) charsetSize += 26
  if (hasDigit) charsetSize += 10
  if (hasSymbol) charsetSize += 32  // Common symbols
  if (hasSpace) charsetSize += 1    // Space character
  if (hasUnicode) {
    const unicodeChars = normalized.replace(/[\x00-\x7F]/g, '')
    const unicodeUnique = new Set(splitGraphemes(unicodeChars)).size
    charsetSize += Math.max(MIN_UNICODE_CHARSET, unicodeUnique * 6)
  }

  // Safety check: prevent division by zero
  if (charsetSize === 0) {
    const uniqueCountFallback = new Set(graphemes).size
    charsetSize = clamp(uniqueCountFallback, 1, 95)
  }

  const rawEntropy = length * Math.log2(charsetSize)
  let entropy = rawEntropy

  // Apply variation-based adjustments
  const frequency = new Map<string, number>()
  let maxFrequency = 0
  for (const g of graphemes) {
    const next = (frequency.get(g) ?? 0) + 1
    frequency.set(g, next)
    if (next > maxFrequency) maxFrequency = next
  }

  const uniqueCount = frequency.size
  const uniqueRatio = uniqueCount / length
  const dominantRatio = maxFrequency / length

  let modifier = 1

  // Penalise heavily repeated characters
  if (dominantRatio >= 0.9) modifier *= 0.2
  else if (dominantRatio >= 0.75) modifier *= 0.35
  else if (dominantRatio >= 0.6) modifier *= 0.5

  // Encourage diversity
  if (uniqueRatio < 0.5) modifier *= clamp(0.5 + uniqueRatio, 0.4, 0.9)

  // Penalise short passphrases regardless of entropy estimate
  if (length < 8) modifier *= 0.35
  else if (length < 12) modifier *= 0.6

  if (hasSequentialPattern(normalized)) modifier *= 0.55
  if (isRepeatedSequence(normalized)) modifier *= 0.45

  entropy *= clamp(modifier, 0.05, 1)

  const safeEntropy = Number.isFinite(entropy) && entropy >= 0 ? entropy : 0
  const safeRawEntropy = Number.isFinite(rawEntropy) && rawEntropy >= 0 ? rawEntropy : 0

  // Determine strength level based on entropy thresholds
  let level: 'weak' | 'medium' | 'strong' | 'very-strong' | 'excellent'
  let isStrong: boolean
  let recommendation: string | undefined

  if (safeEntropy < 50) {
    level = 'weak'
    isStrong = false
    if (includeRecommendation) {
      recommendation = `❌ Entropy: ${Math.round(safeEntropy)} bits. Insufficient security. Recommend: 15+ mixed characters or 20+ letters`
    }
  } else if (safeEntropy < 80) {
    level = 'medium'
    isStrong = false
    if (includeRecommendation) {
      recommendation = `⚠️ Entropy: ${Math.round(safeEntropy)} bits. Below recommended threshold. Recommend: 18+ characters with symbols/emoji`
    }
  } else if (safeEntropy < 128) {
    level = 'strong'
    isStrong = true
    if (includeRecommendation) {
      recommendation = `✅ Entropy: ${Math.round(safeEntropy)} bits. Good security`
    }
  } else if (safeEntropy < 192) {
    level = 'very-strong'
    isStrong = true
    if (includeRecommendation) {
      recommendation = `🔐 Entropy: ${Math.round(safeEntropy)} bits. Strong security`
    }
  } else if (safeEntropy < 256) {
    level = 'excellent'
    isStrong = true
    if (includeRecommendation) {
      recommendation = `🛡️ Entropy: ${Math.round(safeEntropy)} bits. Excellent security`
    }
  } else {
    level = 'excellent'
    isStrong = true
    if (includeRecommendation) {
      recommendation = `🛡️ Entropy: ${Math.round(safeEntropy)} bits. Maximum security`
    }
  }

  return { isStrong, entropy: safeEntropy, rawEntropy: safeRawEntropy, level, recommendation }
}

/**
 * Get grapheme length (visible character count) using shared splitter.
 */
export const getGraphemeLength = (value: string): number => splitGraphemes(value).length

export const splitIntoGraphemes = splitGraphemes
