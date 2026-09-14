import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Clock, Hash, Link, User } from "lucide-react";
import {
  getRecordTypeBorderColorClass,
  getRecordTypeColorClass,
  getRecordTypeIcon,
  getRecordTypeOptions,
} from "../../../domains/person";
import {
  formatHashMiddle,
  formatUnixSeconds,
  getStoryPresentation,
  shortAddress,
  type StoryRecord,
} from "../../../shared/model";
import type { PersonPageController } from "../hooks/usePersonPageController";
import { getRecordTypeLabel } from "../model/personPageModel";
import { CopyIconButton } from "../../../shared/ui";

export function PersonSidebar({ person }: { person: PersonPageController }) {
  const data = person.data;

  if (!data) return null;

  return (
    <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
      <RecordListCard person={person} />
      {data.storyMetadata && <DesktopMetadataCard person={person} />}
    </div>
  );
}

function RecordListCard({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;
  const sortedRecords = useMemo(
    () => getStoryPresentation(data?.storyRecords, data?.storyMetadata).records,
    [data?.storyRecords, data?.storyMetadata],
  );

  if (!data) return null;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-4 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t("person.recordList", "Record List")}
          {sortedRecords.length > 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-sm">
              {sortedRecords.length}
            </span>
          )}
        </h3>
      </div>
      {sortedRecords.length > 0 ? (
        <div className="divide-y divide-gray-200 dark:divide-gray-800 max-h-[500px] overflow-y-auto scrollbar-gutter-stable">
          {sortedRecords.map((record) => (
            <RecordListItem key={record.recordIndex} record={record} person={person} />
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            {t("person.noRecords", "No records")}
          </p>
        </div>
      )}
    </div>
  );
}

function RecordListItem({ record, person }: { record: StoryRecord; person: PersonPageController }) {
  const { t } = useTranslation();
  const recordTypeOptions = useMemo(() => getRecordTypeOptions(t), [t]);
  const open = person.expandedRecords.has(record.recordIndex);
  const preview = record.content.length > 60 ? `${record.content.slice(0, 60)}...` : record.content;
  const RecordIcon = getRecordTypeIcon(record.recordType);
  const iconColor = getRecordTypeColorClass(record.recordType);
  const borderColor = getRecordTypeBorderColorClass(record.recordType);

  return (
    <div className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <div
        role="button"
        tabIndex={0}
        onClick={() => person.toggleRecord(record.recordIndex)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            person.toggleRecord(record.recordIndex);
          }
        }}
        className="w-full text-left flex items-start gap-1.5 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm"
      >
        <span className="mt-0.5 text-gray-400 dark:text-gray-500 shrink-0">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <div className="flex-1 min-w-0">
          {record.title?.trim() && (
            <h4 className="mb-1 break-words text-sm font-semibold text-ink">{record.title}</h4>
          )}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t("person.recordOrdinal", "No. {{index}}", {
                  index: record.displayIndex ?? record.recordIndex + 1,
                })}
              </span>
              <div className="flex items-center gap-1.5">
                <RecordIcon size={14} className={iconColor} />
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border ${iconColor} ${borderColor} bg-white dark:bg-gray-900`}
                >
                  {getRecordTypeLabel(
                    record.recordType,
                    recordTypeOptions,
                    t("recordTypes.unknown", "Unknown"),
                  )}
                </span>
              </div>
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {record.content.length}
            </span>
          </div>
          <div
            className={`text-xs text-gray-600 dark:text-gray-400 ${
              open ? "whitespace-pre-wrap" : "line-clamp-2"
            }`}
          >
            {open ? record.content : preview}
          </div>
          {open && <RecordDetails record={record} person={person} />}
        </div>
      </div>
    </div>
  );
}

function RecordDetails({ record, person }: { record: StoryRecord; person: PersonPageController }) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-1 mt-1.5 pt-1.5 border-t border-gray-200 dark:border-gray-700"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <User size={12} className="shrink-0" />
        {record.author ? (
          <>
            <span className="truncate" title={record.author}>
              {shortAddress(record.author)}
            </span>
            <CopyIconButton
              label={t("search.copy")}
              onClick={() => person.copyText(record.author)}
              size="xs"
              stopPropagation
            />
          </>
        ) : (
          <span>-</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Clock size={12} className="shrink-0" />
        <span>{formatUnixSeconds(record.timestamp)}</span>
      </div>
      {record.attachmentCID && record.attachmentCID.trim().length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Link size={12} className="shrink-0" />
          <span className="truncate font-mono" title={record.attachmentCID}>
            {record.attachmentCID.length > 20
              ? `${record.attachmentCID.slice(0, 8)}...${record.attachmentCID.slice(-8)}`
              : record.attachmentCID}
          </span>
          <CopyIconButton
            label={t("search.copy")}
            onClick={() => person.copyText(record.attachmentCID)}
            size="xs"
            stopPropagation
          />
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Hash size={12} className="shrink-0" />
        <span className="font-mono truncate" title={record.payloadHash}>
          {formatHashMiddle(record.payloadHash)}
        </span>
        <CopyIconButton
          label={t("search.copy")}
          onClick={() => person.copyText(record.payloadHash)}
          size="xs"
          stopPropagation
        />
      </div>
    </div>
  );
}

function DesktopMetadataCard({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;

  if (!data?.storyMetadata) return null;

  return (
    <div className="hidden xl:block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-4 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t("person.metadata", "Metadata")}
        </h3>
      </div>
      <div className="p-4 space-y-2.5 text-sm">
        <DesktopMetadataValue label={t("person.tokenId", "Token ID")} value={`#${data.tokenId}`} />
        <DesktopMetadataValue
          label={t("person.totalRecords", "Total Records")}
          value={getStoryPresentation(data.storyRecords, data.storyMetadata).totalRecords}
        />
        <DesktopMetadataValue
          label={t("person.totalPayloadLength", "Total payload bytes")}
          value={getStoryPresentation(data.storyRecords, data.storyMetadata).totalPayloadLength}
        />
        <DesktopMetadataValue
          label={t("person.lastUpdate", "Last Update")}
          value={formatUnixSeconds(data.storyMetadata.lastUpdateTime)}
          small
        />
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
        <DesktopCopyValue
          label={t("person.recordsHead", "Record-chain head")}
          value={data.storyMetadata.recordsHead}
          onCopy={() => person.copyText(data.storyMetadata!.recordsHead)}
        />
        <DesktopCopyValue
          label={t("person.owner", "Owner Address")}
          title={data.owner}
          value={data.owner || "-"}
          onCopy={data.owner ? () => person.copyText(data.owner!) : undefined}
        />
        {data.personHash && (
          <DesktopCopyValue
            label={t("person.personHashLabel", "Person Hash")}
            value={data.personHash}
            onCopy={() => person.copyText(data.personHash!)}
          />
        )}
        {data.versionIndex !== undefined && data.versionIndex > 0 && (
          <DesktopCopyValue
            label={t("person.versionLabel", "Version:")}
            value={`${data.versionIndex}`}
            onCopy={() => person.copyText(`${data.versionIndex}`)}
          />
        )}
      </div>
    </div>
  );
}

function DesktopMetadataValue({
  label,
  small,
  value,
}: {
  label: string;
  small?: boolean;
  value: number | string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500 dark:text-gray-400 text-xs">{label}</span>
      <span
        className={`font-mono ${
          small
            ? "text-xs text-gray-700 dark:text-gray-300"
            : "font-medium text-gray-900 dark:text-gray-100"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function DesktopCopyValue({
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
          className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-sm select-all text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700"
          title={title}
        >
          {value}
        </div>
        {onCopy && <CopyIconButton onClick={onCopy} label={t("search.copy")} size="xs" />}
      </div>
    </div>
  );
}
