import { Hash, Plus, Search, User, X } from "lucide-react";
import { Children, type KeyboardEventHandler, type ReactNode } from "react";
import { PageContainer } from "../../../shared/ui";
import type { PeoplePageController } from "../hooks/usePeoplePageController";
import type { PeopleFilterType, PeoplePageT } from "../model/peoplePageModel";
import SortButton from "../ui/SortButton";

interface PeopleFiltersPanelProps {
  t: PeoplePageT;
  filters: PeoplePageController["filters"];
  loading: boolean;
  filteredCount: number;
}

const sortOptions: Array<{ type: PeopleFilterType; key: string; label: string }> = [
  { type: "all", key: "people.filterAll", label: "Token ID" },
  { type: "by_create_time", key: "people.filterByCreateTime", label: "Creation Time" },
  { type: "by_name", key: "people.filterByName", label: "Name" },
  { type: "by_endorsement", key: "people.filterByEndorsement", label: "Endorsements" },
  { type: "by_birth_year", key: "people.filterByBirthYear", label: "Birth Year" },
];

export function PeopleFiltersPanel({
  t,
  filters,
  loading,
  filteredCount,
}: PeopleFiltersPanelProps) {
  return (
    <PageContainer className="mb-12" noPadding>
      <div className="mx-4 md:mx-0 bg-white/50 dark:bg-gray-900/50 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-xl shadow-gray-200/20 dark:shadow-black/20 overflow-hidden transition-all duration-300 hover:shadow-2xl hover:shadow-gray-200/30 dark:hover:shadow-black/30">
        <div className="p-6 border-b border-gray-100 dark:border-gray-800">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-orange-500 transition-colors duration-300" />
            <input
              type="text"
              value={filters.searchTerm}
              onChange={(event) => filters.setSearchTerm(event.target.value)}
              placeholder={t(
                "people.searchPlaceholder",
                "Search by name, location, or story content...",
              )}
              className="w-full pl-11 pr-4 py-2.5 rounded-full bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 focus:bg-white dark:focus:bg-gray-800 transition-all duration-300"
            />
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-6">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                {t("people.filterRules", "Filter Rules")}
              </div>
              {filters.hasVisibleFilters && (
                <button
                  type="button"
                  onClick={filters.clearFilters}
                  className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
                >
                  {t("people.clearFilters", "Clear all filters")}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <TokenFilterInput
                icon={<User className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-orange-500 transition-colors" />}
                value={filters.addressInput}
                onChange={filters.setAddressInput}
                onKeyDown={filters.handleAddressKeyDown}
                placeholder={t("people.filterByAddress", "Add creator address...")}
                onAdd={filters.addAddress}
                addDisabled={!filters.addressInput.trim()}
              >
                {filters.selectedAddresses.map((address) => (
                  <FilterChip
                    key={address}
                    label={address}
                    variant="address"
                    onRemove={() => filters.removeAddress(address)}
                  />
                ))}
              </TokenFilterInput>

              <TokenFilterInput
                icon={<Hash className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-orange-500 transition-colors" />}
                value={filters.tagInput}
                onChange={filters.setTagInput}
                onKeyDown={filters.handleTagKeyDown}
                placeholder={t("people.filterByTag", "Add tag...")}
                onAdd={filters.addTag}
                addDisabled={!filters.tagInput.trim()}
              >
                {filters.selectedTags.map((tag) => (
                  <FilterChip
                    key={tag}
                    label={tag}
                    variant="tag"
                    onRemove={() => filters.removeTag(tag)}
                  />
                ))}
              </TokenFilterInput>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-6 lg:border-l lg:border-gray-100 lg:dark:border-gray-800 lg:pl-8">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
              <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                {t("people.sortRules", "Sort Rules")}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {sortOptions.map((option) => (
                <SortButton
                  key={option.type}
                  label={t(option.key, option.label)}
                  isActive={filters.filterType === option.type}
                  sortOrder={filters.sortOrder}
                  onClick={() => filters.setFilterType(option.type)}
                  onSortOrderChange={filters.setSortOrder}
                  showSortArrows
                />
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-gray-50/50 dark:bg-gray-900/30 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2">
            {loading && (
              <div className="w-4 h-4 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
            )}
            <span>
              {filters.hasRuleFilters
                ? t("people.filteredResults", "{{count}} filtered results", {
                    count: filteredCount,
                  })
                : t("people.allResults", "{{count}} total results", {
                    count: filteredCount,
                  })}
            </span>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

function TokenFilterInput({
  icon,
  value,
  onChange,
  onKeyDown,
  placeholder,
  onAdd,
  addDisabled,
  children,
}: {
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  placeholder: string;
  onAdd: () => void;
  addDisabled: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="relative flex gap-2">
        <div className="relative flex-1 group">
          {icon}
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/10 transition-all"
          />
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="w-10 h-10 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-orange-600 dark:hover:bg-orange-400 disabled:opacity-50 disabled:hover:bg-gray-900 dark:disabled:hover:bg-white transition-all flex items-center justify-center shrink-0 active:scale-95"
        >
          <Plus className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </div>
      {Children.count(children) > 0 ? (
        <div className="flex flex-wrap gap-2">{children}</div>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  variant,
  onRemove,
}: {
  label: string;
  variant: "address" | "tag";
  onRemove: () => void;
}) {
  const variantClass =
    variant === "address"
      ? "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-100 dark:border-orange-900/30"
      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700";
  const removeClass =
    variant === "address"
      ? "hover:bg-orange-200 dark:hover:bg-orange-800/40"
      : "hover:bg-gray-200 dark:hover:bg-gray-700";

  return (
    <div
      className={`inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-xs font-medium border ${variantClass}`}
    >
      <span className="truncate max-w-[100px]">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className={`p-0.5 rounded-full transition-colors ${removeClass}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
