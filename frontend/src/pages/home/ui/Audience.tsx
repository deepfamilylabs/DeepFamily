import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Users, Search, Code, PenTool, CheckCircle } from "lucide-react";
import { ANIMATION_CLASSES } from "../../../shared/ui/styles/animationStyles";
import { PageContainer } from "../../../shared/ui";

const BorderLine = ({ side, showDefault }: { side: "left" | "right"; showDefault?: boolean }) => (
  <div
    className={`hidden md:block absolute top-0 bottom-0 w-[1px] transition-colors duration-300
      ${side === "left" ? "left-0" : "right-0"}
      ${showDefault ? "bg-slate-200" : "bg-transparent"}
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

const Audience = memo(() => {
  const { t } = useTranslation();

  const audiences = [
    {
      icon: Users,
      key: "contributors",
    },
    {
      icon: Search,
      key: "researchers",
    },
    {
      icon: Code,
      key: "developers",
    },
    {
      icon: PenTool,
      key: "creators",
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
            <span className="text-sm font-bold text-orange-600 tracking-wide uppercase">
              Target Audience
            </span>
          </div>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 mb-6 tracking-tight leading-[1.1]">
            {t("home.audience.title")}
          </h2>

          <p className="text-xl text-slate-500 leading-relaxed">{t("home.audience.subtitle")}</p>
        </div>

        {/* Audience Grid - xAI Style */}
        <div className={`grid md:grid-cols-2 ${ANIMATION_CLASSES.FADE_IN}`}>
          {audiences.map((item, index) => {
            const isLastInRow = (index + 1) % 2 === 0;

            return (
              <div key={item.key} className="group relative h-full">
                {/* Interactive Area Layer (Background & Lines) */}
                <div className="absolute inset-x-0 top-2 bottom-2 pointer-events-none">
                  {/* Hover Background - Gradient matching Theme */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-r from-orange-50 to-transparent" />

                  {/* Left Border Line */}
                  <BorderLine side="left" showDefault={true} />

                  {/* Right Border Line (Only for last item in row by default, forcing visual balance) */}
                  <BorderLine side="right" showDefault={isLastInRow} />

                  {/* Mobile Line (Simple left border) */}
                  <div className="md:hidden absolute left-0 top-0 bottom-0 w-[1px] bg-slate-200" />
                </div>

                {/* Content Layer */}
                <div className="relative z-10 p-12 h-full flex flex-col">
                  {/* Icon */}
                  <div className="mb-6 lg:mb-8">
                    <item.icon className="w-10 h-10 lg:w-12 lg:h-12 text-slate-400 group-hover:text-orange-600 transition-colors duration-300 stroke-[1.5]" />
                  </div>

                  {/* Title */}
                  <h3 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-4 lg:mb-6">
                    {t(`home.audience.${item.key}.title`)}
                  </h3>

                  {/* Description */}
                  <p className="text-lg text-slate-500 group-hover:text-slate-900 transition-colors duration-300 leading-relaxed mb-8 flex-grow">
                    {t(`home.audience.${item.key}.description`)}
                  </p>

                  {/* Benefits List */}
                  <div className="space-y-3 mt-auto pt-8 border-t border-slate-100/0 group-hover:border-slate-200/50 transition-colors duration-300">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-slate-400 group-hover:text-orange-600 transition-colors duration-300 mt-1 flex-shrink-0" />
                      <span className="text-slate-500 group-hover:text-slate-900 transition-colors duration-300 font-medium">
                        {t(`home.audience.${item.key}.benefit1`)}
                      </span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-slate-400 group-hover:text-orange-600 transition-colors duration-300 mt-1 flex-shrink-0" />
                      <span className="text-slate-500 group-hover:text-slate-900 transition-colors duration-300 font-medium">
                        {t(`home.audience.${item.key}.benefit2`)}
                      </span>
                    </div>
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

Audience.displayName = "Audience";

export default Audience;
