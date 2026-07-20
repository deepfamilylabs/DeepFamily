import { BookOpen, Tag, Users, X } from "lucide-react";
import type { ReactNode } from "react";
import { PageContainer } from "../../../shared/ui";
import type { PeoplePageController } from "../hooks/usePeoplePageController";
import type { PeoplePageT } from "../model/peoplePageModel";

interface PeopleHeroSectionProps {
  t: PeoplePageT;
  stats: PeoplePageController["stats"];
  personNotice: PeoplePageController["personNotice"];
}

export function PeopleHeroSection({ t, stats, personNotice }: PeopleHeroSectionProps) {
  return (
    <section className="relative pt-24 pb-12 md:pt-32 md:pb-20 overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-[radial-gradient(ellipse_at_top,rgba(251,146,60,0.15),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(251,146,60,0.1),transparent_70%)] pointer-events-none" />

      <PageContainer className="relative z-10">
        <div className="text-center mb-16 md:mb-24">
          <h1 className="text-6xl md:text-8xl font-bold tracking-tighter mb-6">
            <span className="bg-clip-text text-transparent bg-linear-to-b from-ink to-ink-muted">
              {t("people.title", "Family Encyclopedia")}
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-ink-muted max-w-2xl mx-auto font-light leading-relaxed">
            {t("people.subtitle", "Explore family member profiles preserved on the blockchain")}
          </p>
        </div>

        <PersonProjectionWarning t={t} personNotice={personNotice} />
        <PeopleStatsGrid t={t} stats={stats} />
      </PageContainer>
    </section>
  );
}

function PersonProjectionWarning({
  t,
  personNotice,
}: {
  t: PeoplePageT;
  personNotice: PeoplePageController["personNotice"];
}) {
  if (!personNotice.query) return null;

  return (
    <div className="max-w-3xl mx-auto mb-10 px-4">
      <div className="rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-900/20 px-5 py-4 text-sm text-amber-900 dark:text-amber-100">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold">
              {t(
                "people.personNotInTree.title",
                "This person isn’t in the current tree projection",
              )}
            </div>
            <div className="mt-1 text-amber-800/90 dark:text-amber-200/90 break-all">
              {t("people.personNotInTree.query", "Query")}: {personNotice.query}
            </div>
            <div className="mt-2 text-amber-800/80 dark:text-amber-200/80">
              {t(
                "people.personNotInTree.hint",
                "Adjust the global tree configuration (root/contract/network) to include it, or open the Tree page.",
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={personNotice.openTree}
                className="px-3 py-1.5 rounded-full bg-amber-900/90 text-amber-50 hover:bg-amber-900 transition-colors text-xs font-semibold"
              >
                {t("people.personNotInTree.openTree", "Open Tree")}
              </button>
              <button
                type="button"
                onClick={personNotice.clear}
                className="px-3 py-1.5 rounded-full bg-white/90 dark:bg-slate-900/40 border border-amber-300/60 dark:border-amber-800/40 text-amber-900 dark:text-amber-100 hover:bg-white dark:hover:bg-slate-900/60 transition-colors text-xs font-semibold"
              >
                {t("common.dismiss", "Dismiss")}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={personNotice.clear}
            className="p-2 rounded-full hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            aria-label={t("common.close", "Close")}
            title={t("common.close", "Close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PeopleStatsGrid({
  t,
  stats,
}: {
  t: PeoplePageT;
  stats: PeoplePageController["stats"];
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-5xl mx-auto">
      <StatCard
        icon={<Users className="w-5 h-5" />}
        watermark={<Users className="w-40 h-40" />}
        label={t("people.totalPeople", "People")}
        value={stats.totalCount}
      />
      <StatCard
        icon={<BookOpen className="w-5 h-5" />}
        watermark={<BookOpen className="w-40 h-40" />}
        label={t("people.withEncyclopedia", "Encyclopedia")}
        value={stats.storyCount}
      />
      <StatCard
        icon={<Tag className="w-5 h-5" />}
        watermark={<Tag className="w-40 h-40" />}
        label={t("people.withNFTs", "NFTs")}
        value={stats.totalNFTs}
      />
    </div>
  );
}

// Unified brand treatment: cards are distinguished by icon + label, not by
// clashing accent hues. All chrome flows from semantic tokens. To give one card
// a different accent, swap the value gradient to another token (e.g. from-info).
function StatCard({
  icon,
  watermark,
  label,
  value,
}: {
  icon: ReactNode;
  watermark: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="group relative p-8 rounded-4xl bg-surface shadow-xl shadow-ink/5 dark:shadow-none border border-hairline overflow-hidden hover:-translate-y-1 transition-all duration-500">
      <div className="absolute -right-6 -top-6 text-primary opacity-[0.04] group-hover:opacity-[0.09] transition-opacity duration-500 transform group-hover:scale-110 group-hover:rotate-12 origin-center">
        {watermark}
      </div>
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
            {icon}
          </div>
          <div className="text-xs font-bold uppercase tracking-widest text-ink-subtle">
            {label}
          </div>
        </div>
        <div className="text-6xl font-black tracking-tighter bg-linear-to-br from-primary to-primary-hover bg-clip-text text-transparent tabular-nums">
          {value}
        </div>
      </div>
    </div>
  );
}
