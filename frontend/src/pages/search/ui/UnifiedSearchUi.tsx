import {
  AlertCircle,
  Calculator,
  Check,
  ChevronDown,
  Image as ImageIcon,
  RefreshCw,
  Search as SearchIcon,
  Sliders,
  User,
  Wallet,
  X,
} from "lucide-react";
import React, { type ReactNode } from "react";
import { formatYMD, genderText, shortAddress } from "../../../shared/model";
import { CopyIconButton } from "../../../shared/ui";
import { MAX_SEARCH_PAGE_SIZE, type SearchPageT } from "../model/searchPageModel";
import { detectSearchSubject, type SearchSubject } from "../model/searchSubject";
import { ButtonPrimary, HashInline } from "./SearchPageUi";

type T = SearchPageT;

const CARD = "rounded-3xl border border-hairline bg-surface";

/** Query box: one input, shape-detected, for every facet on the page. */
export function CommandBar({
  t,
  value,
  onChange,
  onSubmit,
  onClear,
  subject,
  canSubmit,
  recent,
  onPickRecent,
  calculatorOpen,
  onToggleCalculator,
  children,
}: {
  t: T;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  subject: SearchSubject;
  canSubmit: boolean;
  recent: string[];
  onPickRecent: (entry: string) => void;
  calculatorOpen: boolean;
  onToggleCalculator: () => void;
  /** Calculator body, rendered inside this card so it feeds the input above. */
  children?: ReactNode;
}) {
  const invalid = subject.kind === "invalid";

  return (
    <div className={`${CARD} p-5 sm:p-6`}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div
          className={`flex items-center gap-3 rounded-2xl border bg-surface-alt pl-4 pr-2 h-14 transition-colors ${
            invalid
              ? "border-danger ring-3 ring-danger/10"
              : "border-hairline focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/10"
          }`}
        >
          <SearchIcon size={20} className="shrink-0 text-ink-subtle" aria-hidden="true" />
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t(
              "search.unified.placeholder",
              "0x1234...abcd (64 hex), a token ID, or a wallet address",
            )}
            aria-label={t("search.unified.inputLabel", "Search the chain")}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-sm text-ink placeholder:font-sans placeholder:text-ink-subtle focus:ring-0 focus:outline-hidden"
          />
          {value ? (
            <button
              type="button"
              onClick={onClear}
              aria-label={t("search.unified.clear", "Clear")}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
          <DetectionChip t={t} subject={subject} />
          <ButtonPrimary type="submit" disabled={!canSubmit} className="shrink-0 py-2!">
            {t("search.query")}
          </ButtonPrimary>
        </div>
      </form>

      <DetectionHint t={t} subject={subject} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {recent.length > 0 && (
            <>
              <span className="text-xs text-ink-subtle">
                {t("search.unified.recent", "Recent")}
              </span>
              {recent.map((entry) => (
                <RecentChip key={entry} entry={entry} onPick={onPickRecent} />
              ))}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleCalculator}
          aria-expanded={calculatorOpen}
          className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-primary-hover"
        >
          <Calculator size={15} aria-hidden="true" />
          {t("search.hashCalculator.title")}
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={`transition-transform duration-300 ${calculatorOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {calculatorOpen ? (
        <div className="mt-5 border-t border-hairline pt-5">
          <p className="mb-4 text-sm leading-relaxed text-ink-muted">
            {t(
              "search.unified.calculatorDesc",
              "No hash yet? Compute one from a name, birth date and passphrase — it drops straight into the query box above.",
            )}
          </p>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Abbreviated, a person hash and an account address are both just "0x…", so a
 * recent entry carries the icon of what it actually is.
 */
function RecentChip({ entry, onPick }: { entry: string; onPick: (entry: string) => void }) {
  const subject = detectSearchSubject(entry);
  const { icon, label } =
    subject.kind === "address"
      ? { icon: <Wallet size={11} aria-hidden="true" />, label: shortAddress(entry, 8, 6) }
      : subject.kind === "tokenId"
        ? { icon: <ImageIcon size={11} aria-hidden="true" />, label: `#${subject.tokenId}` }
        : {
            icon: <User size={11} aria-hidden="true" />,
            label: `${entry.slice(0, 10)}…${entry.slice(-8)}`,
          };

  return (
    <button
      type="button"
      onClick={() => onPick(entry)}
      title={entry}
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 font-mono text-xs text-ink-muted transition-colors hover:bg-hairline hover:text-ink"
    >
      <span className="text-ink-subtle">{icon}</span>
      {label}
    </button>
  );
}

function DetectionChip({ t, subject }: { t: T; subject: SearchSubject }) {
  if (subject.kind === "personHash") {
    return (
      <Chip tone="success">
        <Check size={13} strokeWidth={2.5} aria-hidden="true" />
        {t("search.unified.detected.personHash", "Person hash")}
      </Chip>
    );
  }
  if (subject.kind === "tokenId") {
    return (
      <Chip tone="success">
        <Check size={13} strokeWidth={2.5} aria-hidden="true" />
        {t("search.unified.detected.tokenId", "Token ID")}
      </Chip>
    );
  }
  if (subject.kind === "address") {
    return (
      <Chip tone="success">
        <Check size={13} strokeWidth={2.5} aria-hidden="true" />
        {t("search.unified.detected.address", "Wallet address")}
      </Chip>
    );
  }
  return null;
}

function Chip({ tone, children }: { tone: "success" | "danger"; children: ReactNode }) {
  const toneClass =
    tone === "success" ? "bg-success/10 text-success" : "bg-danger/10 text-danger";
  return (
    <span
      className={`hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex ${toneClass}`}
    >
      {children}
    </span>
  );
}

function DetectionHint({ t, subject }: { t: T; subject: SearchSubject }) {
  if (subject.kind === "invalid" && subject.reason === "hexLength") {
    return (
      <p className="mt-2.5 ml-1 flex items-center gap-1.5 text-xs font-medium text-danger">
        <AlertCircle size={13} aria-hidden="true" />
        {t("search.validation.hashInvalid")}
        <span className="font-normal text-ink-subtle">
          {t("search.unified.hexLength", "currently {{count}} digits", {
            count: subject.hexLength,
          })}
        </span>
      </p>
    );
  }
  if (subject.kind === "invalid") {
    return (
      <p className="mt-2.5 ml-1 flex items-center gap-1.5 text-xs font-medium text-danger">
        <AlertCircle size={13} aria-hidden="true" />
        {t(
          "search.unified.unrecognized",
          "Enter a 64-hex person hash, a numeric token ID, or a 40-hex wallet address.",
        )}
      </p>
    );
  }
  return null;
}

/**
 * Identity behind a minted NFT. Minting publishes PersonCoreInfo on-chain, so a
 * token-id search can name the person instead of echoing the number back.
 */
export function NftIdentityCard({
  t,
  tokenId,
  core,
  personHash,
  versionIndex,
  onCopy,
  onSearchPerson,
  action,
}: {
  t: T;
  tokenId: number;
  core?: {
    fullName?: string;
    gender?: number;
    birthYear?: number;
    birthMonth?: number;
    birthDay?: number;
    isBirthBC?: boolean;
    birthPlace?: string;
    deathYear?: number;
    deathMonth?: number;
    deathDay?: number;
    isDeathBC?: boolean;
    deathPlace?: string;
    nftPublicStory?: string;
  };
  personHash?: string;
  versionIndex?: number;
  onCopy: (text: string) => void;
  onSearchPerson?: (personHash: string) => void;
  action?: ReactNode;
}) {
  const birth = [
    formatYMD(core?.birthYear, core?.birthMonth, core?.birthDay, core?.isBirthBC),
    core?.birthPlace,
  ]
    .filter(Boolean)
    .join(" · ");
  const death = [
    formatYMD(core?.deathYear, core?.deathMonth, core?.deathDay, core?.isDeathBC),
    core?.deathPlace,
  ]
    .filter(Boolean)
    .join(" · ");
  const gender = genderText(core?.gender, t as any);

  const facts = [
    { label: t("familyTree.nodeDetail.gender"), value: gender },
    { label: t("familyTree.nodeDetail.birth"), value: birth },
    { label: t("familyTree.nodeDetail.death"), value: death },
  ].filter((fact) => Boolean(fact.value));

  return (
    <div className={`${CARD} px-5 py-5 sm:px-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info">
              <ImageIcon size={12} aria-hidden="true" />
              {t("familyTree.nodeDetail.tokenId")} #{tokenId}
            </span>
            {personHash ? (
              <span className="flex min-w-0 items-center gap-1 rounded-md bg-surface-muted px-2 py-1">
                <User size={12} className="shrink-0 text-ink-subtle" aria-hidden="true" />
                {onSearchPerson ? (
                  <button
                    type="button"
                    onClick={() => onSearchPerson(personHash)}
                    title={t("search.unified.searchThis", "Search this")}
                    className="flex min-w-0 cursor-pointer items-center rounded-xs transition-colors hover:text-primary"
                  >
                    <HashInline value={personHash} className="min-w-0 font-mono text-xs text-ink" />
                  </button>
                ) : (
                  <HashInline value={personHash} className="min-w-0 font-mono text-xs text-ink" />
                )}
                <CopyIconButton
                  onClick={() => onCopy(personHash)}
                  label={t("search.copy", "Copy") as string}
                  size="xs"
                />
              </span>
            ) : null}
            {versionIndex ? (
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                v{versionIndex}
              </span>
            ) : null}
          </div>
          <h2 className="mb-2 text-2xl text-ink">
            {core?.fullName || (
              <span className="text-ink-subtle">{t("search.versionsQuery.unknown")}</span>
            )}
          </h2>
          {facts.length > 0 ? (
            <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
              {facts.map((fact) => (
                <div key={fact.label} className="flex items-center gap-1.5">
                  <dt className="text-ink-subtle">{fact.label}</dt>
                  <dd className="text-ink-muted">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {action}
      </div>

      {core?.nftPublicStory?.trim() ? (
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="mb-1.5 text-xs font-medium text-ink-subtle">
            {t("familyTree.nodeDetail.nftPublicStory", "Public NFT Summary")}
          </div>
          <p className="max-h-44 overflow-y-auto text-sm leading-relaxed whitespace-pre-line text-ink-muted">
            {core.nftPublicStory}
          </p>
        </div>
      ) : null}

    </div>
  );
}

export function FacetTabs({
  tabs,
  activeKey,
  onSelect,
}: {
  tabs: { key: string; label: string; count?: number }[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex items-center gap-1 overflow-x-auto border-b border-hairline"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.key)}
            className={`inline-flex shrink-0 items-center gap-2 px-4 py-3 text-sm whitespace-nowrap transition-colors ${
              active
                ? "font-semibold text-ink shadow-[inset_0_-2px_0_0_var(--df-primary)]"
                : "font-medium text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${
                  active ? "bg-primary/15 text-primary" : "bg-surface-muted text-ink-muted"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Shows — and lets you change — the scope a facet inherited from the subject. */
export function ScopeBar({
  label,
  children,
  trailing,
}: {
  label: string;
  children?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-surface-alt px-4 py-3 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-ink-muted">
        <Sliders size={13} className="text-ink-subtle" aria-hidden="true" />
        <span>{label}</span>
        {children}
      </div>
      {trailing ? <div className="text-xs font-medium text-ink-muted">{trailing}</div> : null}
    </div>
  );
}

/** Read-only: which NFT the selected version resolves to. */
export function ResolvedNftBadge({
  t,
  tokenId,
}: {
  t: T;
  tokenId: number | undefined;
}) {
  if (tokenId === undefined) {
    return (
      <span className="text-xs text-ink-subtle">
        {t("search.unified.scope.notMinted", "this version has no NFT")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-info/10 px-2 py-1 text-xs font-semibold text-info">
      <ImageIcon size={12} aria-hidden="true" />#{tokenId}
    </span>
  );
}

export function VersionScopeSelect({
  t,
  value,
  options,
  min,
  onChange,
}: {
  t: T;
  value: number | undefined;
  options: number[];
  min: number;
  onChange: (next: number | undefined) => void;
}) {
  if (options.length > 0) {
    return (
      <label className="inline-flex items-center gap-1.5">
        <span className="sr-only">{t("search.trustedEndorsersQuery.versionIndex")}</span>
        <span className="relative inline-flex items-center">
          <select
            value={value ?? ""}
            onChange={(event) =>
              onChange(event.target.value === "" ? undefined : Number(event.target.value))
            }
            className="appearance-none rounded-md border border-hairline bg-surface bg-none py-1 pl-2 pr-7 text-xs font-medium text-ink focus:border-primary focus:ring-0 focus:outline-hidden"
          >
            <option value="">{t("search.unified.scope.pickVersion", "Pick a version")}</option>
            {options
              .filter((option) => option >= min)
              .map((option) => (
                <option key={option} value={option}>
                  v{option}
                </option>
              ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-2 text-ink-subtle"
            aria-hidden="true"
          />
        </span>
      </label>
    );
  }

  return (
    <input
      type="number"
      min={min}
      value={value ?? ""}
      onChange={(event) =>
        onChange(event.target.value === "" ? undefined : Number(event.target.value))
      }
      aria-label={t("search.trustedEndorsersQuery.versionIndex")}
      title={t("search.unified.scope.versionInput", "Version index")}
      className="w-20 rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink focus:border-primary focus:ring-0 focus:outline-hidden"
    />
  );
}

/**
 * Token scope for a PERSON subject: choose among the NFTs minted from that
 * person's own versions. A free-form token box was wrong here — it let the
 * scope drift to an unrelated person while the header still named this one.
 * Searching an arbitrary token is what the query box is for.
 */
export function ResultShell({ children }: { children: ReactNode }) {
  return <div className={`${CARD} overflow-hidden`}>{children}</div>;
}

export function ResultMeta({
  t,
  total,
  totalLabel,
  pageSize,
  onPageSizeChange,
}: {
  t: T;
  total: number;
  totalLabel: string;
  pageSize: number;
  onPageSizeChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <span className="text-sm font-medium text-ink-muted">
        {totalLabel}: {total}
      </span>
      <label className="inline-flex items-center gap-2">
        <span className="text-xs text-ink-subtle">{t("search.nameQuery.pageSize")}</span>
        <span className="relative inline-flex items-center">
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="appearance-none rounded-xl border border-hairline bg-surface-alt bg-none py-1.5 pl-3 pr-8 text-xs text-ink focus:border-primary focus:ring-0 focus:outline-hidden"
          >
            {[20, 50, MAX_SEARCH_PAGE_SIZE].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            className="pointer-events-none absolute right-2.5 text-ink-subtle"
            aria-hidden="true"
          />
        </span>
      </label>
    </div>
  );
}

/** Skeleton rows sized like real results, so the list does not jump on load. */
export function LoadingRows({ t, rows = 3 }: { t: T; rows?: number }) {
  return (
    <div className="divide-y divide-hairline" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("search.loading")}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex flex-col gap-2 p-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-9 rounded-full bg-surface-muted" />
            <div className="h-3.5 w-56 rounded bg-surface-muted" />
            <div className="h-3 w-24 rounded bg-surface-alt" />
          </div>
          <div className="h-3 w-2/3 rounded bg-surface-alt" />
          <div className="h-3 w-1/2 rounded bg-surface-alt" />
        </div>
      ))}
    </div>
  );
}

export function EmptyResult({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3.5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-ink-subtle">
        {icon}
      </span>
      <div className="mb-1.5 text-sm font-semibold text-ink">{title}</div>
      {description ? (
        <p className="mb-4 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function ErrorResult({
  t,
  message,
  onRetry,
}: {
  t: T;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="p-4 sm:p-5">
      <div className="flex items-start gap-3 rounded-2xl border border-danger/20 bg-danger/5 p-4">
        <AlertCircle size={18} className="mt-px shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0">
          <div className="mb-1 text-sm font-semibold text-danger">{t("search.queryFailed")}</div>
          <p className="mb-3 text-sm leading-relaxed break-words text-ink-muted">{message}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
            >
              <RefreshCw size={13} aria-hidden="true" />
              {t("search.unified.retry", "Retry")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Pagination({
  t,
  offset,
  loading,
  hasMore,
  onPrev,
  onNext,
}: {
  t: T;
  offset: number;
  loading: boolean;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-5 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-ink-muted";
  return (
    <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-3 sm:px-5">
      <span className="text-xs text-ink-subtle">
        {t("search.offset")}: {offset}
      </span>
      <div className="flex gap-2">
        <button type="button" onClick={onPrev} disabled={loading || offset === 0} className={base}>
          {t("search.prev")}
        </button>
        <button type="button" onClick={onNext} disabled={loading || !hasMore} className={base}>
          {t("search.next")}
        </button>
      </div>
    </div>
  );
}

/** What the query box accepts — replaces the old wall of collapsed sections. */
export function EntryCards({ t }: { t: T }) {
  const entries = [
    {
      key: "personHash",
      title: t("search.unified.detected.personHash", "Person hash"),
      description: t(
        "search.unified.entry.personHashDesc",
        "Opens versions, endorsement sources, endorsement stats and children.",
      ),
      tone: "bg-primary/10 text-primary",
    },
    {
      key: "tokenId",
      title: t("search.unified.detected.tokenId", "Token ID"),
      description: t(
        "search.unified.entry.tokenIdDesc",
        "Opens that NFT's story chunks and URI history.",
      ),
      tone: "bg-info/10 text-info",
    },
    {
      key: "address",
      title: t("search.unified.detected.address", "Wallet address"),
      description: t(
        "search.unified.entry.addressDesc",
        "Opens versions that account created, endorsements it made, and NFTs it holds.",
      ),
      tone: "bg-surface-muted text-ink-muted",
    },
  ];

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <div key={entry.key} className={`${CARD} p-5`}>
          <span
            className={`mb-3.5 inline-flex h-10 w-10 items-center justify-center rounded-xl ${entry.tone}`}
          >
            {entry.key === "personHash" ? (
              <User size={20} aria-hidden="true" />
            ) : entry.key === "tokenId" ? (
              <ImageIcon size={20} aria-hidden="true" />
            ) : (
              <Wallet size={20} aria-hidden="true" />
            )}
          </span>
          <h3 className="mb-1.5 text-lg text-ink">{entry.title}</h3>
          <p className="text-sm leading-relaxed text-ink-muted">{entry.description}</p>
        </div>
      ))}
    </div>
  );
}

/** Row action that switches facet and carries the scope with it. */
export function RowAction({
  onClick,
  icon,
  children,
  tone = "neutral",
}: {
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  tone?: "neutral" | "info";
}) {
  const toneClass =
    tone === "info"
      ? "bg-info/10 text-info font-semibold hover:opacity-80"
      : "border border-hairline text-ink-muted hover:text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${toneClass}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function ScopePrompt({ t, message }: { t: T; message: string }) {
  return (
    <EmptyResult
      icon={<Sliders size={22} aria-hidden="true" />}
      title={t("search.unified.scope.needScope", "Pick a scope")}
      description={message}
    />
  );
}
