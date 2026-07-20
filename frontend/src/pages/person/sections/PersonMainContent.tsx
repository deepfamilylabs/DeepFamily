import { useMemo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Edit2, FileText, GitBranch, Layers, List } from "lucide-react";
import {
  getChunkTypeColorClass,
  getChunkTypeI18nKey,
  getChunkTypeIcon,
  getChunkTypeOptions,
} from "../../../domains/person";
import {
  formatUnixSeconds,
  formatYMD,
  genderText as genderTextFn,
} from "../../../shared/model";
import type { PersonPageController } from "../hooks/usePersonPageController";
import { hasStoryIntegrityIssues } from "../model/personPageModel";
import { CopyIconButton } from "../../../shared/ui";

export function PersonMainContent({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;

  if (!data) return null;

  return (
    <div className="xl:col-span-3 space-y-6">
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        {(data.fullName || data.nftCoreInfo) && <PersonIdentitySection person={person} />}
        <ProfileDataSection person={person} />
      </div>
      {data.storyMetadata && <MobileMetadataCard person={person} />}
    </div>
  );
}

function PersonIdentitySection({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;

  if (!data) return null;

  return (
    <div className="p-5 border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h1
              className="text-2xl sm:text-3xl font-normal text-gray-900 dark:text-gray-100"
              title={data.fullName || `Token #${data.tokenId}`}
            >
              {data.fullName || `Token #${data.tokenId}`}
            </h1>
            <span className="text-sm sm:text-3xl text-gray-500 dark:text-gray-400 font-display whitespace-nowrap">
              {t("person.encyclopedia", "Encyclopedia")}
            </span>
          </div>
        </div>
        {data.personHash && data.versionIndex !== undefined && (
          <button
            onClick={person.viewFamilyTree}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg transition-colors"
            title={t("person.viewFamilyTree", "View Family Tree") as string}
          >
            <GitBranch size={16} />
            <span className="hidden sm:inline">
              {t("person.viewFamilyTree", "View Family Tree")}
            </span>
          </button>
        )}
      </div>

      <InlineIntegrityWarnings person={person} />

      <div className="-mx-5 border-t border-gray-200 dark:border-gray-800 mb-4" />
      <BasicInfoSection person={person} />
    </div>
  );
}

function InlineIntegrityWarnings({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;

  if (!hasStoryIntegrityIssues(data) || !data?.integrity) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mb-4 pb-4 border-b border-gray-200 dark:border-gray-800">
      {data.integrity.missing.length > 0 && (
        <span className="inline-flex items-start gap-1">
          <AlertTriangle
            className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          {t("person.integrityMissing", "Missing indices: {{indices}}", {
            indices: data.integrity.missing.join(","),
          })}
        </span>
      )}
      {!data.integrity.lengthMatch && (
        <span className="inline-flex items-start gap-1">
          <AlertTriangle
            className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          {t("person.integrityLenDiff", "Length mismatch local={{local}} bytes", {
            local: data.integrity.computedLength,
          })}
        </span>
      )}
      {data.integrity.hashMatch === false && (
        <span className="inline-flex items-start gap-1">
          <AlertTriangle
            className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          {t("person.integrityLocalHashMismatch", "Local hash mismatch")}
        </span>
      )}
    </div>
  );
}

function BasicInfoSection({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;

  if (!data) return null;

  return (
    <>
      <h3
        ref={person.registerSection("basicInfo")}
        id="basic-info"
        className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 scroll-mt-20"
      >
        {t("person.basicInfo", "Basic Info")}
      </h3>
      <div className="space-y-3 text-sm sm:text-base">
        {data.fullName && (
          <InfoRow label={t("familyTree.nodeDetail.fullName", "Full Name")}>
            <span className="text-gray-900 dark:text-gray-100 font-medium">{data.fullName}</span>
          </InfoRow>
        )}

        {data.nftCoreInfo?.gender !== undefined && data.nftCoreInfo.gender > 0 && (
          <InfoRow label={t("familyTree.nodeDetail.gender", "Gender")}>
            <span className="text-gray-900 dark:text-gray-100 font-medium">
              {genderTextFn(data.nftCoreInfo.gender, t as any) || "-"}
            </span>
          </InfoRow>
        )}

        {data.nftCoreInfo && (data.nftCoreInfo.birthYear || data.nftCoreInfo.birthPlace) && (
          <InfoRow align="start" label={t("familyTree.nodeDetail.birth", "Birth")}>
            <span className="text-gray-900 dark:text-gray-100 font-medium">
              {[
                formatYMD(
                  data.nftCoreInfo.birthYear,
                  data.nftCoreInfo.birthMonth,
                  data.nftCoreInfo.birthDay,
                  data.nftCoreInfo.isBirthBC,
                ),
                data.nftCoreInfo.birthPlace,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </InfoRow>
        )}

        {data.nftCoreInfo && (data.nftCoreInfo.deathYear || data.nftCoreInfo.deathPlace) && (
          <InfoRow align="start" label={t("familyTree.nodeDetail.death", "Death")}>
            <span className="text-gray-900 dark:text-gray-100 font-medium">
              {[
                formatYMD(
                  data.nftCoreInfo.deathYear,
                  data.nftCoreInfo.deathMonth,
                  data.nftCoreInfo.deathDay,
                  data.nftCoreInfo.isDeathBC,
                ),
                data.nftCoreInfo.deathPlace,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </InfoRow>
        )}

        {data.nftCoreInfo?.story && data.nftCoreInfo.story.trim() !== "" && (
          <InfoRow align="start" label={t("familyTree.nodeDetail.story", "Story")} padded>
            <div className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
              {data.nftCoreInfo.story}
            </div>
          </InfoRow>
        )}
      </div>
    </>
  );
}

function InfoRow({
  align,
  children,
  label,
  padded,
}: {
  align?: "center" | "start";
  children: ReactNode;
  label: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`flex flex-col sm:flex-row ${
        align === "start" ? "sm:items-start" : "sm:items-center"
      } gap-1 sm:gap-4 ${padded ? "pt-1" : ""}`}
    >
      <span className="text-gray-500 dark:text-gray-400 sm:w-24 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function ProfileDataSection({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const chunkTypeOptions = useMemo(() => getChunkTypeOptions(t), [t]);
  const data = person.data;

  if (!data) return null;

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t("person.profileData", "Profile Data")}
          </h3>
          {data.storyMetadata?.isSealed ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded-sm text-xs font-medium border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20">
              {t("person.sealed", "Sealed")}
            </span>
          ) : (
            <button
              onClick={person.openEditorInNewTab}
              onPointerDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              className="inline-flex h-7 min-w-[36px] items-center gap-1 px-2 sm:px-2.5 py-1 bg-green-50 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-950/60 border border-green-200/60 dark:border-green-800/50 rounded-full transition-all duration-200 cursor-pointer justify-center sm:justify-start"
              aria-label={t("familyTree.nodeDetail.editStory", "Edit Story") as string}
              title={t("familyTree.nodeDetail.editStory", "Edit Story") as string}
            >
              <Edit2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
              <span className="hidden sm:inline text-[13px] font-semibold text-green-700 dark:text-green-400">
                {t("familyTree.nodeDetail.edit", "Edit")}
              </span>
            </button>
          )}
        </div>
        {data.fullStory && data.fullStory.length > 0 && <ViewModeToggle person={person} />}
      </div>

      {hasStoryIntegrityIssues(data) && (
        <div className="mb-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {t("person.integrityWarn", "Integrity Warning")}
          </span>
        </div>
      )}

      {person.viewMode === "sections" && person.groupedChunks.length > 0 ? (
        <div
          ref={person.registerSection("profileTop")}
          id="person-profile-top"
          className="space-y-6"
        >
          {person.groupedChunks.map(({ type, chunks }) => {
            const ChunkIcon = getChunkTypeIcon(type);
            const colorClass = getChunkTypeColorClass(type);
            const typeLabel = t(
              getChunkTypeI18nKey(type),
              chunkTypeOptions.find((option) => option.value === type)?.label || "Unknown",
            );

            return (
              <div
                key={type}
                ref={person.registerSection(type)}
                id={`section-${type}`}
                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden scroll-mt-20"
              >
                <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <ChunkIcon size={18} className={colorClass} />
                    <h4 className={`text-base font-semibold ${colorClass}`}>{typeLabel}</h4>
                    <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/50 px-2 py-0.5 rounded-full">
                      {chunks.length}
                    </span>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {chunks.map((chunk) => (
                    <div
                      key={chunk.chunkIndex}
                      className="text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed"
                    >
                      <p className="whitespace-pre-wrap">{chunk.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : person.viewMode === "paragraph" && person.fullStoryParagraphs.length > 0 ? (
        <div className="space-y-4 text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed">
          {(person.chunkParagraphs.length > 0 ? person.chunkParagraphs : person.fullStoryParagraphs).map(
            (content, index) => (
              <p key={index} className="whitespace-pre-wrap">
                {content}
              </p>
            ),
          )}
        </div>
      ) : person.viewMode === "paragraph" && data.fullStory ? (
        <div className="text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed">
          <p className="whitespace-pre-wrap">{data.fullStory}</p>
        </div>
      ) : person.viewMode === "raw" && data.fullStory ? (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-sm p-3 border border-gray-200 dark:border-gray-700">
          <pre className="font-mono text-xs sm:text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto">
            {data.fullStory}
          </pre>
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            {t("person.noProfileData", "No profile data")}
          </p>
        </div>
      )}
    </div>
  );
}

function ViewModeToggle({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();

  return (
    <div className="inline-flex items-center rounded-sm border border-gray-300 dark:border-gray-600">
      <ViewModeButton
        active={person.viewMode === "sections"}
        icon={<Layers size={14} />}
        label={t("person.sections", "Sections")}
        title={t("person.viewSections", "Sections Mode") as string}
        onClick={() => person.setViewMode("sections")}
      />
      <div className="w-px h-4 bg-gray-300 dark:border-gray-600" />
      <ViewModeButton
        active={person.viewMode === "paragraph"}
        icon={<List size={14} />}
        label={t("person.paragraph", "Paragraph")}
        title={t("person.viewParagraph", "Paragraph Mode") as string}
        onClick={() => person.setViewMode("paragraph")}
      />
      <div className="w-px h-4 bg-gray-300 dark:border-gray-600" />
      <ViewModeButton
        active={person.viewMode === "raw"}
        icon={<FileText size={14} />}
        label={t("person.raw", "Raw")}
        title={t("person.viewRaw", "Raw Mode") as string}
        onClick={() => person.setViewMode("raw")}
      />
    </div>
  );
}

function ViewModeButton({
  active,
  icon,
  label,
  onClick,
  title,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
        active
          ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}
      title={title}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function MobileMetadataCard({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;

  if (!data?.storyMetadata) return null;

  return (
    <div className="xl:hidden bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-4 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t("person.metadata", "Metadata")}
        </h3>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
          <MetadataValue label={t("person.tokenId", "Token ID")} value={`#${data.tokenId}`} />
          <MetadataValue
            label={t("person.totalChunks", "Total Chunks")}
            value={data.storyMetadata.totalChunks}
          />
          <MetadataValue
            label={t("person.totalLength", "Total Length")}
            value={data.storyMetadata.totalLength}
          />
        </div>
        <div className="text-sm mb-3 pb-3 border-b border-gray-200 dark:border-gray-800">
          <div className="text-gray-500 dark:text-gray-400 mb-1 text-xs">
            {t("person.lastUpdate", "Last Update")}
          </div>
          <div className="font-mono text-xs text-gray-700 dark:text-gray-300">
            {formatUnixSeconds(data.storyMetadata.lastUpdateTime)}
          </div>
        </div>
        <div className="space-y-3">
          <MobileCopyValue
            label={t("person.storyHash", "Story Hash")}
            value={data.storyMetadata.fullStoryHash}
            onCopy={() => person.copyText(data.storyMetadata!.fullStoryHash)}
          />
          <MobileCopyValue
            label={t("person.owner", "Owner Address")}
            title={data.owner}
            value={data.owner || "-"}
            onCopy={data.owner ? () => person.copyText(data.owner!) : undefined}
          />
          {data.personHash && (
            <MobileCopyValue
              label={t("person.personHashLabel", "Person Hash")}
              value={data.personHash}
              onCopy={() => person.copyText(data.personHash!)}
            />
          )}
          {data.versionIndex !== undefined && data.versionIndex > 0 && (
            <MobileCopyValue
              label={t("person.versionLabel", "Version:")}
              value={`${data.versionIndex}`}
              onCopy={() => person.copyText(`${data.versionIndex}`)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MetadataValue({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-gray-500 dark:text-gray-400 mb-1 text-xs">{label}</div>
      <div className="font-mono font-medium text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

function MobileCopyValue({
  label,
  onCopy,
  title,
  value,
}: {
  label: string;
  onCopy?: () => void;
  title?: string;
  value: string;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{label}</div>
      <div className="flex items-center">
        <div
          className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-md select-all text-gray-600 dark:text-gray-400 flex-1 min-w-0 border border-gray-200 dark:border-gray-700"
          title={title}
        >
          {value}
        </div>
        {onCopy && (
          <CopyIconButton
            onClick={onCopy}
            label={t("search.copy")}
            size="sm"
            className="ml-3"
          />
        )}
      </div>
    </div>
  );
}
