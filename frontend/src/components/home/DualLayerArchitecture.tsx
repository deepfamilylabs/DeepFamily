import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Network, Shield, CheckCircle, Layers, Database, Zap } from 'lucide-react';
import { ANIMATION_CLASSES } from '../../constants/animationStyles';
import PageContainer from '../PageContainer';

const DualLayerArchitecture = memo(() => {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden py-24 bg-gradient-to-br from-white via-slate-50 to-blue-50/50 dark:from-slate-900 dark:via-slate-850 dark:to-slate-800">
      {/* Enhanced decorative background layers */}
      <div className="pointer-events-none absolute inset-0 opacity-50 dark:opacity-60">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_30%,rgba(59,130,246,0.12),transparent_70%)] dark:bg-[radial-gradient(circle_at_25%_30%,rgba(59,130,246,0.20),transparent_75%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_65%,rgba(139,92,246,0.10),transparent_65%)] dark:bg-[radial-gradient(circle_at_75%_65%,rgba(139,92,246,0.18),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,rgba(99,102,241,0.08),transparent_60%)] dark:bg-[radial-gradient(circle_at_50%_100%,rgba(99,102,241,0.15),transparent_65%)]" />
      </div>
      
      {/* Enhanced grid overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.1)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.1)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(71,85,105,0.3)_1px,transparent_1px),linear-gradient(to_bottom,rgba(71,85,105,0.3)_1px,transparent_1px)] bg-[size:100px_100px] opacity-30" />
      
      <PageContainer className="relative">
        <div className={`text-center mb-20 ${ANIMATION_CLASSES.FADE_IN_UP}`}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-slate-100 to-blue-100 dark:from-slate-800 dark:to-blue-900/30 border border-slate-200 dark:border-slate-700 mb-6 backdrop-blur-sm">
            <Network className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">System Architecture</span>
          </div>
          
          <h2 className="text-2xl md:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-gray-100 mb-6 tracking-tight">
            <span className="bg-gradient-to-r from-slate-900 via-blue-700 to-indigo-700 dark:from-slate-100 dark:via-blue-300 dark:to-indigo-300 bg-clip-text text-transparent">
              {t('home.architecture.title')}
            </span>
          </h2>
          
          <p className="text-lg md:text-xl text-gray-600 dark:text-gray-400 max-w-4xl mx-auto leading-relaxed">
            {t('home.architecture.subtitle')}
          </p>
        </div>
        
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Privacy Protection Layer */}
          <div className={`group relative ${ANIMATION_CLASSES.SLIDE_IN_LEFT}`}>
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-3xl blur-lg opacity-25 group-hover:opacity-40 transition duration-500"></div>
            <div className="relative bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-3xl p-8 lg:p-10 shadow-2xl border border-blue-100/50 dark:border-blue-400/20 hover:shadow-blue-500/20 dark:hover:shadow-blue-400/30 transition-all duration-500 hover:-translate-y-2">
              <div className="flex items-center gap-4 mb-6">
                <div className="relative">
                  <div className="absolute -inset-2 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl blur opacity-40 group-hover:opacity-60 transition duration-300"></div>
                  <div className="relative w-16 h-16 bg-gradient-to-br from-blue-500 via-blue-600 to-cyan-600 dark:from-blue-400 dark:via-blue-500 dark:to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg">
                    <Shield className="w-8 h-8 text-white" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                    {t('home.architecture.privacyLayer.title')}
                  </h3>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 bg-blue-500 rounded-full ${ANIMATION_CLASSES.PULSE_SOFT}`}></div>
                    <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">Layer 1</span>
                  </div>
                </div>
              </div>
              
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed mb-6 text-base lg:text-lg">
                {t('home.architecture.privacyLayer.description')}
              </p>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300 text-sm lg:text-base">{t('home.architecture.privacyLayer.feature1')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300 text-sm lg:text-base">{t('home.architecture.privacyLayer.feature2')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300 text-sm lg:text-base">{t('home.architecture.privacyLayer.feature3')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Value Confirmation Layer */}
          <div className={`group relative ${ANIMATION_CLASSES.SLIDE_IN_RIGHT}`}>
            <div className="absolute -inset-1 bg-gradient-to-r from-purple-500 to-pink-500 rounded-3xl blur-lg opacity-25 group-hover:opacity-40 transition duration-500"></div>
            <div className="relative bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-3xl p-8 lg:p-10 shadow-2xl border border-purple-100/50 dark:border-purple-400/20 hover:shadow-purple-500/20 dark:hover:shadow-purple-400/30 transition-all duration-500 hover:-translate-y-2">
              <div className="flex items-center gap-4 mb-6">
                <div className="relative">
                  <div className="absolute -inset-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl blur opacity-40 group-hover:opacity-60 transition duration-300"></div>
                  <div className="relative w-16 h-16 bg-gradient-to-br from-purple-500 via-purple-600 to-pink-600 dark:from-purple-400 dark:via-purple-500 dark:to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
                    <Layers className="w-8 h-8 text-white" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                    {t('home.architecture.valueLayer.title')}
                  </h3>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 bg-purple-500 rounded-full ${ANIMATION_CLASSES.PULSE_SOFT}`}></div>
                    <span className="text-sm text-purple-600 dark:text-purple-400 font-medium">Layer 2</span>
                  </div>
                </div>
              </div>
              
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed mb-6 text-base lg:text-lg">
                {t('home.architecture.valueLayer.description')}
              </p>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-purple-500 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300 text-sm lg:text-base">{t('home.architecture.valueLayer.feature1')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-purple-500 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300 text-sm lg:text-base">{t('home.architecture.valueLayer.feature2')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-purple-500 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300 text-sm lg:text-base">{t('home.architecture.valueLayer.feature3')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
});

DualLayerArchitecture.displayName = 'DualLayerArchitecture';

export default DualLayerArchitecture;