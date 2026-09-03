import { memo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp, Shield, Key, GitBranch, Users, Gem, FileText } from "lucide-react";
import { ANIMATION_CLASSES } from "../../../shared/ui/styles/animationStyles";
import { PageContainer } from "../../../shared/ui";

const BorderLine = ({ side, className = "" }: { side: "left" | "right"; className?: string }) => (
  <div
    className={`hidden md:block absolute top-0 bottom-0 w-px transition-colors duration-300
      ${side === "left" ? "left-0" : "right-0"}
      ${className}
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

const ValuePropositions = memo(() => {
  const { t } = useTranslation();

  const features = [
    {
      key: "zkPrivacy",
      icon: Shield,
    },
    {
      key: "saltedUnlinkability",
      icon: Key,
    },
    {
      key: "dualTreeModels",
      icon: GitBranch,
    },
    {
      key: "communityEndorsement",
      icon: Users,
    },
    {
      key: "nftValueCreation",
      icon: Gem,
    },
    {
      key: "storyShardingSealing",
      icon: FileText,
    },
  ];

  return (
    <section className="py-24 lg:py-32 bg-surface relative overflow-hidden">
      <PageContainer>
        {/* Section Header */}
        <div
          className={`text-center mb-12 lg:mb-20 max-w-3xl mx-auto ${ANIMATION_CLASSES.FADE_IN_UP}`}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-alt mb-6 border border-hairline">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span className="text-sm font-bold text-ink-muted tracking-wide uppercase">
              Value Propositions
            </span>
          </div>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-ink mb-6 tracking-tight leading-[1.1]">
            {t("home.valueProps.title")}
          </h2>

          <p className="text-xl text-ink-muted leading-relaxed">{t("home.valueProps.subtitle")}</p>
        </div>

        {/* Grid - xAI Style - 2 Row 3 Cols */}
        <div className={`grid md:grid-cols-2 lg:grid-cols-3 ${ANIMATION_CLASSES.FADE_IN}`}>
          {features.map((feature, index) => {
            // Determine border visibility based on grid position
            // Left border is always visible (default)
            // Right border is visible if it's the last item in the row
            const isLastInRowMd = (index + 1) % 2 === 0;
            const isLastInRowLg = (index + 1) % 3 === 0;

            // Construct border classes for responsiveness
            const rightBorderClass = `
              bg-transparent 
              md:${isLastInRowMd ? "bg-hairline" : "bg-transparent"} 
              lg:${isLastInRowLg ? "bg-hairline" : "bg-transparent"}
            `;

            return (
              <div key={feature.key} className="group relative h-full">
                {/* Interactive Area Layer (Background & Lines) */}
                <div className="absolute inset-x-0 top-2 bottom-2 pointer-events-none">
                  {/* Hover Background - Gradient matching Theme */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-linear-to-r from-primary/10 to-transparent" />

                  {/* Left Border Line */}
                  <BorderLine side="left" className="bg-hairline" />

                  {/* Right Border Line (Logic applied) */}
                  <BorderLine side="right" className={rightBorderClass} />

                  {/* Mobile Line (Simple left border for <md) */}
                  <div className="md:hidden absolute left-0 top-0 bottom-0 w-px bg-hairline" />
                </div>

                {/* Content Layer */}
                <div className="relative z-10 p-10 lg:p-12 h-full flex flex-col">
                  {/* Icon */}
                  <div className="mb-6 lg:mb-8">
                    <feature.icon className="w-10 h-10 lg:w-12 lg:h-12 text-ink-subtle group-hover:text-primary transition-colors duration-300 stroke-[1.5]" />
                  </div>

                  {/* Title */}
                  <h3 className="text-2xl font-bold text-ink mb-4">
                    {t(`home.valueProps.${feature.key}.title`)}
                  </h3>

                  {/* Description */}
                  <p className="text-lg text-ink-muted group-hover:text-ink transition-colors duration-300 leading-relaxed">
                    {t(`home.valueProps.${feature.key}.description`)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </PageContainer>
    </section>
  );
});

ValuePropositions.displayName = "ValuePropositions";

export default ValuePropositions;
