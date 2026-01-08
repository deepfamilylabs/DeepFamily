import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Shield, Eye, CheckCircle, Zap } from "lucide-react";
import { ANIMATION_CLASSES } from "../../constants/animationStyles";
import PageContainer from "../PageContainer";

const BorderLine = ({ side, className = "" }: { side: "left" | "right"; className?: string }) => (
  <div
    className={`hidden md:block absolute top-0 bottom-0 w-[1px] transition-colors duration-300
      ${side === "left" ? "left-0" : "right-0"}
      ${className}
      group-hover:bg-slate-300
    `}
  >
    {/* Top Cap */}
    <div
      className={`absolute top-0 h-[1px] w-3 bg-slate-300 transition-opacity duration-300 opacity-0 group-hover:opacity-100
        ${side === "left" ? "left-0" : "right-0"}
      `}
    />
    {/* Bottom Cap */}
    <div
      className={`absolute bottom-0 h-[1px] w-3 bg-slate-300 transition-opacity duration-300 opacity-0 group-hover:opacity-100
        ${side === "left" ? "left-0" : "right-0"}
      `}
    />
  </div>
);

const TwoLayerValueSystem = memo(() => {
  const { t } = useTranslation();

  const layers = [
    {
      key: "layer1",
      icon: Shield,
    },
    {
      key: "layer2",
      icon: Eye,
    },
  ];

  return (
    <section className="py-24 lg:py-32 bg-white relative overflow-hidden">
      <PageContainer>
        {/* Section Header */}
        <div
          className={`text-center mb-12 lg:mb-20 max-w-3xl mx-auto ${ANIMATION_CLASSES.FADE_IN_UP}`}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-50 mb-6 border border-orange-100">
            <Zap className="w-3.5 h-3.5 text-orange-600" />
            <span className="text-sm font-bold text-orange-600 tracking-wide uppercase">
              Core Architecture
            </span>
          </div>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 mb-6 tracking-tight leading-[1.1]">
            {t("home.valueSystem.title")}
          </h2>

          <p className="text-xl text-slate-500 leading-relaxed">{t("home.valueSystem.subtitle")}</p>
        </div>

        {/* Grid - xAI Style - 2 Columns */}
        <div className={`grid md:grid-cols-2 ${ANIMATION_CLASSES.FADE_IN}`}>
          {layers.map((layer, index) => {
            const isLastInRow = (index + 1) % 2 === 0;

            return (
              <div key={layer.key} className="group relative h-full">
                {/* Interactive Area Layer (Background & Lines) */}
                <div className="absolute inset-x-0 top-2 bottom-2 pointer-events-none">
                  {/* Hover Background - Gradient matching Theme */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-r from-orange-50 to-transparent" />

                  {/* Left Border Line */}
                  <BorderLine side="left" className="bg-slate-200" />

                  {/* Right Border Line (Only for last item in row by default) */}
                  <BorderLine
                    side="right"
                    className={isLastInRow ? "bg-slate-200" : "bg-transparent"}
                  />

                  {/* Mobile Line (Simple left border for <md) */}
                  <div className="md:hidden absolute left-0 top-0 bottom-0 w-[1px] bg-slate-200" />
                </div>

                {/* Content Layer */}
                <div className="relative z-10 p-10 lg:p-12 h-full flex flex-col">
                  {/* Icon */}
                  <div className="mb-6 lg:mb-8">
                    <layer.icon className="w-10 h-10 lg:w-12 lg:h-12 text-slate-400 group-hover:text-orange-600 transition-colors duration-300 stroke-[1.5]" />
                  </div>

                  {/* Title */}
                  <div className="flex items-center gap-4 mb-4 lg:mb-6">
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-500 font-bold text-sm group-hover:bg-orange-100 group-hover:text-orange-600 transition-colors duration-300">
                      {index + 1}
                    </span>
                    <h3 className="text-2xl lg:text-3xl font-bold text-slate-900">
                      {t(`home.valueSystem.${layer.key}.title`)}
                    </h3>
                  </div>

                  {/* Description */}
                  <p className="text-lg text-slate-500 group-hover:text-slate-900 transition-colors duration-300 leading-relaxed mb-8 flex-grow">
                    {t(`home.valueSystem.${layer.key}.description`)}
                  </p>

                  {/* Benefits List */}
                  <div className="space-y-3 mt-auto pt-8 border-t border-slate-100/0 group-hover:border-slate-200/50 transition-colors duration-300">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-slate-400 group-hover:text-orange-600 transition-colors duration-300 mt-1 flex-shrink-0" />
                        <span className="text-slate-500 group-hover:text-slate-900 transition-colors duration-300 font-medium">
                          {t(`home.valueSystem.${layer.key}.feature${i}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </PageContainer>
    </section>
  );
});

TwoLayerValueSystem.displayName = "TwoLayerValueSystem";

export default TwoLayerValueSystem;
