import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { 
  Shield, 
  Coins, 
  Network, 
  TrendingUp, 
  Users, 
  Globe, 
  Zap,
  ArrowRight
} from 'lucide-react'

export default function Home() {
  const { t } = useTranslation()
  return (
    <div>
      {/* Hero Section */}
      <section className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-850 dark:to-slate-800 flex items-center" style={{width: '100vw', marginLeft: 'calc(-50vw + 50%)', marginTop: 'calc(-2rem - 56px)', paddingTop: 'calc(2rem + 56px)'}}>
        {/* Background Elements */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-purple-600/10 dark:from-blue-600/20 dark:to-purple-700/20"></div>
        <div className="absolute inset-0 w-full h-full">
          <div className="absolute top-20 left-10 w-32 h-32 bg-blue-500/20 dark:bg-blue-500/30 rounded-full blur-xl"></div>
          <div className="absolute top-40 right-20 w-48 h-48 bg-purple-500/20 dark:bg-purple-600/30 rounded-full blur-xl"></div>
            <div className="absolute bottom-20 left-1/3 w-40 h-40 bg-indigo-500/20 dark:bg-indigo-600/30 rounded-full blur-xl"></div>
        </div>
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Main Title */}
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-gray-900 dark:text-gray-100 mb-10 leading-tight">
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-500 bg-clip-text text-transparent">
              {t('home.title')}
            </span>
            <br />
          </h1>
          
          {/* Subtitle */}
          <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400 max-w-4xl mx-auto mb-8 leading-relaxed">
            {t('home.subtitle')}
          </p>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <NavLink 
              to="/visualization" 
              className="group inline-flex items-center px-8 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold text-lg hover:from-blue-700 hover:to-purple-700 dark:from-blue-500 dark:to-purple-600 dark:hover:from-blue-400 dark:hover:to-purple-500 transform hover:scale-105 transition-all duration-200 shadow-xl hover:shadow-2xl"
            >
              {t('home.exploreVisualization')}
              <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </NavLink>
            <NavLink 
              to="/settings" 
              className="inline-flex items-center px-8 py-4 rounded-xl bg-blue-600 dark:bg-white/5 text-white font-semibold text-lg border-2 border-white/90 dark:border-white/70 hover:bg-blue-700 dark:hover:bg-white/15 hover:text-white active:scale-[0.97] transition-all duration-200 shadow-inner/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-600 dark:focus-visible:ring-offset-blue-700 backdrop-blur-sm"
            >
              {t('home.cta.configure')}
            </NavLink>
          </div>
          
          {/* Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-1">{t('home.statistics.decentralized')}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{t('home.statistics.decentralizedDesc')}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-1">{t('home.statistics.privacy')}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{t('home.statistics.privacyDesc')}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mb-1">{t('home.statistics.dualLayer')}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{t('home.statistics.dualLayerDesc')}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600 dark:text-green-400 mb-1">{t('home.statistics.global')}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{t('home.statistics.globalDesc')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Dual Layer Architecture */}
      <section className="relative overflow-hidden py-20 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-900/70 dark:to-slate-800">
        {/* decorative background layers */}
        <div className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-70 mix-blend-normal dark:mix-blend-screen">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_30%,rgba(59,130,246,0.18),transparent_65%)] dark:bg-[radial-gradient(circle_at_25%_30%,rgba(59,130,246,0.22),transparent_70%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_65%,rgba(139,92,246,0.16),transparent_60%)] dark:bg-[radial-gradient(circle_at_75%_65%,rgba(139,92,246,0.20),transparent_65%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,rgba(99,102,241,0.10),transparent_55%)] dark:bg-[radial-gradient(circle_at_50%_100%,rgba(99,102,241,0.18),transparent_60%)]" />
          <div className="absolute inset-0 backdrop-blur-[2px]" />
        </div>
        {/* subtle grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.25)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.25)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:80px_80px] opacity-20" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {t('home.architecture.title')}
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-400 max-w-4xl mx-auto">
              {t('home.architecture.subtitle')}
            </p>
          </div>
          
          <div className="grid md:grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 mb-20">
            {/* Layer 1: Privacy Protection */}
            <div className="relative group">
              <div className="bg-white dark:bg-gray-800 rounded-3xl p-10 shadow-xl border border-blue-200/50 dark:border-blue-400/20 hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 hover:border-blue-300/70 dark:hover:border-blue-400/40 h-full flex flex-col min-h-[400px]">
                <div className="flex items-center mb-6">
                  <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-500 dark:to-blue-700 rounded-2xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform duration-300">
                    <Shield className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('home.architecture.layer1.title')}</h3>
                    <div className="text-blue-600 dark:text-blue-400 font-semibold">{t('home.architecture.layer1.subtitle')}</div>
                  </div>
                </div>
                
                <div className="flex-1"></div>
                
                <div className="space-y-4">
                  <div className="flex items-start">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{t('home.architecture.layer1.feature1')}</div>
                      <div className="text-gray-600 dark:text-gray-400 text-sm">{t('home.architecture.layer1.feature1Desc')}</div>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{t('home.architecture.layer1.feature2')}</div>
                      <div className="text-gray-600 dark:text-gray-400 text-sm">{t('home.architecture.layer1.feature2Desc')}</div>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{t('home.architecture.layer1.feature3')}</div>
                      <div className="text-gray-600 dark:text-gray-400 text-sm">{t('home.architecture.layer1.feature3Desc')}</div>
                    </div>
                  </div>
                </div>
                
                <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-xl group-hover:bg-blue-100 dark:group-hover:bg-blue-900/50 transition-colors duration-300">
                  <div className="text-sm text-blue-800 dark:text-blue-300 font-medium">{t('home.architecture.layer1.description')}</div>
                </div>
              </div>
            </div>
            
            {/* Layer 2: Value Confirmation */}
            <div className="relative group">
              <div className="bg-white dark:bg-gray-800 rounded-3xl p-10 shadow-xl border border-purple-200/50 dark:border-purple-400/20 hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 hover:border-purple-300/70 dark:hover:border-purple-400/40 h-full flex flex-col min-h-[400px]">
                <div className="flex items-center mb-6">
                  <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-purple-600 dark:from-purple-500 dark:to-purple-700 rounded-2xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform duration-300">
                    <Coins className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('home.architecture.layer2.title')}</h3>
                    <div className="text-purple-600 dark:text-purple-400 font-semibold">{t('home.architecture.layer2.subtitle')}</div>
                  </div>
                </div>
                
                <div className="flex-1"></div>
                
                <div className="space-y-4">
                  <div className="flex items-start">
                    <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{t('home.architecture.layer2.feature1')}</div>
                      <div className="text-gray-600 dark:text-gray-400 text-sm">{t('home.architecture.layer2.feature1Desc')}</div>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{t('home.architecture.layer2.feature2')}</div>
                      <div className="text-gray-600 dark:text-gray-400 text-sm">{t('home.architecture.layer2.feature2Desc')}</div>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{t('home.architecture.layer2.feature3')}</div>
                      <div className="text-gray-600 dark:text-gray-400 text-sm">{t('home.architecture.layer2.feature3Desc')}</div>
                    </div>
                  </div>
                </div>
                
                <div className="mt-6 p-4 bg-purple-50 dark:bg-purple-900/30 rounded-xl group-hover:bg-purple-100 dark:group-hover:bg-purple-900/50 transition-colors duration-300">
                  <div className="text-sm text-purple-800 dark:text-purple-300 font-medium">{t('home.architecture.layer2.description')}</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Architecture Flow */}
          <div className="relative group">
            <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-3xl p-8 shadow-xl border border-indigo-200/50 dark:border-indigo-400/20 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-300/70 dark:hover:border-indigo-400/40">
              <h3 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100 mb-8">{t('home.architecture.advantages.title')}</h3>
              
              <div className="grid md:grid-cols-4 gap-6 relative">
                <div className="text-center relative">
                  <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                    <div className="text-white font-bold text-lg">1</div>
                  </div>
                  <h4 className="font-bold text-gray-900 dark:text-gray-100 mb-2">{t('home.architecture.advantages.step1')}</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t('home.architecture.advantages.step1Desc')}</p>
                  
                  {/* Arrow to next step - hidden on mobile */}
                  <div className="hidden md:block absolute top-8 right-0 transform translate-x-1/2 -translate-y-3">
                    <ArrowRight className="w-6 h-6 text-indigo-400" />
                  </div>
                  
                  {/* Mobile arrow after step 1 */}
                  <div className="md:hidden absolute left-1/2 transform -translate-x-1/2 -bottom-6 h-6 flex items-center justify-center">
                    <ArrowRight className="w-5 h-5 text-indigo-400 rotate-90" />
                  </div>
                </div>
                
                <div className="text-center relative">
                  <div className="w-16 h-16 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                    <div className="text-white font-bold text-lg">2</div>
                  </div>
                  <h4 className="font-bold text-gray-900 dark:text-gray-100 mb-2">{t('home.architecture.advantages.step2')}</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t('home.architecture.advantages.step2Desc')}</p>
                  
                  {/* Arrow to next step - hidden on mobile */}
                  <div className="hidden md:block absolute top-8 right-0 transform translate-x-1/2 -translate-y-3">
                    <ArrowRight className="w-6 h-6 text-purple-400" />
                  </div>
                  
                  {/* Mobile arrow after step 2 */}
                  <div className="md:hidden absolute left-1/2 transform -translate-x-1/2 -bottom-6 h-6 flex items-center justify-center">
                    <ArrowRight className="w-5 h-5 text-purple-400 rotate-90" />
                  </div>
                </div>
                
                <div className="text-center relative">
                  <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                    <div className="text-white font-bold text-lg">3</div>
                  </div>
                  <h4 className="font-bold text-gray-900 dark:text-gray-100 mb-2">{t('home.architecture.advantages.step3')}</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t('home.architecture.advantages.step3Desc')}</p>
                  
                  {/* Arrow to next step - hidden on mobile */}
                  <div className="hidden md:block absolute top-8 right-0 transform translate-x-1/2 -translate-y-3">
                    <ArrowRight className="w-6 h-6 text-pink-400" />
                  </div>
                  
                  {/* Mobile arrow after step 3 */}
                  <div className="md:hidden absolute left-1/2 transform -translate-x-1/2 -bottom-6 h-6 flex items-center justify-center">
                    <ArrowRight className="w-5 h-5 text-pink-400 rotate-90" />
                  </div>
                </div>
                
                <div className="text-center">
                  <div className="w-16 h-16 bg-gradient-to-r from-pink-500 to-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                    <div className="text-white font-bold text-lg">4</div>
                  </div>
                  <h4 className="font-bold text-gray-900 dark:text-gray-100 mb-2">{t('home.architecture.advantages.step4')}</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t('home.architecture.advantages.step4Desc')}</p>
                </div>
              </div>
              
              <div className="mt-8 p-6 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-2xl group-hover:from-blue-100 group-hover:to-purple-100 dark:group-hover:from-blue-900/30 dark:group-hover:to-purple-900/30 transition-all duration-300">
                <div className="text-center">
                  <h4 className="font-bold text-gray-900 dark:text-gray-100 mb-2">{t('home.architecture.advantages.conclusion')}</h4>
                  <p className="text-gray-600 dark:text-gray-400">{t('home.architecture.advantages.conclusionDesc')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Features */}
      <section className="py-20 bg-white/90 dark:bg-slate-900/70 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {t('home.features.title')}
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
              {t('home.features.subtitle')}
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Feature Cards */}
            <div className="group relative bg-white dark:bg-slate-800/90 rounded-2xl p-8 shadow-lg hover:shadow-2xl border border-gray-100 dark:border-slate-600/60 hover:border-blue-200 dark:hover:border-blue-400/60 transition-all duration-300 hover:-translate-y-2">
              <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-500 dark:to-blue-700 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">{t('home.features.privacy.title')}</h3>
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                {t('home.features.privacy.description')}
              </p>
            </div>
            
            <div className="group relative bg-white dark:bg-slate-800/90 rounded-2xl p-8 shadow-lg hover:shadow-2xl border border-gray-100 dark:border-slate-600/60 hover:border-purple-200 dark:hover:border-purple-400/60 transition-all duration-300 hover:-translate-y-2">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-purple-600 dark:from-purple-500 dark:to-purple-700 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Coins className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">{t('home.features.nft.title')}</h3>
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                {t('home.features.nft.description')}
              </p>
            </div>
            
            <div className="group relative bg-white dark:bg-slate-800/90 rounded-2xl p-8 shadow-lg hover:shadow-2xl border border-gray-100 dark:border-slate-600/60 hover:border-green-200 dark:hover:border-green-400/60 transition-all duration-300 hover:-translate-y-2">
              <div className="w-16 h-16 bg-gradient-to-r from-green-500 to-green-600 dark:from-green-500 dark:to-green-700 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <TrendingUp className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">{t('home.features.token.title')}</h3>
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                {t('home.features.token.description')}
              </p>
            </div>
            
            <div className="group relative bg-white dark:bg-slate-800/90 rounded-2xl p-8 shadow-lg hover:shadow-2xl border border-gray-100 dark:border-slate-600/60 hover:border-indigo-200 dark:hover:border-indigo-400/60 transition-all duration-300 hover:-translate-y-2">
              <div className="w-16 h-16 bg-gradient-to-r from-indigo-500 to-indigo-600 dark:from-indigo-500 dark:to-indigo-700 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Users className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">{t('home.features.endorsement.title')}</h3>
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                {t('home.features.endorsement.description')}
              </p>
            </div>
            
            <div className="group relative bg-white dark:bg-slate-800/90 rounded-2xl p-8 shadow-lg hover:shadow-2xl border border-gray-100 dark:border-slate-600/60 hover:border-orange-200 dark:hover:border-orange-400/60 transition-all duration-300 hover:-translate-y-2">
              <div className="w-16 h-16 bg-gradient-to-r from-orange-500 to-orange-600 dark:from-orange-500 dark:to-orange-700 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Network className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">{t('home.features.multiVersion.title')}</h3>
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                {t('home.features.multiVersion.description')}
              </p>
            </div>
            
            <div className="group relative bg-white dark:bg-slate-800/90 rounded-2xl p-8 shadow-lg hover:shadow-2xl border border-gray-100 dark:border-slate-600/60 hover:border-red-200 dark:hover:border-red-400/60 transition-all duration-300 hover:-translate-y-2">
              <div className="w-16 h-16 bg-gradient-to-r from-red-500 to-red-600 dark:from-red-500 dark:to-red-700 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Globe className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">{t('home.features.governance.title')}</h3>
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                {t('home.features.governance.description')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Contract Features Section */}
      <section className="py-20 bg-gradient-to-br from-gray-50 to-blue-50 dark:from-slate-900 dark:via-slate-850 dark:to-slate-850">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {t('home.contracts.title')}
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
              {t('home.contracts.subtitle')}
            </p>
          </div>
          
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="relative group">
              <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-8 shadow-xl border border-blue-100 dark:border-blue-400/25 hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 hover:border-blue-200 dark:hover:border-blue-400/50">
                <div className="w-20 h-20 bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-500 dark:to-blue-700 rounded-2xl flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                  <Zap className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100 mb-4">DeepFamily.sol</h3>
                <ul className="space-y-3 text-gray-600 dark:text-gray-300">
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                    {t('home.contracts.familyTree.feature1')}
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                    {t('home.contracts.familyTree.feature2')}
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                    {t('home.contracts.familyTree.feature3')}
                  </li>
                </ul>
              </div>
            </div>
            
            <div className="relative group">
              <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-8 shadow-xl border border-purple-100 dark:border-purple-400/25 hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 hover:border-purple-200 dark:hover:border-purple-400/50">
                <div className="w-20 h-20 bg-gradient-to-r from-purple-500 to-purple-600 dark:from-purple-500 dark:to-purple-700 rounded-2xl flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                  <Coins className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100 mb-4">DeepFamilyToken.sol</h3>
                <ul className="space-y-3 text-gray-600 dark:text-gray-300">
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-purple-500 rounded-full mr-3"></div>
                    {t('home.contracts.token.feature1')}
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-purple-500 rounded-full mr-3"></div>
                    {t('home.contracts.token.feature2')}
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-purple-500 rounded-full mr-3"></div>
                    {t('home.contracts.token.feature3')}
                  </li>
                </ul>
              </div>
            </div>
            
            <div className="relative group">
              <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-8 shadow-xl border border-green-100 dark:border-green-400/25 hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 hover:border-green-200 dark:hover:border-green-400/50">
                <div className="w-20 h-20 bg-gradient-to-r from-green-500 to-green-600 dark:from-green-500 dark:to-green-700 rounded-2xl flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                  <Users className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100 mb-4">DeepFamilyVotes.sol</h3>
                <ul className="space-y-3 text-gray-600 dark:text-gray-300">
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    {t('home.contracts.votes.feature1')}
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    {t('home.contracts.votes.feature2')}
                  </li>
                  <li className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    {t('home.contracts.votes.feature3')}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="pt-20 pb-24 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-650 dark:via-indigo-650 dark:to-purple-650 text-white" style={{width: '100vw', marginLeft: 'calc(-50vw + 50%)', marginBottom: '-5rem'}}>
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            {t('home.cta.title')}
          </h2>
          <p className="text-xl text-blue-100 dark:text-blue-200 mb-8 leading-relaxed">
            {t('home.cta.subtitle')}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <NavLink 
              to="/visualization" 
              className="inline-flex items-center px-8 py-4 rounded-xl bg-white dark:bg-gray-50 text-blue-600 font-semibold text-lg hover:bg-gray-100 dark:hover:bg-white transition-all duration-200 shadow-xl hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-600 dark:focus-visible:ring-offset-blue-700"
            >
              {t('home.cta.experience')}
              <ArrowRight className="ml-2 w-5 h-5" />
            </NavLink>
            <NavLink 
              to="/settings" 
              className="inline-flex items-center px-8 py-4 rounded-xl bg-blue-600 dark:bg-white/5 text-white font-semibold text-lg border-2 border-white/90 dark:border-white/70 hover:bg-blue-700 dark:hover:bg-white/15 hover:text-white active:scale-[0.97] transition-all duration-200 shadow-inner/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-600 dark:focus-visible:ring-offset-blue-700 backdrop-blur-sm"
            >
              {t('home.cta.configure')}
            </NavLink>
          </div>
          
          {/* GitHub Open Source Info */}
          <div className="border-t border-white/20 pt-8">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              <a 
                href="https://github.com/DeepFamily/DeepFamily"
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center text-white/80 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-600 dark:focus-visible:ring-offset-blue-700 rounded"
              >
                <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                {t('home.cta.opensource')}
              </a>
              <div className="flex items-center gap-4 text-sm text-white/60">
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                  </svg>
                  {t('home.cta.free')}
                </div>
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"/>
                  </svg>
                  {t('home.cta.license')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}


