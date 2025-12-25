import { memo } from "react";
import { NavLink } from "react-router-dom";
import { ArrowRight, Shield, Lock, FileText, Github } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageContainer from "../PageContainer";

const GITHUB_REPO_URL = "https://github.com/deepfamilylabs/DeepFamily";

const CallToAction = memo(() => {
  const { t } = useTranslation();

  return (
    <section className="relative py-32 w-screen ml-[calc(-50vw+50%)] overflow-hidden bg-white">
      {/* Soft, Airy Gradients */}
      
      {/* Left Glow - Soft Blue/Cyan */}
      <div className="absolute top-1/2 left-0 -translate-y-1/2 w-[800px] h-[800px] bg-blue-100/80 rounded-full blur-[120px] pointer-events-none -translate-x-1/4 mix-blend-multiply" />
      
      {/* Right Glow - Soft Pink/Orange */}
      <div className="absolute top-1/2 right-0 -translate-y-1/2 w-[800px] h-[800px] bg-orange-100/80 rounded-full blur-[120px] pointer-events-none translate-x-1/4 mix-blend-multiply" />

      <PageContainer className="relative z-10">
        <div className="text-center max-w-4xl mx-auto">
          <h2 className="text-4xl md:text-6xl font-bold text-slate-900 mb-8 tracking-tight leading-tight">
            {t("home.cta.title")}
          </h2>
          <p className="text-lg md:text-xl text-slate-500 mb-12 max-w-2xl mx-auto leading-relaxed font-light">
            {t("home.cta.subtitle")}
          </p>

          <div className="flex flex-col sm:flex-row gap-6 justify-center items-center mb-20">
            {/* Primary Button: Vibrant Gradient (Orange/Red like screenshot) */}
            <NavLink
              to="/actions"
              className="group relative inline-flex items-center gap-2 bg-gradient-to-r from-orange-400 to-red-500 text-white px-10 py-4 rounded-full font-bold hover:shadow-lg hover:shadow-orange-500/25 transition-all duration-300 hover:scale-105"
            >
              <span className="relative z-10">{t("home.cta.startButton")}</span>
              <ArrowRight className="w-5 h-5 relative z-10 group-hover:translate-x-1 transition-transform duration-300" />
            </NavLink>

            {/* Secondary Button: Minimalist Outline */}
            <NavLink
              to="/familyTree"
              className="group inline-flex items-center gap-2 border border-slate-200 bg-white text-slate-600 px-10 py-4 rounded-full font-bold hover:bg-slate-50 hover:border-slate-300 transition-all duration-300"
            >
              {t("home.cta.exploreButton")}
            </NavLink>
          </div>


        </div>
      </PageContainer>
    </section>
  );
});

CallToAction.displayName = "CallToAction";

export default CallToAction;
