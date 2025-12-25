import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Users, Search, Code, PenTool, Target, CheckCircle } from "lucide-react";
import { ANIMATION_CLASSES } from "../../constants/animationStyles";
import PageContainer from "../PageContainer";

const Audience = memo(() => {
  const { t } = useTranslation();

  const audiences = [
    {
      icon: Users,
      title: t("home.audience.contributors.title"),
      description: t("home.audience.contributors.description"),
      benefits: [
        t("home.audience.contributors.benefit1"),
        t("home.audience.contributors.benefit2"),
      ],
      color: "text-blue-600",
      bg: "bg-blue-50",
      border: "border-blue-100",
      hoverBorder: "group-hover:border-blue-200",
      hoverShadow: "group-hover:shadow-blue-500/10",
    },
    {
      icon: Search,
      title: t("home.audience.researchers.title"),
      description: t("home.audience.researchers.description"),
      benefits: [t("home.audience.researchers.benefit1"), t("home.audience.researchers.benefit2")],
      color: "text-purple-600",
      bg: "bg-purple-50",
      border: "border-purple-100",
      hoverBorder: "group-hover:border-purple-200",
      hoverShadow: "group-hover:shadow-purple-500/10",
    },
    {
      icon: Code,
      title: t("home.audience.developers.title"),
      description: t("home.audience.developers.description"),
      benefits: [t("home.audience.developers.benefit1"), t("home.audience.developers.benefit2")],
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      border: "border-emerald-100",
      hoverBorder: "group-hover:border-emerald-200",
      hoverShadow: "group-hover:shadow-emerald-500/10",
    },
    {
      icon: PenTool,
      title: t("home.audience.creators.title"),
      description: t("home.audience.creators.description"),
      benefits: [t("home.audience.creators.benefit1"), t("home.audience.creators.benefit2")],
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
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-rose-50 border border-rose-100 mb-8 shadow-sm">
            <Target className="w-3.5 h-3.5 text-rose-600" />
            <span className="text-xs font-bold text-rose-700 uppercase tracking-wider">
              Target Audience
            </span>
          </div>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 mb-8 tracking-tight leading-tight">
            {t("home.audience.title")}
          </h2>
          <p className="text-xl text-slate-500 max-w-3xl mx-auto leading-relaxed font-normal">
            {t("home.audience.subtitle")}
          </p>
        </div>

        {/* Audience Grid */}
        <div
          className={`grid md:grid-cols-2 gap-8 relative z-10 ${ANIMATION_CLASSES.FADE_IN_UP} animation-delay-200`}
        >
          {audiences.map((item, index) => (
            <div
              key={index}
              className={`group bg-white rounded-3xl p-10 shadow-sm border ${item.border} hover:shadow-xl ${item.hoverShadow} ${item.hoverBorder} hover:-translate-y-1 transition-all duration-300`}
            >
              <div className="flex items-start gap-8">
                <div
                  className={`w-16 h-16 rounded-2xl ${item.bg} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300`}
                >
                  <item.icon className={`w-8 h-8 ${item.color}`} />
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-slate-900 mb-4">{item.title}</h3>
                  <p className="text-slate-500 leading-relaxed mb-8 text-lg">{item.description}</p>

                  <div className="space-y-3">
                    {item.benefits.map((benefit, i) => (
                      <div key={i} className="flex items-center gap-3 group/item">
                        <CheckCircle
                          className={`w-5 h-5 ${item.color} opacity-60 group-hover/item:opacity-100 transition-opacity`}
                        />
                        <span className="text-slate-600 font-medium group-hover/item:text-slate-900 transition-colors">
                          {benefit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </PageContainer>
    </section>
  );
});

Audience.displayName = "Audience";

export default Audience;
