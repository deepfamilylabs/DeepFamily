/**
 * Layout Component
 * 
 * Copyright notice:
 * - TreeDeciduous icon and other icons from Lucide React (https://lucide.dev)
 * - Licensed under ISC License - allows commercial use, modification, and distribution
 * - Copyright (c) 2020, Lucide Contributors
 */

import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Home, Settings, Search, Eye, Moon, Sun } from 'lucide-react'
import BottomNav from './BottomNav'
import LanguageSwitch from './LanguageSwitch'
import Logo from './Logo'
import { useEffect, useState } from 'react'

export default function Layout() {
  const { t } = useTranslation()
  const location = useLocation()
  const isHomePage = location.pathname === '/'
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (typeof window !== 'undefined' && window.localStorage.getItem('df-theme') === 'dark' ? 'dark' : 'light'))

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    window.localStorage.setItem('df-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark')

  const navClasses = ({ isActive }: { isActive: boolean }) => {
    const baseClasses = 'inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors'
    if (isHomePage) {
      return `${baseClasses} ${
        isActive
          ? 'text-white bg-white/30 shadow-lg dark:bg-white/10'
          : 'text-white/90 hover:text-white hover:bg-white/20 hover:shadow-md dark:text-gray-100/90 dark:hover:bg-white/10'
      }`
    }
    return `${baseClasses} ${
      isActive
        ? 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-900/40'
        : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800/60'
    }`
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white dark:from-gray-950 dark:to-gray-900">
      <header className={`sticky top-0 z-20 ${isHomePage ? 'bg-gradient-to-r from-blue-600/40 to-purple-600/40 dark:from-blue-650/80 dark:to-purple-650/80 backdrop-blur-md border-b border-white/20 dark:border-gray-850/60 dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.6)]' : 'bg-white/70 dark:bg-gray-950/90 backdrop-blur border-b border-gray-200 dark:border-gray-800'}`}>
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <NavLink to="/" className={`flex items-center gap-3 font-bold transition-colors ${isHomePage ? 'text-white hover:text-blue-100 dark:text-gray-100' : 'text-gray-800 dark:text-gray-100'}`}>
            <Logo className={`w-8 h-8 ${isHomePage ? 'text-white dark:text-gray-100' : 'text-indigo-600 dark:text-indigo-400'} hover:-rotate-90 transition-transform duration-300`} />
            <span className={`text-xl font-light tracking-widest uppercase ${isHomePage ? 'text-white dark:text-gray-100' : 'text-gray-900 dark:text-gray-100'}`} style={{fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', letterSpacing: '0.2em'}}>DeepFamily</span>
          </NavLink>
          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/" className={navClasses} end>
              <Home className="w-4 h-4" /> {t('navigation.home')}
            </NavLink>
            <NavLink to="/visualization" className={navClasses}>
              <Eye className="w-4 h-4" /> {t('navigation.visualization')}
            </NavLink>
            <NavLink to="/search" className={navClasses}>
              <Search className="w-4 h-4" /> {t('navigation.search')}
            </NavLink>
            <NavLink to="/settings" className={navClasses}>
              <Settings className="w-4 h-4" /> {t('navigation.settings')}
            </NavLink>
          </nav>
          <div className="flex items-center gap-2 flex-shrink-0">
            <LanguageSwitch />
            <button
              onClick={toggleTheme}
              aria-label={theme==='dark' ? (t('theme.switchToLight','Switch to Light') as string) : (t('theme.switchToDark','Switch to Dark') as string)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900/70 text-gray-700 dark:text-gray-200 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/80 transition-colors shadow-inner/10"
            >
              {theme==='dark' ? <Moon size={14} className="text-indigo-300" /> : <Sun size={14} className="text-amber-500" />}
              <span className="hidden sm:inline">{theme==='dark' ? t('theme.dark','Dark') : t('theme.light','Light')}</span>
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 pb-20 pt-8">
        <Outlet />
      </main>
      <div className="md:hidden"><BottomNav /></div>
    </div>
  )
}


