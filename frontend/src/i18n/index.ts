import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhCN from '../locales/zh-CN/index.json'
import zhTW from '../locales/zh-TW/index.json'
import en from '../locales/en/index.json'
import ja from '../locales/ja/index.json'
import ko from '../locales/ko/index.json'

const resources = {
  en: { translation: en },
  ja: { translation: ja },
  ko: { translation: ko },
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW },
} satisfies Record<string, { translation: Record<string, unknown> }>

type CanonicalLocale = keyof typeof resources

const SUPPORTED = Object.keys(resources) as CanonicalLocale[]

const normalizeCode = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase().replace(/_/g, '-')
  return normalized.length ? normalized : undefined
}

const mapToSupported = (value?: string | null): CanonicalLocale | undefined => {
  const normalized = normalizeCode(value)
  if (!normalized) return undefined

  if (SUPPORTED.includes(normalized as CanonicalLocale)) {
    return normalized as CanonicalLocale
  }

  return 'en'
}

const customLanguageDetector = {
  name: 'customDetector',
  lookup(): string {
    const stored = mapToSupported(localStorage.getItem('i18nextLng'))
    if (stored) {
      return stored
    }

    const navigatorLanguages = navigator.languages || [navigator.language]
    for (const nav of navigatorLanguages) {
      const resolved = mapToSupported(nav)
      if (resolved) return resolved
    }

    return 'en'
  },
  cacheUserLanguage(lng: string) {
    if (SUPPORTED.includes(lng as CanonicalLocale)) {
      localStorage.setItem('i18nextLng', lng)
    }
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: customLanguageDetector.lookup(),
    fallbackLng: 'en',
    supportedLngs: SUPPORTED,
    nonExplicitSupportedLngs: false,
    ns: ['translation'],
    defaultNS: 'translation',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    debug: process.env.NODE_ENV === 'development',
    load: 'currentOnly',
    cleanCode: true,
  })

i18n.on('languageChanged', (lng) => {
  customLanguageDetector.cacheUserLanguage(lng)
})

export default i18n
