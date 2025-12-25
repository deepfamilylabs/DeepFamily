import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Shield, Eye, Database, CheckCircle } from "lucide-react";
import { ANIMATION_CLASSES } from "../../constants/animationStyles";
import PageContainer from "../PageContainer";

const TwoLayerValueSystem = memo(() => {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden py-32 bg-white">
      {/* Subtle background pattern (Matching ValuePropositions) */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <PageContainer className="relative z-10">
        <div className={`text-center mb-20 ${ANIMATION_CLASSES.FADE_IN_UP}`}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 mb-8 shadow-sm">
            <Database className="w-3.5 h-3.5 text-indigo-600" />
            <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">
              Two-Layer Value System
            </span>
          </div>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 mb-8 tracking-tight leading-tight">
            {t("home.valueSystem.title")}
          </h2>

          <p className="text-xl text-slate-500 max-w-3xl mx-auto leading-relaxed font-normal">
            {t("home.valueSystem.subtitle")}
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-stretch">
          {/* Layer 1: Privacy Protection */}
          <div className={`group ${ANIMATION_CLASSES.SLIDE_IN_LEFT} h-full`}>
            <div className="bg-white rounded-3xl p-10 border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-blue-500/10 hover:border-blue-200 transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
              <div className="flex items-start gap-6 mb-8">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300">
                  <Shield className="w-8 h-8 text-blue-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wide border border-blue-100">
                      Layer 1
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900">
                    {t("home.valueSystem.layer1.title")}
                  </h3>
                </div>
              </div>

              <p className="text-slate-500 leading-relaxed mb-8 text-lg flex-1">
                {t("home.valueSystem.layer1.description")}
              </p>

              <div className="space-y-4 mt-auto">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-3 group/item">
                    <CheckCircle className="w-5 h-5 text-blue-500 mt-1 flex-shrink-0 group-hover/item:text-blue-600 transition-colors" />
                    <span className="text-slate-600 text-base font-medium group-hover/item:text-slate-900 transition-colors">
                      {t(`home.valueSystem.layer1.feature${i}`)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Layer 2: Public NFT Assets */}
          <div className={`group ${ANIMATION_CLASSES.SLIDE_IN_RIGHT} h-full`}>
            <div className="bg-white rounded-3xl p-10 border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-purple-500/10 hover:border-purple-200 transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
              <div className="flex items-start gap-6 mb-8">
                <div className="w-16 h-16 rounded-2xl bg-purple-50 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300">
                  <Eye className="w-8 h-8 text-purple-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-3 py-1 rounded-full bg-purple-50 text-purple-700 text-xs font-bold uppercase tracking-wide border border-purple-100">
                      Layer 2
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900">
                    {t("home.valueSystem.layer2.title")}
                  </h3>
                </div>
              </div>

              <p className="text-slate-500 leading-relaxed mb-8 text-lg flex-1">
                {t("home.valueSystem.layer2.description")}
              </p>

              <div className="space-y-4 mt-auto">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-3 group/item">
                    <CheckCircle className="w-5 h-5 text-purple-500 mt-1 flex-shrink-0 group-hover/item:text-purple-600 transition-colors" />
                    <span className="text-slate-600 text-base font-medium group-hover/item:text-slate-900 transition-colors">
                      {t(`home.valueSystem.layer2.feature${i}`)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
});

TwoLayerValueSystem.displayName = "TwoLayerValueSystem";

export default TwoLayerValueSystem;
