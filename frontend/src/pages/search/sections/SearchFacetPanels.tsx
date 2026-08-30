import {
  AlertTriangle,
  BookOpen,
  FileText,
  Image as ImageIcon,
  Link2,
  Star,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatUnixSeconds, formatYMD, genderText } from "../../../shared/model";
import { CopyIconButton } from "../../../shared/ui";
import type { UnifiedSearch } from "../hooks/useUnifiedSearch";
import type { SearchFacetKey } from "../model/searchSubject";
import { EmptyResult, RowAction } from "../ui/UnifiedSearchUi";
import { HashInline } from "../ui/SearchPageUi";

const ROW = "p-4 transition-colors hover:bg-surface-alt";
const CHIP = "flex items-center gap-1 rounded-md bg-surface-muted px-2 py-0.5 min-w-0 w-fit max-w-full";
const LABEL = "text-xs text-ink-muted whitespace-nowrap shrink-0 text-right";

export function FacetPanel({ unified }: { unified: UnifiedSearch }) {
  switch (unified.activeFacet) {
    case "versions":
      return <VersionsPanel unified={unified} />;
    case "trustedEndorsers":
      return <TrustedEndorsersPanel unified={unified} />;
    case "endorsement":
      return <EndorsementPanel unified={unified} />;
    case "children":
      return <ChildrenPanel unified={unified} />;
    case "storyChunks":
      return <StoryChunksPanel unified={unified} />;
    case "uri":
      return <UriPanel unified={unified} />;
    case "personNfts":
      return <PersonNftsPanel unified={unified} />;
    case "accountVersions":
      return <AccountVersionsPanel unified={unified} />;
    case "accountEndorsements":
      return <AccountEndorsementsPanel unified={unified} />;
    case "accountNfts":
      return <AccountNftsPanel unified={unified} />;
    default:
      return null;
  }
}

/**
 * Any value the query box can resolve (person hash, address, token id) is a
 * link back into search, so a result never has to be copy-pasted to be followed.
 */
function SubjectValue({
  unified,
  value,
  className = "min-w-0 font-mono text-xs text-ink",
}: {
  unified: UnifiedSearch;
  value: string;
  className?: string;
}) {
  // Accounts are 40 hex digits and hashes 64; the app abbreviates them
  // differently (shortAddress 8/6 vs formatHashMiddle 10/8), so match that.
  const isAddress = /^0x[0-9a-fA-F]{40}$/.test(value);
  return (
    <button
      type="button"
      onClick={() => unified.searchFor(value)}
      title={unified.t("search.unified.searchThis", "Search this")}
      className="flex min-w-0 cursor-pointer items-center rounded-xs text-left transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    >
      <HashInline
        value={value}
        className={className}
        prefix={isAddress ? 8 : 10}
        suffix={isAddress ? 6 : 8}
      />
    </button>
  );
}

