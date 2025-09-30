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

export const languages: Language[] = [...languageData].sort((a, b) => 
  a.nativeName.localeCompare(b.nativeName, undefined, { 
    numeric: true, 
    sensitivity: 'base' 
  })
)

export const getLanguageByCode = (code: string): Language => {
  return languages.find(lang => lang.code === code) || languages[0]
}