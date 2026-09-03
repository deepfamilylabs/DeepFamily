import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Coins, TrendingUp, Award, Target, Wallet, PieChart, BadgeCheck } from "lucide-react";
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

const Tokenomics = memo(() => {
  const { t } = useTranslation();

  const items = [
    {
      icon: Coins,
      key: "deepToken",
    },
    {
      icon: Wallet,
      key: "supply",
    },
    {
      icon: Award,
      key: "mining",
    },
    {
      icon: BadgeCheck,
      key: "endorsement",
    },
    {
      icon: TrendingUp,
      key: "distribution",
    },
    {
      icon: Target,
      key: "goal",
    },
  ];

  return (
    <section className="py-24 lg:py-32 bg-surface relative overflow-hidden">
      <PageContainer>
        {/* Section Header */}
        <div
          className={`text-center mb-12 lg:mb-20 max-w-3xl mx-auto ${ANIMATION_CLASSES.FADE_IN_UP}`}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 mb-6 border border-purple-500/20">
            <PieChart className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <span className="text-sm font-bold text-purple-600 dark:text-purple-400 tracking-wide uppercase">
              {t("home.tokenomics.pill", "Protocol Incentives")}
            </span>
          </div>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-ink mb-6 tracking-tight leading-[1.1]">
            {t("home.tokenomics.title")}
          </h2>

          <p className="text-xl text-ink-muted leading-relaxed">{t("home.tokenomics.subtitle")}</p>
        </div>

        {/* Grid - xAI Style - 2 Row 3 Cols */}
        <div className={`grid md:grid-cols-2 lg:grid-cols-3 ${ANIMATION_CLASSES.FADE_IN}`}>
          {items.map((item, index) => {
            // Determine border visibility based on grid position
            // Left border is always visible (default)
            // Right border is visible if it's the last item in the row
            const isLastInRowMd = (index + 1) % 2 === 0;
            const isLastInRowLg = (index + 1) % 3 === 0;

            // Construct border classes for responsiveness
            // We want bg-hairline to be showing if it's last in row for that breakpoint
            // Otherwise bg-transparent

            // For right border:
            // Mobile (hidden by md:block in component)
            // MD: show if isLastInRowMd
            // LG: show if isLastInRowLg

            // Tailwind class construction:
            const rightBorderClass = `
              bg-transparent 
              md:${isLastInRowMd ? "bg-hairline" : "bg-transparent"} 
              lg:${isLastInRowLg ? "bg-hairline" : "bg-transparent"}
            `;

            return (
              <div key={index} className="group relative h-full">
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
                    <item.icon className="w-10 h-10 lg:w-12 lg:h-12 text-ink-subtle group-hover:text-primary transition-colors duration-300 stroke-[1.5]" />
                  </div>

                  {/* Title */}
                  <h3 className="text-2xl font-bold text-ink mb-4">
                    {t(`home.tokenomics.${item.key}.title`)}
                  </h3>

                  {/* Description */}
                  <p className="text-lg text-ink-muted group-hover:text-ink transition-colors duration-300 leading-relaxed">
                    {t(`home.tokenomics.${item.key}.description`)}
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

Tokenomics.displayName = "Tokenomics";

export default Tokenomics;
