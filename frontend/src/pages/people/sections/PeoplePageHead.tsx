import { BookOpen, Tag, Users, X } from "lucide-react";
import type { ReactNode } from "react";
import { PageContainer } from "../../../shared/ui";
import type { PeoplePageController } from "../hooks/usePeoplePageController";
import type { PeoplePageT } from "../model/peoplePageModel";

interface PeoplePageHeadProps {
  t: PeoplePageT;
  stats: PeoplePageController["stats"];
  personNotice: PeoplePageController["personNotice"];
}

/**
 * Compact page head. Replaces the old full-bleed hero: the title keeps its
 * display face, the three stat cards collapse into one inline metric strip, and
 * the brand wash drops from 500px to 220px — so the first person is visible
 * without scrolling.
 */
export function PeoplePageHead({ t, stats, personNotice }: PeoplePageHeadProps) {
  return (
    <section className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[radial-gradient(ellipse_at_top,rgba(249,115,22,0.11),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(251,146,60,0.09),transparent_70%)]" />

      <PageContainer className="relative z-10 pt-7 pb-5">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-8">
          <div className="min-w-0">
            <h1 className="text-3xl md:text-[2.125rem] text-ink">
              {t("people.title", "Family Encyclopedia")}
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {t("people.subtitle", "Explore family member profiles preserved on the blockchain")}
            </p>
          </div>
          <PeopleStatStrip t={t} stats={stats} />
        </div>

        <PersonProjectionWarning t={t} personNotice={personNotice} />
      </PageContainer>
    </section>
  );
}

function PeopleStatStrip({
  t,
  stats,
}: {
  t: PeoplePageT;
  stats: PeoplePageController["stats"];
}) {
  return (
    <div className="flex items-end gap-5 sm:gap-6 shrink-0">
      <Metric
        icon={<Users className="w-3.5 h-3.5" />}
        label={t("people.totalPeople", "People")}
        value={stats.totalCount}
      />
      <div className="w-px h-8 bg-hairline" />
      <Metric
        icon={<BookOpen className="w-3.5 h-3.5" />}
        label={t("people.withEncyclopedia", "Encyclopedia")}
        value={stats.storyCount}
      />
      <div className="w-px h-8 bg-hairline" />
      <Metric
        icon={<Tag className="w-3.5 h-3.5" />}
        label={t("people.withNFTs", "NFTs")}
        value={stats.totalNFTs}
      />
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[3.5rem]">
      <div className="flex items-center gap-1.5 text-ink-subtle">
        {icon}
        <span className="text-[11px] font-semibold tracking-wide whitespace-nowrap">{label}</span>
      </div>
      <div className="text-[1.625rem] font-extrabold leading-none tracking-tight tabular-nums bg-linear-to-br from-primary to-primary-hover bg-clip-text text-transparent">
        {value}
      </div>
    </div>
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
    <div className="mt-5 rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold">
            {t("people.personNotInTree.title", "This person isn’t in the current tree projection")}
          </div>
          <div className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/90 break-all">
            {t("people.personNotInTree.query", "Query")}: {personNotice.query}
          </div>
          <div className="mt-1.5 text-xs text-amber-800/80 dark:text-amber-200/80">
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
          className="p-1.5 rounded-full hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors shrink-0"
          aria-label={t("common.close", "Close")}
          title={t("common.close", "Close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
