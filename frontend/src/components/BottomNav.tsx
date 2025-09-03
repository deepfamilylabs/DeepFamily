import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Home, Eye, Search, Book } from 'lucide-react'

export default function BottomNav() {
  const { t } = useTranslation()
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex-1 flex flex-col items-center justify-center py-2 text-xs ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
      <div className="flex h-16">
        <NavLink to="/" className={item} end>
          <Home className="w-5 h-5" />
          <span>{t('navigation.home')}</span>
        </NavLink>
        <NavLink to="/visualization" className={item}>
          <Eye className="w-5 h-5" />
          <span>{t('navigation.visualization')}</span>
        </NavLink>
        <NavLink to="/search" className={item}>
          <Search className="w-5 h-5" />
          <span>{t('navigation.search')}</span>
        </NavLink>
        <NavLink to="/people" className={item}>
          <Book className="w-5 h-5" />
          <span>{t('navigation.people')}</span>
        </NavLink>
      </div>
    </nav>
  )
}


