import { BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { PersonHashCalculator } from "../domains/person";
import { useUnifiedSearch } from "./search/hooks/useUnifiedSearch";
import { getFacetDescriptor, type SearchFacetKey } from "./search/model/searchSubject";
import { FACET_LABELS, FACET_TOTAL_LABEL_KEYS, FacetPanel } from "./search/sections/SearchFacetPanels";
import {
  CommandBar,
  EntryCards,
  ErrorResult,
  FacetTabs,
  LoadingRows,
  NftIdentityCard,
  Pagination,
  ResultMeta,
  ResultShell,
  ResolvedNftBadge,
  ScopeBar,
  ScopePrompt,
  VersionScopeSelect,
} from "./search/ui/UnifiedSearchUi";

export default function SearchPage() {
  const unified = useUnifiedSearch();
  const { t, search, submitted } = unified;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8 text-ink md:pb-0">
      <header>
        <h1 className="mb-1.5 text-3xl text-ink sm:text-4xl">{t("navigation.search")}</h1>
        <p className="text-base leading-relaxed text-ink-muted">
          {t(
            "search.unified.subtitle",
            "Search on-chain versions, endorsements, NFTs, stories and family links by person hash, token ID or wallet address.",
          )}
        </p>
      </header>

      <CommandBar
        t={t}
        value={unified.queryInput}
        onChange={unified.setQueryInput}
        onSubmit={unified.submit}
        onClear={unified.clear}
        subject={unified.subject}
        canSubmit={unified.canSubmit}
        recent={unified.recent}
        onPickRecent={unified.searchFor}
        calculatorOpen={unified.calculatorOpen}
        onToggleCalculator={() => unified.setCalculatorOpen(!unified.calculatorOpen)}
      >
        <div className="space-y-4">
          <PersonHashCalculator
            ref={search.hash.hashCalcRef}
            showTitle={false}
            collapsible={false}
            className="border-0 bg-transparent p-0 shadow-none"
            onPublicFormChange={search.hash.onPublicFormChange}
            onComputedHashChange={(hash) => {
              if (hash) unified.setQueryInput(hash);
            }}
          />
          {search.hash.hasPassphrase && (
            <p className="rounded-xl border border-info/20 bg-info/5 p-3 text-xs text-ink-muted">
              {t(
                "search.hashCalculator.deterministicIdentityNotice",
                "Identity suite 1 always derives its salt deterministically from the canonical identity fields. No recovery salt is stored or accepted.",
              )}
            </p>
          )}
        </div>
      </CommandBar>

      {submitted ? <Results unified={unified} /> : <EntryCards t={t} />}
    </div>
  );
}

function Results({ unified }: { unified: ReturnType<typeof useUnifiedSearch> }) {
  const { t, submitted } = unified;
  if (!submitted) return null;

  const descriptor = getFacetDescriptor(unified.activeFacet);
  const state = unified.activeFacetState;
  const actions = unified.activeFacetActions;

  const tabs = unified.availableFacets.map((facet) => ({
    key: facet.key,
    label: t(FACET_LABELS[facet.key].key, FACET_LABELS[facet.key].fallback),
    count: facetCount(unified, facet.key),
  }));

  const totalLabelKey = FACET_TOTAL_LABEL_KEYS[unified.activeFacet];

  return (
    <div className="space-y-5">
      {submitted.kind === "tokenId" ? (
        <NftIdentityCard
          t={t}
          tokenId={submitted.tokenId}
          core={unified.nftIdentity?.core}
          personHash={unified.nftIdentity?.personHash}
          versionIndex={unified.nftIdentity?.versionIndex}
          onCopy={unified.onCopy}
          onSearchPerson={unified.searchFor}
          action={
            <Link
              to={`/person/${submitted.tokenId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-surface-muted px-5 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
            >
              <BookOpen size={15} aria-hidden="true" />
              {t("familyTree.nodeDetail.encyclopedia", "Encyclopedia")}
            </Link>
          }
        />
      ) : null}

      <FacetTabs
        tabs={tabs}
        activeKey={unified.activeFacet}
        onSelect={(key) => unified.selectFacet(key as SearchFacetKey)}
      />

      <ResultShell>
        {submitted.kind === "personHash" &&
          (descriptor.scope === "personVersion" || descriptor.scope === "token") && (
            <ScopeBar label={t("search.unified.scope.versionLabel", "Version")}>
              <VersionScopeSelect
                t={t}
                value={unified.versionIndex}
                options={unified.versionOptions}
                min={descriptor.minVersionIndex}
                onChange={unified.setVersionIndex}
              />
              {descriptor.scope === "token" ? (
                <ResolvedNftBadge t={t} tokenId={unified.tokenForVersion(unified.versionIndex)} />
              ) : null}
            </ScopeBar>
          )}

        <ResultMeta
          t={t}
          total={state.total}
          totalLabel={t(totalLabelKey)}
          pageSize={unified.pageSize}
          onPageSizeChange={unified.changePageSize}
        />

        {!unified.activeRunnable ? (
          <ScopePrompt
            t={t}
            message={
              descriptor.scope === "token"
                ? t(
                    "search.unified.scope.needToken",
                    "No version of this person has been minted, so there is no NFT to read here.",
                  )
                : t("search.unified.scope.needVersion", "Pick a version to run this query.")
            }
          />
        ) : state.error ? (
          <ErrorResult t={t} message={state.error} onRetry={unified.retryActive} />
        ) : state.loading ? (
          <LoadingRows t={t} />
        ) : state.queried ? (
          <FacetPanel unified={unified} />
        ) : (
          <LoadingRows t={t} />
        )}

        {state.queried && !state.error && (
          <Pagination
            t={t}
            offset={state.offset}
            loading={state.loading}
            hasMore={state.hasMore}
            onPrev={actions.prev}
            onNext={actions.next}
          />
        )}
      </ResultShell>
    </div>
  );
}

/** Badge counts come from facets the page has actually queried — never guessed. */
function facetCount(
  unified: ReturnType<typeof useUnifiedSearch>,
  key: SearchFacetKey,
): number | undefined {
  const { search } = unified;
  if (key === "personNfts") {
    const s = unified.personNfts.state;
    return s.queried && !s.loading ? s.total : undefined;
  }
  if (key === "accountVersions") {
    const s = unified.accountFacets.versions.state;
    return s.queried && !s.loading ? s.total : undefined;
  }
  if (key === "accountEndorsements") {
    const s = unified.accountFacets.endorsements.state;
    return s.queried && !s.loading ? s.total : undefined;
  }
  if (key === "accountNfts") {
    const s = unified.accountFacets.nfts.state;
    return s.queried && !s.loading ? s.total : undefined;
  }
  const state =
    key === "versions"
      ? search.versions.state
      : key === "trustedEndorsers"
        ? search.trustedEndorsers.state
        : key === "endorsement"
          ? search.endorsement.state
          : key === "children"
            ? search.children.state
            : key === "storyChunks"
              ? search.storyChunks.state
              : search.uri.state;
  return state.queried && !state.loading ? state.total : undefined;
}

