import { useMemo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Layers, User } from "lucide-react";
import {
  getRecordTypeColorClass,
  getRecordTypeI18nKey,
  getRecordTypeIcon,
  getRecordTypeOptions,
} from "../../../domains/person";
import type { PersonPageController } from "../hooks/usePersonPageController";

export function PersonSectionNavigation({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const recordTypeOptions = useMemo(() => getRecordTypeOptions(t), [t]);

  if (person.viewMode !== "sections" || person.groupedRecords.length === 0 || !person.data) {
    return null;
  }

  return (
    <div className="hidden xl:block fixed left-[calc((100vw-1280px)/2-204px)] top-[104px] w-56 h-[calc(100vh-104px-64px)] z-10">
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-xs overflow-hidden flex flex-col h-full">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 rounded-t-lg">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("person.sectionNav", "目录")}
          </h4>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-gutter-stable overscroll-y-contain">
          <SectionNavButton
            active={person.activeSection === "basicInfo"}
            icon={<User size={14} />}
            label={t("person.basicInfo", "基本信息")}
            onClick={() => person.scrollToSection("basicInfo")}
          />

          <SectionNavButton
            active={
              typeof person.activeSection === "number" || person.activeSection === "profileTop"
            }
            count={person.groupedRecords.reduce((count, group) => count + group.records.length, 0)}
            icon={<Layers size={14} />}
            label={t("person.profileData", "Life Story")}
            onClick={() => person.scrollToSection("profileTop")}
          />

          {person.groupedRecords.map(({ type, records }) => {
            const RecordIcon = getRecordTypeIcon(type);
            const colorClass = getRecordTypeColorClass(type);
            const typeLabel = t(
              getRecordTypeI18nKey(type),
              recordTypeOptions.find((option) => option.value === type)?.label || "Unknown",
            );

            return (
              <SectionNavButton
                key={type}
                active={person.activeSection === type}
                count={records.length}
                depth="child"
                icon={<RecordIcon size={14} />}
                iconClassName={colorClass}
                label={typeLabel}
                onClick={() => person.scrollToSection(type)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SectionNavButton({
  active,
  count,
  depth,
  icon,
  iconClassName,
  label,
  onClick,
}: {
  active: boolean;
  count?: number;
  depth?: "child";
  icon: ReactNode;
  iconClassName?: string;
  label: string;
  onClick: () => void;
}) {
  const activeClass =
    "bg-orange-50 dark:bg-orange-900/20 border-l-2 border-orange-500 dark:border-orange-400";
  const inactiveClass = "hover:bg-gray-50 dark:hover:bg-gray-800/50 border-l-2 border-transparent";
  const iconColor = active
    ? "text-orange-600 dark:text-orange-400"
    : iconClassName || "text-gray-500 dark:text-gray-400";
  const textColor = active
    ? "text-orange-600 dark:text-orange-400 font-medium"
    : "text-gray-700 dark:text-gray-300";
  const countColor = active
    ? "text-orange-600 dark:text-orange-400"
    : "text-gray-400 dark:text-gray-500";

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
        depth === "child" ? "pl-7" : ""
      } ${active ? activeClass : inactiveClass}`}
    >
      <span className={iconColor}>{icon}</span>
      <span className={`flex-1 truncate ${textColor}`}>{label}</span>
      {count !== undefined && <span className={`text-xs ${countColor}`}>{count}</span>}
    </button>
  );
}
