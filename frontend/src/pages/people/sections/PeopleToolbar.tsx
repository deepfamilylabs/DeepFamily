import { LayoutGrid, List, Plus, Search, SlidersHorizontal, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageContainer } from "../../../shared/ui";
import type { PeoplePageController } from "../hooks/usePeoplePageController";
import type { PeopleFilterType, PeoplePageT, PeopleViewMode } from "../model/peoplePageModel";
import GenerationFilter from "../ui/GenerationFilter";
import SortMenu from "../ui/SortMenu";

interface PeopleToolbarProps {
  t: PeoplePageT;
  filters: PeoplePageController["filters"];
  view: PeoplePageController["view"];
  loading: boolean;
  filteredCount: number;
}

const sortOptions: Array<{ type: PeopleFilterType; key: string; label: string }> = [
  { type: "all", key: "people.filterAll", label: "Token ID" },
  { type: "by_create_time", key: "people.filterByCreateTime", label: "Creation Time" },
  { type: "by_name", key: "people.filterByName", label: "Name" },
  { type: "by_endorsement", key: "people.filterByEndorsement", label: "Endorsements" },
  { type: "by_generation", key: "people.filterByGeneration", label: "Generation order" },
  { type: "by_birth_date", key: "people.filterByBirthDate", label: "Birth Date" },
];

/**
 * One sticky toolbar in place of the old filter card. Search, sort and view
 * live on a single row; the chip row only appears once a filter is actually
 * applied, and the creator-address input moved into a popover behind the
 * filter button.
 */
