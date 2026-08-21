import { ArrowLeft, ArrowRight, RefreshCw, Search } from "lucide-react";
import { formatUnixSeconds } from "../../../shared/model";
import { CopyIconButton } from "../../../shared/ui";
import type { SearchPageController } from "../hooks/useSearchPageController";
import {
  ButtonPrimary,
  ButtonSecondary,
  FieldError,
  HashInline,
  Input,
  SectionCard,
} from "../ui/SearchPageUi";

export function VersionsQuerySection({ search }: { search: SearchPageController }) {
  const { t } = search;
  const {
    form: {
      register,
      handleSubmit,
      formState: { errors },
    },
    state,
    actions,
  } = search.versions;

  return (
    <SectionCard
      title={t("search.versionsQuery.title")}
      isOpen={search.openSections.versions}
      onToggle={() => search.toggle("versions")}
    >
      <div className="space-y-6">
        <form
          onSubmit={handleSubmit((data) => actions.query(data, 0))}
          className="flex flex-col md:flex-row gap-4 items-start"
        >
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.versionsQuery.personHash")}
            </label>
            <Input
              placeholder={t("search.versionsQuery.placeholder")}
              {...register("personHash")}
            />
            <FieldError message={errors.personHash?.message as any} />
          </div>
          <div className="w-full md:w-32">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.nameQuery.pageSize")}
            </label>
            <Input
              type="number"
              placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
              {...register("pageSize", { setValueAs: search.sanitizeNumberInput })}
            />
            <FieldError
              message={search.formatNumericError(
                errors.pageSize?.message,
                search.validationMessages.pageSize,
              )}
            />
          </div>
          <div className="flex gap-3 pt-7 w-full md:w-auto">
            <ButtonPrimary type="submit" disabled={state.loading}>
              {state.loading ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <Search size={18} />
              )}
              {t("search.query")}
            </ButtonPrimary>
            <ButtonSecondary type="button" onClick={actions.reset}>
              {t("search.reset")}
            </ButtonSecondary>
          </div>
        </form>

        {state.queried && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {t("search.totalResults")}: {state.total}
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
              {state.data.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  {state.loading ? t("search.loading") : t("search.noData")}
                </div>
              ) : (
                state.data.map((version, index) => (
                  <div
                    key={index}
                    className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm mb-3">
                      <div className="flex items-center gap-2">
                        <div className="px-2.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 font-medium text-xs">
                          v{Number(version.versionIndex)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 max-w-full flex-1 min-w-0">
                        <span className="whitespace-nowrap shrink-0">
                          {t("search.versionsQuery.creator")}:
                        </span>
                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md min-w-0">
                          <HashInline
                            value={String(version.addedBy || "")}
                            className="font-mono text-xs text-gray-900 dark:text-gray-200 flex-1 min-w-0"
                          />
                          <CopyIconButton
                            onClick={() => search.onCopy(String(version.addedBy || ""))}
                            label={t("search.copy", "Copy") as string}
                            size="xs"
                          />
                        </div>
                      </div>
                      <div className="text-gray-500 dark:text-gray-500 text-xs">
                        {version.timestamp
                          ? formatUnixSeconds(version.timestamp)
                          : t("search.versionsQuery.unknown")}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 text-sm pl-0 md:pl-0">
                      {version.versionCommitment !== undefined && (
                        <div className="grid grid-cols-[80px_1fr] gap-2 items-center min-h-[28px]">
                          <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0 text-right text-xs">
                            {t("search.versionsQuery.versionCommitment", "Commitment")}
                          </span>
                          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md min-w-0 w-fit max-w-full">
                            <span
                              className="font-mono text-xs text-gray-900 dark:text-gray-100 truncate min-w-0"
                              title={String(version.versionCommitment)}
                            >
                              {String(version.versionCommitment)}
                            </span>
                            <CopyIconButton
                              onClick={() => search.onCopy(String(version.versionCommitment))}
                              label={t("search.copy", "Copy") as string}
                              size="xs"
                            />
                          </div>
                        </div>
                      )}

                      <VersionParentRow
                        label={t("search.versionsQuery.fatherHash")}
                        hash={version.fatherHash}
                        versionIndex={Number(version.fatherVersionIndex)}
                        onCopy={search.onCopy}
                        copyLabel={t("search.copy", "Copy") as string}
                      />
                      <VersionParentRow
                        label={t("search.versionsQuery.motherHash")}
                        hash={version.motherHash}
                        versionIndex={Number(version.motherVersionIndex)}
                        onCopy={search.onCopy}
                        copyLabel={t("search.copy", "Copy") as string}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            <PaginationFooter
              t={t}
              offset={state.offset}
              loading={state.loading}
              hasMore={state.hasMore}
              onPrev={actions.prev}
              onNext={actions.next}
            />
            <QueryError error={state.error} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export function TrustedEndorsersQuerySection({ search }: { search: SearchPageController }) {
  const { t } = search;
  const {
    form: {
      register,
      handleSubmit,
      formState: { errors },
    },
    state,
    actions,
  } = search.trustedEndorsers;

  return (
    <SectionCard
      title={t("search.trustedEndorsersQuery.title")}
      isOpen={search.openSections.trustedEndorsers}
      onToggle={() => search.toggle("trustedEndorsers")}
    >
      <div className="space-y-6">
        <form
          onSubmit={handleSubmit((data) => actions.query(data, 0))}
          className="flex flex-col md:flex-row gap-4 items-start"
        >
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.trustedEndorsersQuery.personHash")}
            </label>
            <Input
              placeholder={t("search.trustedEndorsersQuery.placeholder")}
              {...register("personHash")}
            />
            <FieldError message={errors.personHash?.message as any} />
          </div>
          <div className="w-full md:w-32">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.trustedEndorsersQuery.versionIndex")}
            </label>
            <Input
              type="number"
              placeholder={t("search.trustedEndorsersQuery.versionPlaceholder")}
              title={t("search.trustedEndorsersQuery.versionPlaceholder")}
              {...register("versionIndex", { setValueAs: search.sanitizeNumberInput })}
            />
            <FieldError
              message={search.formatNumericError(
                errors.versionIndex?.message,
                search.validationMessages.versionIndexOne,
              )}
            />
          </div>
          <div className="w-full md:w-32">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.nameQuery.pageSize")}
            </label>
            <Input
              type="number"
              placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
              {...register("pageSize", { setValueAs: search.sanitizeNumberInput })}
            />
            <FieldError
              message={search.formatNumericError(
                errors.pageSize?.message,
                search.validationMessages.pageSize,
              )}
            />
          </div>
          <div className="flex gap-3 pt-7 w-full md:w-auto">
            <ButtonPrimary type="submit" disabled={state.loading}>
              {state.loading ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <Search size={18} />
              )}
              {t("search.query")}
            </ButtonPrimary>
            <ButtonSecondary type="button" onClick={actions.reset}>
              {t("search.reset")}
            </ButtonSecondary>
          </div>
        </form>

        {state.queried && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {t("search.trustedEndorsersQuery.totalSources")}: {state.total}
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
              {state.data.accounts.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  {state.loading ? t("search.loading") : t("search.noData")}
                </div>
              ) : (
                state.data.accounts.map((account, index) => (
                  <div
                    key={`${account}-${index}`}
                    className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                  >
                    <div className="grid grid-cols-[96px_1fr] gap-2 items-center text-sm">
                      <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0 text-right">
                        {t("search.trustedEndorsersQuery.account")}:
                      </span>
                      <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md min-w-0 w-fit max-w-full">
                        <HashInline
                          value={account}
                          className="font-mono text-xs text-gray-900 dark:text-gray-200 flex-1 min-w-0"
                        />
                        <CopyIconButton
                          onClick={() => search.onCopy(account)}
                          label={t("search.copy", "Copy") as string}
                          size="xs"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <PaginationFooter
              t={t}
              offset={state.offset}
              loading={state.loading}
              hasMore={state.hasMore}
              onPrev={actions.prev}
              onNext={actions.next}
            />
            <QueryError error={state.error} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function VersionParentRow({
  label,
  hash,
  versionIndex,
  onCopy,
  copyLabel,
}: {
  label: string;
  hash: string;
  versionIndex: number;
  onCopy: (text: string) => void;
  copyLabel: string;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2 items-center min-h-[28px]">
      <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0 text-right text-xs">
        {label}
      </span>
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md min-w-0 w-fit max-w-full">
          <HashInline
            value={hash}
            className="font-mono text-xs text-gray-900 dark:text-gray-200 min-w-0"
          />
          <CopyIconButton onClick={() => onCopy(hash)} label={copyLabel} size="xs" />
        </div>
        <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
          (v{versionIndex})
        </span>
      </div>
    </div>
  );
}

export function EndorsementQuerySection({ search }: { search: SearchPageController }) {
  const { t } = search;
  const {
    form: {
      register,
      handleSubmit,
      formState: { errors },
    },
    state,
    actions,
  } = search.endorsement;

  return (
    <SectionCard
      title={t("search.endorsementQuery.title")}
      isOpen={search.openSections.endorsement}
      onToggle={() => search.toggle("endorsement")}
    >
      <div className="space-y-6">
        <form
          onSubmit={handleSubmit((data) => actions.query(data, 0))}
          className="flex flex-col md:flex-row gap-4 items-start"
        >
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.endorsementQuery.personHash")}
            </label>
            <Input
              placeholder={t("search.endorsementQuery.placeholder")}
              {...register("personHash")}
            />
            <FieldError message={errors.personHash?.message as any} />
          </div>
          <div className="w-full md:w-32">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.nameQuery.pageSize")}
            </label>
            <Input
              type="number"
              placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
              {...register("pageSize", { setValueAs: search.sanitizeNumberInput })}
            />
            <FieldError
              message={search.formatNumericError(
                errors.pageSize?.message,
                search.validationMessages.pageSize,
              )}
            />
          </div>
          <div className="flex gap-3 pt-7 w-full md:w-auto">
            <ButtonPrimary type="submit" disabled={state.loading}>
              {state.loading ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <Search size={18} />
              )}
              {t("search.query")}
            </ButtonPrimary>
            <ButtonSecondary type="button" onClick={actions.reset}>
              {t("search.reset")}
            </ButtonSecondary>
          </div>
        </form>

        {state.queried && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {t("search.totalResults")}: {state.total}
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
              {state.data.versionIndices.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  {state.loading ? t("search.loading") : t("search.noData")}
                </div>
              ) : (
                state.data.versionIndices.map((versionIndex, index) => (
                  <div
                    key={index}
                    className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 dark:text-gray-400">
                          {t("search.endorsementQuery.version")}:
                        </span>
                        <span className="font-medium text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                          v{versionIndex}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 dark:text-gray-400">
                          {t("search.endorsementQuery.endorsementCount")}:
                        </span>
                        <span className="font-bold text-orange-500">
                          {state.data.endorsementCounts[index]}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 dark:text-gray-400">
                          {t("search.endorsementQuery.tokenId")}:
                        </span>
                        <span className="font-mono text-gray-900 dark:text-gray-100">
                          #{state.data.tokenIds[index]}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <PaginationFooter
              t={t}
              offset={state.offset}
              loading={state.loading}
              hasMore={state.hasMore}
              onPrev={actions.prev}
              onNext={actions.next}
            />
            <QueryError error={state.error} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export function ChildrenQuerySection({ search }: { search: SearchPageController }) {
  const { t } = search;
  const {
    form: {
      register,
      handleSubmit,
      formState: { errors },
    },
    state,
    actions,
  } = search.children;

  return (
    <SectionCard
      title={t("search.childrenQuery.title")}
      isOpen={search.openSections.children}
      onToggle={() => search.toggle("children")}
    >
      <div className="space-y-6">
        <form
          onSubmit={handleSubmit((data) => actions.query(data, 0))}
          className="flex flex-col md:flex-row gap-4 items-start"
        >
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.childrenQuery.parentHash")}
            </label>
            <Input
              placeholder={t("search.childrenQuery.parentHashPlaceholder")}
              {...register("parentHash")}
            />
            <FieldError message={errors.parentHash?.message as any} />
          </div>
          <div className="w-full md:w-32">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.childrenQuery.parentVersion")}
            </label>
            <Input
              type="number"
              placeholder={t("search.versionIndexPlaceholder", { defaultValue: "≥0" })}
              title={t("search.versionIndexPlaceholder", { defaultValue: "≥0" })}
              {...register("parentVersionIndex", { setValueAs: search.sanitizeNumberInput })}
            />
            <FieldError
              message={search.formatNumericError(
                errors.parentVersionIndex?.message,
                search.validationMessages.versionIndex,
              )}
            />
          </div>
          <div className="w-full md:w-32">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.nameQuery.pageSize")}
            </label>
            <Input
              type="number"
              placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
              {...register("pageSize", { setValueAs: search.sanitizeNumberInput })}
            />
            <FieldError
              message={search.formatNumericError(
                errors.pageSize?.message,
                search.validationMessages.pageSize,
              )}
            />
          </div>
          <div className="flex gap-3 pt-7 w-full md:w-auto">
            <ButtonPrimary type="submit" disabled={state.loading}>
              {state.loading ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <Search size={18} />
              )}
              {t("search.query")}
            </ButtonPrimary>
            <ButtonSecondary type="button" onClick={actions.reset}>
              {t("search.reset")}
            </ButtonSecondary>
          </div>
        </form>

        {state.queried && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {t("search.childrenQuery.totalChildren")}: {state.total}
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
              {state.data.childHashes.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  {state.loading ? t("search.loading") : t("search.noData")}
                </div>
              ) : (
                state.data.childHashes.map((childHash, index) => (
                  <div
                    key={index}
                    className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                  >
                    <div className="flex flex-col gap-2 text-sm">
                      <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0 text-right">
                          {t("search.childrenQuery.childHash")}:
                        </span>
                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md min-w-0 w-fit max-w-full">
                          <HashInline
                            value={childHash}
                            className="font-mono text-xs text-gray-900 dark:text-gray-200 flex-1 min-w-0"
                          />
                          <CopyIconButton
                            onClick={() => search.onCopy(childHash)}
                            label={t("search.copy", "Copy") as string}
                            size="xs"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0 text-right">
                          {t("search.childrenQuery.childVersion")}:
                        </span>
                        <div className="w-fit">
                          <span className="font-medium text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                            v{state.data.childVersions[index]}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <PaginationFooter
              t={t}
              offset={state.offset}
              loading={state.loading}
              hasMore={state.hasMore}
              onPrev={actions.prev}
              onNext={actions.next}
            />
            <QueryError error={state.error} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export function StoryChunksQuerySection({ search }: { search: SearchPageController }) {
  const { t } = search;
  const {
    form: {
      register,
      handleSubmit,
      formState: { errors },
    },
    state,
    actions,
  } = search.storyChunks;

  return (
    <SectionCard
      title={t("search.storyChunksQuery.title")}
      isOpen={search.openSections.storyChunks}
      onToggle={() => search.toggle("storyChunks")}
    >
      <div className="space-y-6">
        <form
          onSubmit={handleSubmit((data) => actions.query(data, 0))}
          className="flex flex-col md:flex-row gap-4 items-start"
        >
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.storyChunksQuery.tokenId")}
            </label>
            <Input
              type="number"
              placeholder={t("search.storyChunksQuery.placeholder")}
              title={t("search.storyChunksQuery.placeholder")}
              {...register("tokenId", { setValueAs: search.sanitizeNumberInput })}
            />
            <FieldError
              message={search.formatNumericError(
                errors.tokenId?.message,
                search.validationMessages.tokenId,
              )}
            />
          </div>
          <div className="w-full md:w-32">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.nameQuery.pageSize")}
            </label>
            <Input
              type="number"
              placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
              {...register("pageSize", { setValueAs: search.sanitizeNumberInput })}
            />
            <FieldError
              message={search.formatNumericError(
                errors.pageSize?.message,
                search.validationMessages.pageSize,
              )}
            />
          </div>
          <div className="flex gap-3 pt-7 w-full md:w-auto">
            <ButtonPrimary type="submit" disabled={state.loading}>
              {state.loading ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <Search size={18} />
              )}
              {t("search.query")}
            </ButtonPrimary>
            <ButtonSecondary type="button" onClick={actions.reset}>
              {t("search.reset")}
            </ButtonSecondary>
          </div>
        </form>

        {state.queried && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {t("search.storyChunksQuery.totalChunks")}: {state.total}
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
              {state.data.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  {state.loading ? t("search.loading") : t("search.noData")}
                </div>
              ) : (
                state.data.map((chunk, index) => (
                  <div
                    key={index}
                    className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm mb-3">
                      <div className="px-2.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium text-xs">
                        #{Number(chunk.chunkIndex)}
                      </div>
                      <div className="text-gray-500 dark:text-gray-500 text-xs">
                        {chunk.timestamp
                          ? formatUnixSeconds(chunk.timestamp)
                          : t("search.versionsQuery.unknown")}
                      </div>
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 ml-auto">
                        <span className="text-xs">{t("search.storyChunksQuery.chunkType")}:</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {search.chunkTypes.getChunkTypeLabel(Number(chunk.chunkType ?? 0))}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl text-sm text-gray-700 dark:text-gray-300 leading-relaxed max-h-32 overflow-y-auto">
                        {chunk.content || (
                          <span className="text-gray-400 italic">{t("search.noData")}</span>
                        )}
                      </div>

                      <div className="flex flex-col gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <HashDataRow
                          label={`${t("search.storyChunksQuery.chunkHash")}:`}
                          value={String(chunk.chunkHash || "")}
                          onCopy={search.onCopy}
                          copyLabel={t("search.copy", "Copy") as string}
                          size="xs"
                        />
                        {chunk.editor && (
                          <HashDataRow
                            label={`${t("search.storyChunksQuery.editor")}:`}
                            value={String(chunk.editor)}
                            onCopy={search.onCopy}
                            copyLabel={t("search.copy", "Copy") as string}
                            size="xs"
                          />
                        )}
                        {chunk.attachmentCID && chunk.attachmentCID.length > 0 && (
                          <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                            <span className="whitespace-nowrap shrink-0 text-right">
                              {t("search.storyChunksQuery.attachmentCID")}:
                            </span>
                            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-sm min-w-0 w-fit max-w-full">
                              <span
                                className="font-mono truncate flex-1 min-w-0"
                                title={chunk.attachmentCID}
                              >
                                {chunk.attachmentCID}
                              </span>
                              <CopyIconButton
                                onClick={() => search.onCopy(String(chunk.attachmentCID))}
                                label={t("search.copy", "Copy") as string}
                                size="xs"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <PaginationFooter
              t={t}
              offset={state.offset}
              loading={state.loading}
              hasMore={state.hasMore}
              onPrev={actions.prev}
              onNext={actions.next}
            />
            <QueryError error={state.error} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export function UriHistoryQuerySection({ search }: { search: SearchPageController }) {
  const { t } = search;
  const {
    form: {
      register,
      handleSubmit,
      formState: { errors },
    },
    state,
    actions,
  } = search.uri;

  return (
    <SectionCard
      title={t("search.uriQuery.title")}
      isOpen={search.openSections.uri}
      onToggle={() => search.toggle("uri")}
    >
      <div className="space-y-6">
        <form
          onSubmit={handleSubmit((data) => actions.query(data, 0))}
          className="flex flex-col md:flex-row gap-4 items-start"
        >
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.uriQuery.tokenId")}
            </label>
            <Input
              type="number"
              placeholder={t("search.uriQuery.placeholder")}
              title={t("search.uriQuery.placeholder")}
              {...register("tokenId", { setValueAs: search.sanitizeNumberInput })}
            />
            <FieldError
              message={search.formatNumericError(
                errors.tokenId?.message,
                search.validationMessages.tokenId,
              )}
            />
          </div>
          <div className="w-full md:w-32">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("search.nameQuery.pageSize")}
            </label>
            <Input
              type="number"
              placeholder={t("search.pageSizePlaceholder", { defaultValue: "≤100" })}
              {...register("pageSize", { setValueAs: search.sanitizeNumberInput })}
            />
            <FieldError
              message={search.formatNumericError(
                errors.pageSize?.message,
                search.validationMessages.pageSize,
              )}
            />
          </div>
          <div className="flex gap-3 pt-7 w-full md:w-auto">
            <ButtonPrimary type="submit" disabled={state.loading}>
              {state.loading ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <Search size={18} />
              )}
              {t("search.query")}
            </ButtonPrimary>
            <ButtonSecondary type="button" onClick={actions.reset}>
              {t("search.reset")}
            </ButtonSecondary>
          </div>
        </form>

        {state.queried && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {t("search.totalResults")}: {state.total}
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
              {state.data.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  {state.loading ? t("search.loading") : t("search.noData")}
                </div>
              ) : (
                state.data.map((uri, index) => (
                  <div
                    key={index}
                    className="p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-lg">
                        <span
                          className="font-mono text-sm text-gray-700 dark:text-gray-300 truncate flex-1"
                          title={uri}
                        >
                          {uri}
                        </span>
                        <CopyIconButton
                          onClick={() => search.onCopy(uri)}
                          label={t("search.copy", "Copy") as string}
                          size="sm"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <PaginationFooter
              t={t}
              offset={state.offset}
              loading={state.loading}
              hasMore={state.hasMore}
              onPrev={actions.prev}
              onNext={actions.next}
            />
            <QueryError error={state.error} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function HashDataRow({
  label,
  value,
  onCopy,
  copyLabel,
  size,
}: {
  label: string;
  value: string;
  onCopy: (text: string) => void;
  copyLabel: string;
  size: "xs" | "sm";
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
      <span className="whitespace-nowrap shrink-0 text-right">{label}</span>
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-sm min-w-0 w-fit max-w-full">
        <HashInline value={value} className="font-mono flex-1 min-w-0" />
        <CopyIconButton label={copyLabel} onClick={() => onCopy(value)} size={size} />
      </div>
    </div>
  );
}

function PaginationFooter({
  t,
  offset,
  loading,
  hasMore,
  onPrev,
  onNext,
}: {
  t: SearchPageController["t"];
  offset: number;
  loading: boolean;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {t("search.offset")}: {offset}
      </div>
      <div className="flex gap-2">
        <ButtonSecondary
          onClick={onPrev}
          disabled={loading || offset === 0}
          className="px-4! py-1.5! text-sm"
        >
          <ArrowLeft size={14} />
          {t("search.prev")}
        </ButtonSecondary>
        <ButtonSecondary
          onClick={onNext}
          disabled={loading || !hasMore}
          className="px-4! py-1.5! text-sm"
        >
          {t("search.next")}
          <ArrowRight size={14} />
        </ButtonSecondary>
      </div>
    </div>
  );
}

function QueryError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-800/30">
      {error}
    </div>
  );
}
