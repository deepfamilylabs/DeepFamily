import React, { memo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, GitCommit, ThumbsUp, Gem, PenTool, Lock, GitBranch } from "lucide-react";
import { ANIMATION_CLASSES } from "../constants/animationStyles";
import PageContainer from "./PageContainer";

const WorkflowSection: React.FC = memo(() => {
  const { t } = useTranslation();

  const steps = [
    {
      number: 1,
      icon: GitCommit,
      title: t("home.valueSystem.advantages.step1", "Add Person Version"),
      description: t(
        "home.valueSystem.advantages.step1Desc",
        "Submit parent hash commitments → receive DEEP token rewards",
      ),
      color: "text-blue-600",
      bg: "bg-blue-50",
      border: "border-blue-100",
      hoverBorder: "group-hover:border-blue-200",
      hoverShadow: "group-hover:shadow-blue-500/10",
    },
    {
      number: 2,
      icon: ThumbsUp,
      title: t("home.valueSystem.advantages.step2", "Community Endorsement"),
      description: t(
        "home.valueSystem.advantages.step2Desc",
        "Pay DEEP tokens to endorse a version",
      ),
      color: "text-purple-600",
      bg: "bg-purple-50",
      border: "border-purple-100",
      hoverBorder: "group-hover:border-purple-200",
      hoverShadow: "group-hover:shadow-purple-500/10",
    },
    {
      number: 3,
      icon: Gem,
      title: t("home.valueSystem.advantages.step3", "Mint Version NFT"),
      description: t(
        "home.valueSystem.advantages.step3Desc",
        "Endorsers can mint NFTs for corresponding versions",
      ),
      color: "text-pink-600",
      bg: "bg-pink-50",
      border: "border-pink-100",
      hoverBorder: "group-hover:border-pink-200",
      hoverShadow: "group-hover:shadow-pink-500/10",
    },
    {
      number: 4,
      icon: PenTool,
      title: t("home.valueSystem.advantages.step4", "Write Story Shards"),
      description: t(
        "home.valueSystem.advantages.step4Desc",
        "NFT holders write/append person story fragments",
      ),
      color: "text-rose-600",
      bg: "bg-rose-50",
      border: "border-rose-100",
      hoverBorder: "group-hover:border-rose-200",
      hoverShadow: "group-hover:shadow-rose-500/10",
    },
    {
      number: 5,
      icon: Lock,
      title: t("home.valueSystem.advantages.step5", "Story Sealing"),
      description: t(
        "home.valueSystem.advantages.step5Desc",
        "Seal stories to form immutable on-chain historical records",
      ),
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
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 mb-8 shadow-sm">
            <GitBranch className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
              Workflow Process
            </span>
          </div>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 mb-8 tracking-tight leading-tight">
            {t("home.valueSystem.advantages.title", "Workflow Process")}
          </h2>
          <p className="text-xl text-slate-500 max-w-3xl mx-auto leading-relaxed font-normal">
            {t(
              "home.valueSystem.advantages.subtitle",
              "Five-step value discovery and consensus formation mechanism",
            )}
          </p>
        </div>

        {/* Workflow Steps */}
        <div className={`relative z-10 ${ANIMATION_CLASSES.FADE_IN_UP} animation-delay-200`}>
          {/* Connecting Line (Desktop) */}
          <div className="hidden lg:block absolute top-12 left-0 w-full h-0.5 bg-slate-100 -z-10" />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
            {steps.map((step, index) => (
              <div
                key={index}
                className={`group relative bg-white rounded-3xl p-8 border ${step.border} shadow-sm hover:shadow-xl ${step.hoverShadow} ${step.hoverBorder} transition-all duration-300 hover:-translate-y-1 flex flex-col items-center text-center h-full`}
              >
                {/* Step Number Badge */}
                <div className="absolute -top-4 bg-white px-3 py-1 rounded-full border border-slate-100 shadow-sm text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Step {step.number}
                </div>

                <div
                  className={`w-16 h-16 rounded-2xl ${step.bg} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}
                >
                  <step.icon className={`w-8 h-8 ${step.color}`} />
                </div>

                <h3 className="text-lg font-bold text-slate-900 mb-3 leading-tight">
                  {step.title}
                </h3>

                <p className="text-slate-500 text-sm leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </PageContainer>
    </section>
  );
});

WorkflowSection.displayName = "WorkflowSection";

export default WorkflowSection;