export function PeopleToolbar({ t, filters, view, loading, filteredCount }: PeopleToolbarProps) {
  const [addressOpen, setAddressOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!addressOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddressOpen(false);
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setAddressOpen(false);
    };

    inputRef.current?.focus();
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [addressOpen]);

  // The generation rule only means something once the projection carries generations.
  const visibleSortOptions = sortOptions.filter(
    (option) => option.type !== "by_generation" || filters.generationOptions.length > 0,
  );
  const addressCount = filters.selectedAddresses.length;
  const generationCount = filters.selectedGenerations.length;

  return (
    <div className="sticky top-16 z-40 border-b border-hairline bg-surface/90 backdrop-blur-xl">
      <PageContainer className="py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="relative group w-full sm:w-90 sm:shrink-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle group-focus-within:text-primary transition-colors duration-300" />
            <input
              type="text"
              value={filters.searchTerm}
              onChange={(event) => filters.setSearchTerm(event.target.value)}
              placeholder={t(
                "people.searchPlaceholder",
                "Search by name, location, or story content...",
              )}
              className="w-full h-10 pl-11 pr-4 rounded-full bg-surface-alt border border-hairline text-sm text-ink placeholder-ink-subtle focus:outline-hidden focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-surface transition-all duration-300"
            />
          </div>

          <SortMenu
            t={t}
            options={visibleSortOptions.map((option) => ({
              type: option.type,
              label: t(option.key, option.label),
            }))}
            activeType={filters.filterType}
            sortOrder={filters.sortOrder}
            onSelect={filters.setFilterType}
            onSortOrderChange={filters.setSortOrder}
          />

          <div className="flex items-center gap-2 ml-auto">
            <span className="flex items-center gap-2 text-xs font-medium text-ink-muted whitespace-nowrap">
              {loading && (
                <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              )}
              {filters.hasRuleFilters
                ? t("people.filteredResults", "{{count}} filtered results", {
                    count: filteredCount,
                  })
                : t("people.allResults", "{{count}} total results", { count: filteredCount })}
            </span>

            <GenerationFilter
              t={t}
              options={filters.generationOptions}
              selected={filters.selectedGenerations}
              onToggle={filters.toggleGeneration}
              onSelectRange={filters.selectGenerationRange}
              onClear={filters.clearGenerations}
            />

            <div ref={anchorRef} className="relative">
              <button
                type="button"
                onClick={() => setAddressOpen((open) => !open)}
                aria-expanded={addressOpen}
                aria-haspopup="dialog"
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-colors ${
                  addressCount > 0
                    ? "bg-primary/10 text-primary border border-primary/25"
                    : "text-ink-muted border border-dashed border-hairline-strong hover:text-ink hover:border-ink-subtle"
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{t("people.filterRules", "Filter Rules")}</span>
                {addressCount > 0 && <span className="tabular-nums">{addressCount}</span>}
              </button>

              {addressOpen && (
                <div
                  role="dialog"
                  aria-label={t("people.filterByAddress", "Add creator address...")}
                  className="absolute right-0 top-full mt-2 z-50 w-80 rounded-2xl border border-hairline bg-surface p-3.5 shadow-xl shadow-ink/10"
                >
                  <div className="mb-2 text-[11px] font-semibold tracking-wide text-ink-subtle">
                    {t("people.filterRules", "Filter Rules")}
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1 group">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle group-focus-within:text-primary transition-colors" />
                      <input
                        ref={inputRef}
                        type="text"
                        value={filters.addressInput}
                        onChange={(event) => filters.setAddressInput(event.target.value)}
                        onKeyDown={filters.handleAddressKeyDown}
                        placeholder={t("people.filterByAddress", "Add creator address...")}
                        className="w-full h-10 pl-9 pr-3 text-sm rounded-xl border border-hairline bg-surface-alt text-ink placeholder-ink-subtle focus:outline-hidden focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={filters.addAddress}
                      disabled={!filters.addressInput.trim()}
                      aria-label={t("people.filterByAddress", "Add creator address...")}
                      className="w-10 h-10 shrink-0 rounded-xl bg-ink text-surface hover:bg-primary-hover hover:text-white disabled:opacity-50 disabled:hover:bg-ink disabled:hover:text-surface transition-all flex items-center justify-center active:scale-95"
                    >
                      <Plus className="w-5 h-5" strokeWidth={2.5} />
                    </button>
                  </div>
                  <div className="mt-2 text-[11px] text-ink-subtle">
                    {t("people.filterByAddressHint", "Press Enter or comma to add several addresses")}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-0.5 p-0.5 rounded-[10px] bg-surface-muted">
              <ViewButton
                label={t("people.viewGrid", "Grid view")}
                isActive={view.mode === "grid"}
                onClick={() => view.setMode("grid")}
              >
                <LayoutGrid className="w-4 h-4" />
              </ViewButton>
              <ViewButton
                label={t("people.viewList", "List view")}
                isActive={view.mode === "list"}
                onClick={() => view.setMode("list")}
              >
                <List className="w-4 h-4" />
              </ViewButton>
            </div>
          </div>
        </div>

        {addressCount + generationCount > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {filters.selectedGenerations.map((generation) => (
              <span
                key={`generation-${generation}`}
                className="inline-flex items-center gap-1.5 h-7 pl-3 pr-1.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/25"
              >
                <span>
                  {t("people.generationLabel", "Generation {{number}}", { number: generation })}
                </span>
                <button
                  type="button"
                  onClick={() => filters.toggleGeneration(generation)}
                  aria-label={t("common.close", "Close")}
                  className="p-0.5 rounded-full hover:bg-primary/20 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {filters.selectedAddresses.map((address) => (
              <span
                key={address}
                className="inline-flex items-center gap-1.5 h-7 pl-3 pr-1.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/25"
              >
                <span className="font-mono truncate max-w-[140px]">{address}</span>
                <button
                  type="button"
                  onClick={() => filters.removeAddress(address)}
                  aria-label={t("common.close", "Close")}
                  className="p-0.5 rounded-full hover:bg-primary/20 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={filters.clearFilters}
              className="ml-auto text-xs font-medium text-primary hover:text-primary-hover transition-colors"
            >
              {t("people.clearFilters", "Clear all filters")}
            </button>
          </div>
        )}
      </PageContainer>
    </div>
  );
}

function ViewButton({
  label,
  isActive,
  onClick,
  children,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={isActive}
      className={`inline-flex items-center justify-center w-[30px] h-[30px] rounded-lg transition-colors ${
        isActive ? "bg-surface text-ink shadow-xs" : "text-ink-subtle hover:text-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}
