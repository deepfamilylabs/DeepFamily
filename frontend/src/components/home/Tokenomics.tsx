import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Coins, TrendingUp, Award, Target, Wallet, PieChart } from "lucide-react";
import { ANIMATION_CLASSES } from "../../constants/animationStyles";
import PageContainer from "../PageContainer";

const Tokenomics = memo(() => {
  const { t } = useTranslation();

  const items = [
    {
      icon: Coins,
      title: t("home.tokenomics.deepToken.title"),
      description: t("home.tokenomics.deepToken.description"),
      color: "text-purple-600",
      bg: "bg-purple-50",
      border: "border-purple-100",
      hoverBorder: "group-hover:border-purple-200",
      hoverShadow: "group-hover:shadow-purple-500/10",
    },
    {
      icon: Wallet,
      title: t("home.tokenomics.supply.title"),
      description: t("home.tokenomics.supply.description"),
      color: "text-blue-600",
      bg: "bg-blue-50",
      border: "border-blue-100",
      hoverBorder: "group-hover:border-blue-200",
      hoverShadow: "group-hover:shadow-blue-500/10",
    },
    {
      icon: Award,
      title: t("home.tokenomics.mining.title"),
      description: t("home.tokenomics.mining.description"),
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      border: "border-emerald-100",
      hoverBorder: "group-hover:border-emerald-200",
      hoverShadow: "group-hover:shadow-emerald-500/10",
    },
    {
      icon: Coins,
      title: t("home.tokenomics.endorsement.title"),
      description: t("home.tokenomics.endorsement.description"),
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      border: "border-indigo-100",
      hoverBorder: "group-hover:border-indigo-200",
      hoverShadow: "group-hover:shadow-indigo-500/10",
    },
    {
      icon: TrendingUp,
      title: t("home.tokenomics.distribution.title"),
      description: t("home.tokenomics.distribution.description"),
      color: "text-orange-600",
      bg: "bg-orange-50",
      border: "border-orange-100",
      hoverBorder: "group-hover:border-orange-200",
      hoverShadow: "group-hover:shadow-orange-500/10",
    },
    {
      icon: Target,
      title: t("home.tokenomics.goal.title"),
      description: t("home.tokenomics.goal.description"),
      color: "text-rose-600",
      bg: "bg-rose-50",
      border: "border-rose-100",
      hoverBorder: "group-hover:border-rose-200",
      hoverShadow: "group-hover:shadow-rose-500/10",
    },
  ];

  return (
    <section className="py-32 bg-white relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <PageContainer className="relative z-10">
        {/* Header */}
        <div className={`text-center mb-20 ${ANIMATION_CLASSES.FADE_IN_UP}`}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-50 border border-purple-100 mb-8 shadow-sm">
            <PieChart className="w-3.5 h-3.5 text-purple-600" />
            <span className="text-xs font-bold text-purple-700 uppercase tracking-wider">
              {t("home.tokenomics.pill", "Tokenomics")}
            </span>
          </div>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 mb-8 tracking-tight leading-tight">
            {t("home.tokenomics.title")}
          </h2>
          <p className="text-xl text-slate-500 max-w-3xl mx-auto leading-relaxed font-normal">
            {t("home.tokenomics.subtitle")}
          </p>
        </div>

        {/* Grid */}
        <div
          className={`grid md:grid-cols-2 lg:grid-cols-3 gap-8 relative z-10 ${ANIMATION_CLASSES.FADE_IN_UP} animation-delay-200`}
        >
          {items.map((item, index) => (
            <div
              key={index}
              className={`group bg-white rounded-3xl p-10 shadow-sm border ${item.border} hover:shadow-xl ${item.hoverShadow} ${item.hoverBorder} hover:-translate-y-1 transition-all duration-300 flex flex-col`}
            >
              <div
                className={`w-14 h-14 rounded-2xl ${item.bg} flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300`}
              >
                <item.icon className={`w-7 h-7 ${item.color}`} />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">{item.title}</h3>
              <p className="text-slate-500 leading-relaxed text-base flex-1">{item.description}</p>
            </div>
          ))}
        </div>
      </PageContainer>
    </section>
  );
});

Tokenomics.displayName = "Tokenomics";

export default Tokenomics;
