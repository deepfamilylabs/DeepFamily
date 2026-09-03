import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Users, Search, Code, PenTool, CheckCircle } from "lucide-react";
import { ANIMATION_CLASSES } from "../../../shared/ui/styles/animationStyles";
import { PageContainer } from "../../../shared/ui";

const BorderLine = ({ side, showDefault }: { side: "left" | "right"; showDefault?: boolean }) => (
  <div
    className={`hidden md:block absolute top-0 bottom-0 w-px transition-colors duration-300
      ${side === "left" ? "left-0" : "right-0"}
      ${showDefault ? "bg-hairline" : "bg-transparent"}
      group-hover:bg-hairline-strong
    `}
  >
    {/* Top Cap */}
    <div
      className={`absolute top-0 h-px w-3 bg-hairline-strong transition-opacity duration-300 opacity-0 group-hover:opacity-100
        ${side === "left" ? "left-0" : "right-0"}
      `}
    />
    {/* Bottom Cap */}
    <div
      className={`absolute bottom-0 h-px w-3 bg-hairline-strong transition-opacity duration-300 opacity-0 group-hover:opacity-100
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
    <section className="py-24 lg:py-32 bg-surface relative overflow-hidden">
      <PageContainer>
        {/* Section Header */}
        <div
          className={`text-center mb-12 lg:mb-20 max-w-3xl mx-auto ${ANIMATION_CLASSES.FADE_IN_UP}`}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 mb-6 border border-orange-500/20">
            <span className="text-sm font-bold text-primary tracking-wide uppercase">
              Target Audience
            </span>
          </div>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-ink mb-6 tracking-tight leading-[1.1]">
            {t("home.audience.title")}
          </h2>

          <p className="text-xl text-ink-muted leading-relaxed">{t("home.audience.subtitle")}</p>
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
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-linear-to-r from-primary/10 to-transparent" />

                  {/* Left Border Line */}
                  <BorderLine side="left" showDefault={true} />

                  {/* Right Border Line (Only for last item in row by default, forcing visual balance) */}
                  <BorderLine side="right" showDefault={isLastInRow} />

                  {/* Mobile Line (Simple left border) */}
                  <div className="md:hidden absolute left-0 top-0 bottom-0 w-px bg-hairline" />
                </div>

                {/* Content Layer */}
                <div className="relative z-10 p-12 h-full flex flex-col">
                  {/* Icon */}
                  <div className="mb-6 lg:mb-8">
                    <item.icon className="w-10 h-10 lg:w-12 lg:h-12 text-ink-subtle group-hover:text-primary transition-colors duration-300 stroke-[1.5]" />
                  </div>

                  {/* Title */}
                  <h3 className="text-2xl lg:text-3xl font-bold text-ink mb-4 lg:mb-6">
                    {t(`home.audience.${item.key}.title`)}
                  </h3>

                  {/* Description */}
                  <p className="text-lg text-ink-muted group-hover:text-ink transition-colors duration-300 leading-relaxed mb-8 grow">
                    {t(`home.audience.${item.key}.description`)}
                  </p>

                  {/* Benefits List */}
                  <div className="space-y-3 mt-auto pt-8 border-t border-hairline/0 group-hover:border-hairline/50 transition-colors duration-300">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-ink-subtle group-hover:text-primary transition-colors duration-300 mt-1 shrink-0" />
                      <span className="text-ink-muted group-hover:text-ink transition-colors duration-300 font-medium">
                        {t(`home.audience.${item.key}.benefit1`)}
                      </span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-ink-subtle group-hover:text-primary transition-colors duration-300 mt-1 shrink-0" />
                      <span className="text-ink-muted group-hover:text-ink transition-colors duration-300 font-medium">
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