/** Every minted token has a canonical page; a result row should offer it. */
function EncyclopediaLink({ unified, tokenId }: { unified: UnifiedSearch; tokenId: number }) {
  return (
    <Link
      to={`/person/${tokenId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
    >
      <BookOpen size={12} aria-hidden="true" />
      {unified.t("familyTree.nodeDetail.encyclopedia", "Encyclopedia")}
    </Link>
  );
}

function NoRows({ unified, icon, description }: { unified: UnifiedSearch; icon: React.ReactNode; description?: string }) {
  return (
    <EmptyResult icon={icon} title={unified.t("search.noData")} description={description} />
  );
}

function VersionsPanel({ unified }: { unified: UnifiedSearch }) {
  const { t, search } = unified;
  const rows = search.versions.state.data ?? [];

  if (rows.length === 0) {
    return <NoRows unified={unified} icon={<FileText size={22} aria-hidden="true" />} />;
  }

  return (
    <div className="divide-y divide-hairline">
      {rows.map((version: any, index: number) => {
        const versionIndex = Number(version.versionIndex);
        const stats = unified.versionStats[versionIndex];
        const minted = unified.tokenOptions.find((option) => option.versionIndex === versionIndex);
        return (
          <div key={index} className={ROW}>
            <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                v{versionIndex}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2 text-ink-muted">
                <span className="shrink-0 whitespace-nowrap">
                  {t("search.versionsQuery.creator")}:
                </span>
                <div className={CHIP}>
                  <SubjectValue unified={unified} value={String(version.addedBy || "")} />
                  <CopyIconButton
                    onClick={() => unified.onCopy(String(version.addedBy || ""))}
                    label={t("search.copy", "Copy") as string}
                    size="xs"
                  />
                </div>
              </div>
              <span className="text-xs text-ink-subtle">
                {version.timestamp
                  ? formatUnixSeconds(version.timestamp)
                  : t("search.versionsQuery.unknown")}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {stats && stats.endorsementCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary">
                    <Star size={12} aria-hidden="true" />
                    {stats.endorsementCount}
                  </span>
                ) : null}
                {minted ? (
                  <RowAction
                    tone="info"
                    onClick={() => unified.searchFor(String(minted.tokenId))}
                    icon={<ImageIcon size={12} aria-hidden="true" />}
                  >
                    NFT #{minted.tokenId}
                  </RowAction>
                ) : null}
                {minted ? <EncyclopediaLink unified={unified} tokenId={minted.tokenId} /> : null}
                {versionIndex >= 1 ? (
                  <RowAction
                    onClick={() => unified.focusVersion(versionIndex, "trustedEndorsers")}
                    icon={<Star size={12} aria-hidden="true" />}
                  >
                    {t(FACET_LABELS.trustedEndorsers.key, FACET_LABELS.trustedEndorsers.fallback)}
                  </RowAction>
                ) : null}
                <RowAction
                  onClick={() => unified.focusVersion(versionIndex, "children")}
                  icon={<Users size={12} aria-hidden="true" />}
                >
                  {t(FACET_LABELS.children.key, FACET_LABELS.children.fallback)}
                </RowAction>
              </div>
            </div>

            <div className="flex flex-col gap-1 text-sm">
              {version.versionCommitment !== undefined && (
                <div className="grid min-h-[28px] grid-cols-[80px_1fr] items-center gap-2">
                  <span className={LABEL}>
                    {t("search.versionsQuery.versionCommitment", "Commitment")}
                  </span>
                  <div className={CHIP}>
                    <HashInline
                      value={String(version.versionCommitment)}
                      className="min-w-0 font-mono text-xs text-ink"
                    />
                    <CopyIconButton
                      onClick={() => unified.onCopy(String(version.versionCommitment))}
                      label={t("search.copy", "Copy") as string}
                      size="xs"
                    />
                  </div>
                </div>
              )}
              <ParentRow
                unified={unified}
                label={t("search.versionsQuery.fatherHash")}
                hash={version.fatherHash}
                versionIndex={Number(version.fatherVersionIndex)}
              />
              <ParentRow
                unified={unified}
                label={t("search.versionsQuery.motherHash")}
                hash={version.motherHash}
                versionIndex={Number(version.motherVersionIndex)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ZERO_HASH = `0x${"0".repeat(64)}`;

function ParentRow({
  unified,
  label,
  hash,
  versionIndex,
}: {
  unified: UnifiedSearch;
  label: string;
  hash: string | undefined;
  versionIndex: number;
}) {
  const { t } = unified;
  const value = String(hash ?? "");
  const known = value.length > 0 && value !== ZERO_HASH;

  return (
    <div className="grid min-h-[28px] grid-cols-[80px_1fr] items-center gap-2">
      <span className={LABEL}>{label}</span>
      {known ? (
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <div className={CHIP}>
            <SubjectValue unified={unified} value={value} />
            <CopyIconButton
              onClick={() => unified.onCopy(value)}
              label={t("search.copy", "Copy") as string}
              size="xs"
            />
          </div>
          <span className="shrink-0 text-xs whitespace-nowrap text-ink-subtle">
            (v{versionIndex})
          </span>
        </div>
      ) : (
        <span className="text-xs text-ink-subtle">{t("search.versionsQuery.unknown")}</span>
      )}
    </div>
  );
}

function TrustedEndorsersPanel({ unified }: { unified: UnifiedSearch }) {
  const { t, search } = unified;
  const accounts = search.trustedEndorsers.state.data.accounts ?? [];

  if (accounts.length === 0) {
    return (
      <NoRows
        unified={unified}
        icon={<Star size={22} aria-hidden="true" />}
        description={t(
          "search.unified.empty.trustedEndorsers",
          "No endorsement sources recorded for this version.",
        )}
      />
    );
  }

  return (
    <div className="divide-y divide-hairline">
      {accounts.map((account, index) => (
        <div key={index} className={`${ROW} flex flex-wrap items-center gap-4`}>
          <span className="w-20 shrink-0 text-sm text-ink-muted">
            {t("search.trustedEndorsersQuery.account")}:
          </span>
          <div className={CHIP}>
            <SubjectValue unified={unified} value={account} />
            <CopyIconButton
              onClick={() => unified.onCopy(account)}
              label={t("search.copy", "Copy") as string}
              size="xs"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EndorsementPanel({ unified }: { unified: UnifiedSearch }) {
  const { t, search } = unified;
  const stats = search.endorsement.state.data;
  const rows = stats.versionIndices ?? [];

  if (rows.length === 0) {
    return <NoRows unified={unified} icon={<Star size={22} aria-hidden="true" />} />;
  }

  return (
    <div className="divide-y divide-hairline">
      {rows.map((versionIndex, index) => {
        const tokenId = Number(stats.tokenIds?.[index] ?? 0);
        return (
          <div key={index} className={`${ROW} flex flex-wrap items-center gap-x-8 gap-y-2 text-sm`}>
            <div className="flex items-center gap-2">
              <span className="text-ink-muted">{t("search.endorsementQuery.version")}:</span>
              <span className="rounded-md bg-surface-muted px-2 py-0.5 font-medium text-ink">
                v{versionIndex}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-muted">
                {t("search.endorsementQuery.endorsementCount")}:
              </span>
              <span className="font-bold text-primary">{stats.endorsementCounts?.[index]}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-muted">{t("search.endorsementQuery.tokenId")}:</span>
              {tokenId > 0 ? (
                <button
                  type="button"
                  onClick={() => unified.searchFor(String(tokenId))}
                  title={t("search.unified.searchThis", "Search this")}
                  className="cursor-pointer font-mono text-ink transition-colors hover:text-primary"
                >
                  #{tokenId}
                </button>
              ) : (
                <span className="font-mono text-ink-subtle">#{stats.tokenIds?.[index]}</span>
              )}
            </div>
            {tokenId > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <RowAction
                  onClick={() => unified.focusToken(tokenId, "storyChunks")}
                  icon={<FileText size={12} aria-hidden="true" />}
                >
                  {t(FACET_LABELS.storyChunks.key, FACET_LABELS.storyChunks.fallback)}
                </RowAction>
                <RowAction
                  onClick={() => unified.focusToken(tokenId, "uri")}
                  icon={<Link2 size={12} aria-hidden="true" />}
                >
                  {t(FACET_LABELS.uri.key, FACET_LABELS.uri.fallback)}
                </RowAction>
                <EncyclopediaLink unified={unified} tokenId={tokenId} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ChildrenPanel({ unified }: { unified: UnifiedSearch }) {
  const { t, search } = unified;
  const { childHashes = [], childVersions = [] } = search.children.state.data;

  if (childHashes.length === 0) {
    return (
      <NoRows
        unified={unified}
        icon={<Users size={22} aria-hidden="true" />}
        description={t(
          "search.unified.empty.children",
          "No children recorded under this version. Other versions may record different family links.",
        )}
      />
    );
  }

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2">
      {childHashes.map((childHash, index) => {
        const identity =
          unified.rowIdentities[
            unified.identityKey(childHash, Number(childVersions[index] ?? 0))
          ];
        return (
          // Two distinct targets: the person, and the NFT minted from them.
          // A single card-wide button swallowed the token badge's click.
          <div
            key={index}
            className="flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface-alt px-4 py-3 transition-colors hover:border-primary/40"
          >
            <button
              type="button"
              onClick={() => unified.searchFor(childHash)}
              title={t("search.unified.searchThis", "Search this")}
              className="min-w-0 flex-1 cursor-pointer text-left transition-colors hover:text-primary"
            >
              {identity?.fullName ? (
                <span className="mb-1 block truncate text-sm font-semibold text-ink">
                  {identity.fullName}
                </span>
              ) : (
                <span className="mb-1 block text-xs text-ink-subtle">
                  {t("search.childrenQuery.childHash")}
                </span>
              )}
              <HashInline value={childHash} className="block font-mono text-xs text-ink-muted" />
            </button>
            <span className="flex shrink-0 items-center gap-2">
              {identity ? (
                <button
                  type="button"
                  onClick={() => unified.searchFor(String(identity.tokenId))}
                  title={t("search.unified.searchThis", "Search this")}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-xs font-semibold text-info transition-opacity hover:opacity-80"
                >
                  <ImageIcon size={11} aria-hidden="true" />#{identity.tokenId}
                </button>
              ) : null}
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                v{childVersions[index]}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StoryChunksPanel({ unified }: { unified: UnifiedSearch }) {
  const { t, search } = unified;
  const chunks = search.storyChunks.state.data ?? [];

  if (chunks.length === 0) {
    return <NoRows unified={unified} icon={<FileText size={22} aria-hidden="true" />} />;
  }

  return (
    <div className="divide-y divide-hairline">
      {chunks.map((chunk: any, index: number) => (
        <div key={index} className={ROW}>
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-ink-muted">
              #{Number(chunk.chunkIndex)}
            </span>
            <span className="text-xs text-ink-subtle">
              {chunk.timestamp
                ? formatUnixSeconds(chunk.timestamp)
                : t("search.versionsQuery.unknown")}
            </span>
            <div className="ml-auto flex items-center gap-2 text-ink-muted">
              <span className="text-xs">{t("search.storyChunksQuery.chunkType")}:</span>
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                {search.chunkTypes.getChunkTypeLabel(Number(chunk.chunkType ?? 0))}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="max-h-32 overflow-y-auto rounded-xl bg-surface-alt p-3 text-sm leading-relaxed text-ink-muted">
              {chunk.content || <span className="text-ink-subtle italic">{t("search.noData")}</span>}
            </div>
            <div className="flex flex-col gap-2 text-xs text-ink-muted">
              <DataRow
                unified={unified}
                label={t("search.storyChunksQuery.chunkHash")}
                value={String(chunk.chunkHash || "")}
              />
              {chunk.editor ? (
                <DataRow
                  unified={unified}
                  label={t("search.storyChunksQuery.editor")}
                  value={String(chunk.editor)}
                  searchable
                />
              ) : null}
              {chunk.attachmentCID && chunk.attachmentCID.length > 0 ? (
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <span className={LABEL}>{t("search.storyChunksQuery.attachmentCID")}</span>
                  <div className={CHIP}>
                    <HashInline value={String(chunk.attachmentCID)} className="min-w-0 flex-1 font-mono" />
                    <CopyIconButton
                      onClick={() => unified.onCopy(String(chunk.attachmentCID))}
                      label={t("search.copy", "Copy") as string}
                      size="xs"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DataRow({
  unified,
  label,
  value,
  searchable = false,
}: {
  unified: UnifiedSearch;
  label: string;
  value: string;
  searchable?: boolean;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
      <span className={LABEL}>{label}</span>
      <div className={CHIP}>
        {searchable ? (
          <SubjectValue unified={unified} value={value} className="min-w-0 flex-1 font-mono" />
        ) : (
          <HashInline value={value} className="min-w-0 flex-1 font-mono" />
        )}
        <CopyIconButton
          onClick={() => unified.onCopy(value)}
          label={unified.t("search.copy", "Copy") as string}
          size="xs"
        />
      </div>
    </div>
  );
}

function UriPanel({ unified }: { unified: UnifiedSearch }) {
  const { t, search } = unified;
  const uris = search.uri.state.data ?? [];

  if (uris.length === 0) {
    return <NoRows unified={unified} icon={<Link2 size={22} aria-hidden="true" />} />;
  }

  return (
    <div className="divide-y divide-hairline">
      {uris.map((uri, index) => (
        <div key={index} className={ROW}>
          <div className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2">
            <span className="flex-1 truncate font-mono text-sm text-ink-muted" title={uri}>
              {uri}
            </span>
            <CopyIconButton
              onClick={() => unified.onCopy(uri)}
              label={t("search.copy", "Copy") as string}
              size="sm"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** NFTs minted from this person's versions — the mint reveals the identity. */
function PersonNftsPanel({ unified }: { unified: UnifiedSearch }) {
  const { t } = unified;
  const rows = unified.personNfts.state.data;

  if (rows.length === 0) {
    return (
      <NoRows
        unified={unified}
        icon={<ImageIcon size={22} aria-hidden="true" />}
        description={t(
          "search.unified.empty.personNfts",
          "No version of this person has been minted yet. Minting requires a prior endorsement.",
        )}
      />
    );
  }

  return (
    <div className="divide-y divide-hairline">
      {rows.map((row) => {
        const core = row.core;
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
        const facts = [
          genderText(core?.gender, t as any),
          birth ? `${t("familyTree.nodeDetail.birth")} ${birth}` : "",
          death ? `${t("familyTree.nodeDetail.death")} ${death}` : "",
        ].filter(Boolean);

        return (
          <div key={row.tokenId} className={`${ROW} flex flex-col gap-2.5`}>
            <div className="flex flex-wrap items-center gap-3">
              <RowAction
                tone="info"
                onClick={() => unified.searchFor(String(row.tokenId))}
                icon={<ImageIcon size={12} aria-hidden="true" />}
              >
                #{row.tokenId}
              </RowAction>
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                v{row.versionIndex}
              </span>
              <span className="truncate text-sm font-semibold text-ink">
                {core?.fullName || (
                  <span className="font-normal text-ink-subtle">
                    {t("search.versionsQuery.unknown")}
                  </span>
                )}
              </span>
              <div className="flex-1" />
              {row.endorsementCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
                  <Star size={12} aria-hidden="true" />
                  {row.endorsementCount}
                </span>
              ) : null}
              <div className="flex flex-wrap items-center gap-1.5">
                <RowAction
                  onClick={() => unified.focusToken(row.tokenId, "storyChunks")}
                  icon={<FileText size={12} aria-hidden="true" />}
                >
                  {t(FACET_LABELS.storyChunks.key, FACET_LABELS.storyChunks.fallback)}
                </RowAction>
                <RowAction
                  onClick={() => unified.focusToken(row.tokenId, "uri")}
                  icon={<Link2 size={12} aria-hidden="true" />}
                >
                  {t(FACET_LABELS.uri.key, FACET_LABELS.uri.fallback)}
                </RowAction>
                <EncyclopediaLink unified={unified} tokenId={row.tokenId} />
              </div>
            </div>

            {facts.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                {facts.map((fact, index) => (
                  <span key={fact} className="flex items-center gap-2">
                    {index > 0 ? <span className="text-ink-subtle">·</span> : null}
                    {fact}
                  </span>
                ))}
              </div>
            ) : null}

            {core?.nftPublicStory?.trim() ? (
              <p className="line-clamp-2 rounded-lg bg-surface-alt px-3 py-2 text-xs leading-relaxed text-ink-muted">
                {core.nftPublicStory}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The creator facet reads logs, so it can legitimately be incomplete. */
function TruncatedNotice({ unified }: { unified: UnifiedSearch }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-hairline bg-warning/5 px-4 py-3">
      <AlertTriangle size={15} className="mt-px shrink-0 text-warning" aria-hidden="true" />
      <p className="text-xs leading-relaxed text-ink-muted">
        {unified.t(
          "search.unified.empty.truncated",
          "Only recent blocks were scanned, so older records may be missing. Set VITE_DF_EVENT_FROM_BLOCK to the deployment block for a complete scan.",
        )}
      </p>
    </div>
  );
}

function MintedName({
  unified,
  personHash,
  versionIndex,
}: {
  unified: UnifiedSearch;
  personHash: string;
  versionIndex: number;
}) {
  const identity = unified.rowIdentities[unified.identityKey(personHash, versionIndex)];
  if (!identity) return null;
  return (
    <>
      {identity.fullName ? (
        <span className="truncate text-sm font-medium text-ink">{identity.fullName}</span>
      ) : null}
      <button
        type="button"
        onClick={() => unified.searchFor(String(identity.tokenId))}
        title={unified.t("search.unified.searchThis", "Search this")}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-xs font-semibold text-info transition-opacity hover:opacity-80"
      >
        <ImageIcon size={11} aria-hidden="true" />#{identity.tokenId}
      </button>
    </>
  );
}

function PersonHashCell({ unified, personHash }: { unified: UnifiedSearch; personHash: string }) {
  return (
    <>
      <div className={CHIP}>
        <SubjectValue unified={unified} value={personHash} />
        <CopyIconButton
          onClick={() => unified.onCopy(personHash)}
          label={unified.t("search.copy", "Copy") as string}
          size="xs"
        />
      </div>
    </>
  );
}

function AccountVersionsPanel({ unified }: { unified: UnifiedSearch }) {
  const { t } = unified;
  const facet = unified.accountFacets.versions;
  const rows = facet.state.data;

  if (rows.length === 0) {
    return <NoRows unified={unified} icon={<FileText size={22} aria-hidden="true" />} />;
  }

  return (
    <div>
      {facet.state.truncated ? <TruncatedNotice unified={unified} /> : null}
      <div className="divide-y divide-hairline">
        {rows.map((row, index) => (
          <div key={index} className={`${ROW} flex flex-wrap items-center gap-3`}>
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
              v{row.versionIndex}
            </span>
            <MintedName
              unified={unified}
              personHash={row.personHash}
              versionIndex={row.versionIndex}
            />
            <PersonHashCell unified={unified} personHash={row.personHash} />
            <div className="flex-1" />
            <span className="text-xs text-ink-subtle">
              {row.timestamp
                ? formatUnixSeconds(row.timestamp)
                : t("search.versionsQuery.unknown")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountEndorsementsPanel({ unified }: { unified: UnifiedSearch }) {
  const { t } = unified;
  const rows = unified.accountFacets.endorsements.state.data;

  if (rows.length === 0) {
    return <NoRows unified={unified} icon={<Star size={22} aria-hidden="true" />} />;
  }

  return (
    <div className="divide-y divide-hairline">
      {rows.map((row, index) => (
        <div key={index} className={`${ROW} flex flex-wrap items-center gap-3`}>
          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
            v{row.versionIndex}
          </span>
          <MintedName
            unified={unified}
            personHash={row.personHash}
            versionIndex={row.versionIndex}
          />
          <PersonHashCell unified={unified} personHash={row.personHash} />
          <div className="flex-1" />
          {row.endorsementCount ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
              <Star size={12} aria-hidden="true" />
              {row.endorsementCount}
            </span>
          ) : null}
          {row.tokenId ? (
            <>
              <RowAction
                tone="info"
                onClick={() => unified.searchFor(String(row.tokenId))}
                icon={<ImageIcon size={12} aria-hidden="true" />}
              >
                #{row.tokenId}
              </RowAction>
              <EncyclopediaLink unified={unified} tokenId={row.tokenId} />
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AccountNftsPanel({ unified }: { unified: UnifiedSearch }) {
  const rows = unified.accountFacets.nfts.state.data;

  if (rows.length === 0) {
    return <NoRows unified={unified} icon={<ImageIcon size={22} aria-hidden="true" />} />;
  }

  return (
    <div className="divide-y divide-hairline">
      {rows.map((row, index) => (
        <div key={index} className={`${ROW} flex flex-wrap items-center gap-3`}>
          <RowAction
            tone="info"
            onClick={() => unified.searchFor(String(row.tokenId))}
            icon={<ImageIcon size={12} aria-hidden="true" />}
          >
            NFT #{row.tokenId}
          </RowAction>
          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
            v{row.versionIndex}
          </span>
          {row.fullName ? (
            <span className="truncate text-sm font-medium text-ink">{row.fullName}</span>
          ) : null}
          <PersonHashCell unified={unified} personHash={row.personHash} />
          <div className="flex-1" />
          <EncyclopediaLink unified={unified} tokenId={row.tokenId} />
        </div>
      ))}
    </div>
  );
}

export const FACET_LABELS: Record<SearchFacetKey, { key: string; fallback: string }> = {
  versions: { key: "search.unified.facets.versions", fallback: "Versions" },
  trustedEndorsers: {
    key: "search.unified.facets.trustedEndorsers",
    fallback: "Endorsement sources",
  },
  endorsement: { key: "search.unified.facets.endorsement", fallback: "Endorsement stats" },
  children: { key: "search.unified.facets.children", fallback: "Children" },
  personNfts: { key: "search.unified.facets.personNfts", fallback: "NFTs" },
  storyChunks: { key: "search.unified.facets.storyChunks", fallback: "Story chunks" },
  uri: { key: "search.unified.facets.uri", fallback: "URI history" },
  accountVersions: { key: "search.unified.facets.accountVersions", fallback: "Versions created" },
  accountEndorsements: {
    key: "search.unified.facets.accountEndorsements",
    fallback: "Endorsements made",
  },
  accountNfts: { key: "search.unified.facets.accountNfts", fallback: "NFTs held" },
};

export const FACET_TOTAL_LABEL_KEYS: Record<SearchFacetKey, string> = {
  versions: "search.totalResults",
  trustedEndorsers: "search.trustedEndorsersQuery.totalSources",
  endorsement: "search.totalResults",
  children: "search.childrenQuery.totalChildren",
  personNfts: "search.totalResults",
  storyChunks: "search.storyChunksQuery.totalChunks",
  uri: "search.totalResults",
  accountVersions: "search.totalResults",
  accountEndorsements: "search.totalResults",
  accountNfts: "search.totalResults",
};
