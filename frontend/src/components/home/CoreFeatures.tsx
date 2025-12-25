import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Zap, Shield, GitBranch, Coins, Trophy, FileText, TreePine } from "lucide-react";
import { ANIMATION_CLASSES } from "../../constants/animationStyles";
import PageContainer from "../PageContainer";

const CoreFeatures = memo(() => {
  const { t } = useTranslation();

  const features = [
    {
      icon: Shield,
      title: t("home.features.zkVersion.title"),
      description: t("home.features.zkVersion.description"),
      color: "text-blue-600",
      bg: "bg-blue-50",
      border: "border-blue-100",
      hoverBorder: "group-hover:border-blue-200",
      hoverShadow: "group-hover:shadow-blue-500/10",
    },
    {
      icon: TreePine,
      title: t("home.features.versionNotarization.title"),
      description: t("home.features.versionNotarization.description"),
      color: "text-rose-600",
      bg: "bg-rose-50",
      border: "border-rose-100",
      hoverBorder: "group-hover:border-rose-200",
      hoverShadow: "group-hover:shadow-rose-500/10",
    },
    {
      icon: GitBranch,
      title: t("home.features.versionManagement.title"),
      description: t("home.features.versionManagement.description"),
      color: "text-purple-600",
      bg: "bg-purple-50",
      border: "border-purple-100",
      hoverBorder: "group-hover:border-purple-200",
      hoverShadow: "group-hover:shadow-purple-500/10",
    },
    {
      icon: Coins,
      title: t("home.features.endorsementEconomy.title"),
      description: t("home.features.endorsementEconomy.description"),
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      border: "border-emerald-100",
      hoverBorder: "group-hover:border-emerald-200",
      hoverShadow: "group-hover:shadow-emerald-500/10",
    },
    {
      icon: Trophy,
      title: t("home.features.personNFT.title"),
      description: t("home.features.personNFT.description"),
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      border: "border-indigo-100",
      hoverBorder: "group-hover:border-indigo-200",
      hoverShadow: "group-hover:shadow-indigo-500/10",
    },
    {
      icon: FileText,
      title: t("home.features.storySharding.title"),
      description: t("home.features.storySharding.description"),
      color: "text-orange-600",
      bg: "bg-orange-50",
      border: "border-orange-100",
      hoverBorder: "group-hover:border-orange-200",
      hoverShadow: "group-hover:shadow-orange-500/10",
    },
  ];

  return (
    <section className="py-32 bg-white relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <PageContainer className="relative z-10">
        {/* Header */}
        <div className={`text-center mb-20 ${ANIMATION_CLASSES.FADE_IN_UP}`}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-50 border border-amber-100 mb-8 shadow-sm">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">
              Core Features
            </span>
          </div>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 mb-8 tracking-tight leading-tight">
            {t("home.features.title")}
          </h2>
          <p className="text-xl text-slate-500 max-w-3xl mx-auto leading-relaxed font-normal">
            {t("home.features.subtitle")}
          </p>
        </div>

        {/* Features Grid */}
        <div
          className={`grid md:grid-cols-2 lg:grid-cols-3 gap-8 relative z-10 ${ANIMATION_CLASSES.FADE_IN_UP} animation-delay-200`}
        >
          {features.map((feature, index) => (
            <div
              key={index}
              className={`group bg-white rounded-3xl p-10 shadow-sm border ${feature.border} hover:shadow-xl ${feature.hoverShadow} ${feature.hoverBorder} hover:-translate-y-1 transition-all duration-300 flex flex-col`}
            >
              <div
                className={`w-14 h-14 rounded-2xl ${feature.bg} flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300`}
              >
                <feature.icon className={`w-7 h-7 ${feature.color}`} />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">{feature.title}</h3>
              <p className="text-slate-500 leading-relaxed text-base flex-1">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </PageContainer>
    </section>
  );
});

CoreFeatures.displayName = "CoreFeatures";

export default CoreFeatures;
