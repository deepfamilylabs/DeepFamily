import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Home, Eye, Settings, Search } from 'lucide-react'

export default function BottomNav() {
  const { t } = useTranslation()
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center text-xs ${isActive ? 'text-blue-600' : 'text-gray-600'}`
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-gray-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="max-w-6xl mx-auto grid grid-cols-4 h-14">
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
        <NavLink to="/settings" className={item}>
          <Settings className="w-5 h-5" />
          <span>{t('navigation.settings')}</span>
        </NavLink>
      </div>
    </nav>
  )
}


