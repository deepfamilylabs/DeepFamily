import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Moon, Sun } from 'lucide-react'
import LanguageSwitch from './LanguageSwitch'

interface HeaderControlsProps {
  variant?: 'home' | 'normal'
}

export default function HeaderControls({ variant = 'home' }: HeaderControlsProps) {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<'light' | 'dark'>(() => 
    (typeof window !== 'undefined' && window.localStorage.getItem('df-theme') === 'dark' ? 'dark' : 'light')
  )

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    window.localStorage.setItem('df-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark')

  const isHomePage = variant === 'home'

  return (
    <div className="flex items-center gap-3 flex-shrink-0">
      <LanguageSwitch variant={variant} />
      <button
        onClick={toggleTheme}
        aria-label={theme==='dark' ? (t('theme.switchToLight','Switch to Light') as string) : (t('theme.switchToDark','Switch to Dark') as string)}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all duration-200 hover:scale-105 shadow-sm backdrop-blur-sm ${
          isHomePage 
            ? 'border-white/30 dark:border-white/20 bg-white/20 dark:bg-white/10 text-white dark:text-gray-200 hover:bg-white/30 dark:hover:bg-white/15' 
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/90 hover:border-gray-300 dark:hover:border-gray-600'
        }`}
      >
        {theme==='dark' ? 
          <Moon size={16} className={`${isHomePage ? 'text-blue-200' : 'text-indigo-500'}`} /> : 
          <Sun size={16} className={`${isHomePage ? 'text-yellow-200' : 'text-amber-500'}`} />
        }
        <span className="hidden sm:inline">{theme==='dark' ? t('theme.dark','Dark') : t('theme.light','Light')}</span>
      </button>
    </div>
  )
}