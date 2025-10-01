export interface Language {
  code: string
  name: string
  nativeName: string
}

const languageData: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' }
]

// Detect if a language uses CJK characters (Chinese, Japanese, Korean)
const isCJK = (nativeName: string): boolean => {
  // CJK Unified Ideographs and extensions, Hiragana, Katakana, Hangul
  const cjkPattern = /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/
  return cjkPattern.test(nativeName)
}

// Smart sorting: English first, then Latin-script languages alphabetically, then CJK languages alphabetically
export const languages: Language[] = [...languageData].sort((a, b) => {
  // English always comes first
  if (a.code === 'en') return -1
  if (b.code === 'en') return 1

  const aIsCJK = isCJK(a.nativeName)
  const bIsCJK = isCJK(b.nativeName)

  // Both are Latin-script or both are CJK: sort alphabetically
  if (aIsCJK === bIsCJK) {
    return a.nativeName.localeCompare(b.nativeName, undefined, {
      numeric: true,
      sensitivity: 'base'
    })
  }

  // A is Latin-script, B is CJK: A comes first
  if (!aIsCJK && bIsCJK) return -1

  // A is CJK, B is Latin-script: B comes first
  return 1
})

export const getLanguageByCode = (code: string): Language => {
  return languages.find(lang => lang.code === code) || languages[0]
}