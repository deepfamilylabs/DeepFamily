import { memo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp, Shield, Key, GitBranch, Users, Gem, FileText } from "lucide-react";
import { ANIMATION_CLASSES } from "../../constants/animationStyles";
import PageContainer from "../PageContainer";

const ValuePropositions = memo(() => {
  const { t } = useTranslation();

  return (
    <section className="py-32 bg-white relative overflow-hidden">
      {/* Subtle background pattern (Matching Hero) */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <PageContainer>
        <div className={`text-center mb-20 relative z-10 ${ANIMATION_CLASSES.FADE_IN_UP}`}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-50 border border-slate-200 mb-8 shadow-sm">
            <TrendingUp className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Value Propositions
            </span>
          </div>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 mb-8 tracking-tight leading-tight">
            {t("home.valueProps.title")}
          </h2>

          <p className="text-xl text-slate-500 max-w-3xl mx-auto leading-relaxed font-normal">
            {t("home.valueProps.subtitle")}
          </p>
        </div>

        <div
          className={`grid md:grid-cols-2 lg:grid-cols-3 gap-8 relative z-10 ${ANIMATION_CLASSES.FADE_IN_UP} animation-delay-300`}
        >
          {/* Zero-Knowledge Privacy */}
          <div className={`group ${ANIMATION_CLASSES.SCALE_IN} h-full`}>
            <div className="bg-white rounded-3xl p-10 shadow-sm border border-slate-100 hover:shadow-xl hover:shadow-blue-500/10 hover:border-blue-200 transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300">
                <Shield className="w-7 h-7 text-blue-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">
                {t("home.valueProps.zkPrivacy.title")}
              </h3>
              <p className="text-slate-500 leading-relaxed text-base flex-1">
                {t("home.valueProps.zkPrivacy.description")}
              </p>
            </div>
          </div>

          {/* Salted Passphrase Unlinkability */}
          <div className={`group ${ANIMATION_CLASSES.SCALE_IN} animation-delay-100 h-full`}>
            <div className="bg-white rounded-3xl p-10 shadow-sm border border-slate-100 hover:shadow-xl hover:shadow-purple-500/10 hover:border-purple-200 transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
              <div className="w-14 h-14 rounded-2xl bg-purple-50 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300">
                <Key className="w-7 h-7 text-purple-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">
                {t("home.valueProps.saltedUnlinkability.title")}
              </h3>
              <p className="text-slate-500 leading-relaxed text-base flex-1">
                {t("home.valueProps.saltedUnlinkability.description")}
              </p>
            </div>
          </div>

          {/* Dual Tree Models */}
          <div className={`group ${ANIMATION_CLASSES.SCALE_IN} animation-delay-200 h-full`}>
            <div className="bg-white rounded-3xl p-10 shadow-sm border border-slate-100 hover:shadow-xl hover:shadow-emerald-500/10 hover:border-emerald-200 transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300">
                <GitBranch className="w-7 h-7 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">
                {t("home.valueProps.dualTreeModels.title")}
              </h3>
              <p className="text-slate-500 leading-relaxed text-base flex-1">
                {t("home.valueProps.dualTreeModels.description")}
              </p>
            </div>
          </div>

          {/* Community Endorsement */}
          <div className={`group ${ANIMATION_CLASSES.SCALE_IN} animation-delay-300 h-full`}>
            <div className="bg-white rounded-3xl p-10 shadow-sm border border-slate-100 hover:shadow-xl hover:shadow-indigo-500/10 hover:border-indigo-200 transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300">
                <Users className="w-7 h-7 text-indigo-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">
                {t("home.valueProps.communityEndorsement.title")}
              </h3>
              <p className="text-slate-500 leading-relaxed text-base flex-1">
                {t("home.valueProps.communityEndorsement.description")}
              </p>
            </div>
          </div>

          {/* Incentive Mechanism */}
          <div className={`group ${ANIMATION_CLASSES.SCALE_IN} animation-delay-400 h-full`}>
            <div className="bg-white rounded-3xl p-10 shadow-sm border border-slate-100 hover:shadow-xl hover:shadow-orange-500/10 hover:border-orange-200 transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
              <div className="w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300">
                <Gem className="w-7 h-7 text-orange-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">
                {t("home.valueProps.nftValueCreation.title")}
              </h3>
              <p className="text-slate-500 leading-relaxed text-base flex-1">
                {t("home.valueProps.nftValueCreation.description")}
              </p>
            </div>
          </div>

          {/* Story Protocol */}
          <div className={`group ${ANIMATION_CLASSES.SCALE_IN} animation-delay-500 h-full`}>
            <div className="bg-white rounded-3xl p-10 shadow-sm border border-slate-100 hover:shadow-xl hover:shadow-rose-500/10 hover:border-rose-200 transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
              <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300">
                <FileText className="w-7 h-7 text-rose-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">
                {t("home.valueProps.storyShardingSealing.title")}
              </h3>
              <p className="text-slate-500 leading-relaxed text-base flex-1">
                {t("home.valueProps.storyShardingSealing.description")}
              </p>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
});

ValuePropositions.displayName = "ValuePropositions";

export default ValuePropositions;
